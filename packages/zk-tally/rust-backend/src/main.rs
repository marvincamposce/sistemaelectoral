use anyhow::{anyhow, Context, Result};
use ark_bn254::{Bn254, Fq, Fr, G1Affine, G2Affine};
use ark_circom::{CircomBuilder, CircomConfig};
use ark_ff::{BigInteger, PrimeField};
use ark_groth16::{prepare_verifying_key, Groth16, Proof, ProvingKey, VerifyingKey};
use ark_serialize::{CanonicalDeserialize, CanonicalSerialize};
use ark_snark::SNARK;
use clap::{Parser, Subcommand};
use num_bigint::{BigInt, BigUint};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::fs::File;
use std::io::{self, Read};
use std::str::FromStr;

// Workaround: some Linux toolchains miss the expected stack-probe symbol when
// linking wasmer_vm. Provide a no-op fallback so the binary can link.
#[cfg(all(target_os = "linux", target_arch = "x86_64"))]
#[no_mangle]
pub extern "C" fn __rust_probestack() {}

#[derive(Parser)]
#[command(name = "zk_tally_rs")]
#[command(about = "Rust backend for zk-tally setup/prove/verify")]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    Setup {
        #[arg(long)]
        wasm: String,
        #[arg(long)]
        r1cs: String,
        #[arg(long)]
        proving_key_out: String,
        #[arg(long)]
        verifying_key_out: String,
        #[arg(long)]
        vkey_json_out: String,
    },
    Prove {
        #[arg(long)]
        wasm: String,
        #[arg(long)]
        r1cs: String,
        #[arg(long)]
        proving_key: String,
    },
    Verify {
        #[arg(long)]
        verifying_key: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct RustProofJson {
    a: [String; 2],
    b: [[String; 2]; 2],
    c: [String; 2],
    protocol: String,
    curve: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ProveOutput {
    proof: RustProofJson,
    public_signals: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct VerifyInput {
    proof: RustProofJson,
    public_signals: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct VKeyAuditJson {
    protocol: String,
    curve: String,
    backend: String,
    format: String,
    note: String,
}

fn main() -> Result<()> {
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .context("failed to initialize Tokio runtime")?;
    let _guard = runtime.enter();

    let cli = Cli::parse();
    match cli.command {
        Commands::Setup {
            wasm,
            r1cs,
            proving_key_out,
            verifying_key_out,
            vkey_json_out,
        } => cmd_setup(&wasm, &r1cs, &proving_key_out, &verifying_key_out, &vkey_json_out),
        Commands::Prove {
            wasm,
            r1cs,
            proving_key,
        } => cmd_prove(&wasm, &r1cs, &proving_key),
        Commands::Verify { verifying_key } => cmd_verify(&verifying_key),
    }
}

fn cmd_setup(
    wasm: &str,
    r1cs: &str,
    proving_key_out: &str,
    verifying_key_out: &str,
    vkey_json_out: &str,
) -> Result<()> {
    let cfg = CircomConfig::<Fr>::new(wasm, r1cs)
        .map_err(|err| anyhow!("failed to load wasm/r1cs: wasm={wasm}, r1cs={r1cs}: {err}"))?;
    let builder = CircomBuilder::new(cfg);
    let circom = builder.setup();

    let mut rng = rand::thread_rng();
    let (pk, vk): (ProvingKey<Bn254>, VerifyingKey<Bn254>) =
        Groth16::<Bn254>::circuit_specific_setup(circom, &mut rng)
            .context("failed to generate Groth16 setup in Rust backend")?;

    let mut pk_file = File::create(proving_key_out)
        .with_context(|| format!("failed to create proving key file: {proving_key_out}"))?;
    pk.serialize_compressed(&mut pk_file)
        .context("failed to serialize proving key")?;

    let mut vk_file = File::create(verifying_key_out)
        .with_context(|| format!("failed to create verifying key file: {verifying_key_out}"))?;
    vk.serialize_compressed(&mut vk_file)
        .context("failed to serialize verifying key")?;

    let audit = VKeyAuditJson {
        protocol: "groth16".to_string(),
        curve: "bn128".to_string(),
        backend: "rust-arkworks".to_string(),
        format: "ark-serialized-vk".to_string(),
        note: "Use zk_tally_rs verify with verifying_key_out for proof checks".to_string(),
    };

    let mut audit_file = File::create(vkey_json_out)
        .with_context(|| format!("failed to create vkey audit json: {vkey_json_out}"))?;
    serde_json::to_writer_pretty(&mut audit_file, &audit)
        .context("failed to write vkey audit json")?;

    println!(
        "{{\"ok\":true,\"proving_key\":\"{}\",\"verifying_key\":\"{}\",\"vkey_json\":\"{}\"}}",
        proving_key_out, verifying_key_out, vkey_json_out
    );

    Ok(())
}

fn cmd_prove(wasm: &str, r1cs: &str, proving_key_path: &str) -> Result<()> {
    let input = read_stdin_json().context("prove expects witness input JSON on stdin")?;
    let input_map = json_to_circom_inputs(input)?;

    let mut pk_file = File::open(proving_key_path)
        .with_context(|| format!("failed to open proving key: {proving_key_path}"))?;
    let pk = ProvingKey::<Bn254>::deserialize_compressed(&mut pk_file)
        .context("failed to deserialize proving key")?;

    let cfg = CircomConfig::<Fr>::new(wasm, r1cs)
        .map_err(|err| anyhow!("failed to load wasm/r1cs: wasm={wasm}, r1cs={r1cs}: {err}"))?;
    let mut builder = CircomBuilder::new(cfg);

    for (name, values) in input_map {
        for value in values {
            builder.push_input(name.clone(), value);
        }
    }

    let circom = builder
        .build()
        .map_err(|err| anyhow!("failed to build witness/circuit from input: {err}"))?;

    let public_inputs_fr = circom
        .get_public_inputs()
        .context("failed to extract public inputs")?;

    let mut rng = rand::thread_rng();
    let proof = Groth16::<Bn254>::prove(&pk, circom, &mut rng)
        .context("failed to generate proof")?;

    let out = ProveOutput {
        proof: proof_to_json(&proof),
        public_signals: public_inputs_fr.iter().map(field_to_dec_string::<Fr>).collect(),
    };

    serde_json::to_writer(io::stdout(), &out).context("failed to write prove output JSON")?;
    println!();
    Ok(())
}

fn cmd_verify(verifying_key_path: &str) -> Result<()> {
    let input: VerifyInput = read_stdin_json().context("verify expects proof/public JSON on stdin")?;

    let mut vk_file = File::open(verifying_key_path)
        .with_context(|| format!("failed to open verifying key: {verifying_key_path}"))?;
    let vk = VerifyingKey::<Bn254>::deserialize_compressed(&mut vk_file)
        .context("failed to deserialize verifying key")?;

    let proof = json_to_proof(&input.proof)?;
    let public_inputs = input
        .public_signals
        .iter()
        .map(|s| dec_string_to_field::<Fr>(s))
        .collect::<Result<Vec<_>>>()?;

    let pvk = prepare_verifying_key(&vk);
    let valid = Groth16::<Bn254>::verify_with_processed_vk(&pvk, &public_inputs, &proof)
        .context("failed to verify proof")?;

    println!("{{\"valid\":{}}}", if valid { "true" } else { "false" });
    Ok(())
}

fn read_stdin_json<T: for<'de> Deserialize<'de>>() -> Result<T> {
    let mut buf = String::new();
    io::stdin()
        .read_to_string(&mut buf)
        .context("failed to read stdin")?;
    serde_json::from_str::<T>(&buf).context("failed to parse stdin JSON")
}

fn json_to_circom_inputs(value: Value) -> Result<HashMap<String, Vec<BigInt>>> {
    let obj = value
        .as_object()
        .ok_or_else(|| anyhow!("witness input must be a JSON object"))?;

    let mut out = HashMap::new();
    for (key, v) in obj {
        let mut values = Vec::new();
        flatten_json_value_to_bigints(v, &mut values)?;
        out.insert(key.clone(), values);
    }
    Ok(out)
}

fn flatten_json_value_to_bigints(value: &Value, out: &mut Vec<BigInt>) -> Result<()> {
    match value {
        Value::Array(items) => {
            for item in items {
                flatten_json_value_to_bigints(item, out)?;
            }
            Ok(())
        }
        Value::String(s) => {
            out.push(parse_bigint(s)?);
            Ok(())
        }
        Value::Number(n) => {
            out.push(parse_bigint(&n.to_string())?);
            Ok(())
        }
        _ => Err(anyhow!("unsupported witness input value: {value}")),
    }
}

fn parse_bigint(raw: &str) -> Result<BigInt> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err(anyhow!("empty numeric string"));
    }

    if let Some(hex) = trimmed
        .strip_prefix("0x")
        .or_else(|| trimmed.strip_prefix("0X"))
    {
        let unsigned = BigUint::parse_bytes(hex.as_bytes(), 16)
            .ok_or_else(|| anyhow!("invalid hex integer: {trimmed}"))?;
        return Ok(BigInt::from(unsigned));
    }

    BigInt::from_str(trimmed).with_context(|| format!("invalid integer: {trimmed}"))
}

fn field_to_dec_string<F: PrimeField>(value: &F) -> String {
    let bytes = value.into_bigint().to_bytes_be();
    BigUint::from_bytes_be(&bytes).to_string()
}

fn dec_string_to_field<F: PrimeField>(value: &str) -> Result<F> {
    let bigint = BigUint::from_str(value)
        .with_context(|| format!("invalid decimal field element: {value}"))?;
    let mut bytes_le = bigint.to_bytes_le();
    let field_size = usize::try_from(F::MODULUS_BIT_SIZE.div_ceil(8)).unwrap_or(32);
    bytes_le.resize(field_size, 0);
    let repr = <F as PrimeField>::BigInt::deserialize_uncompressed(bytes_le.as_slice())
        .context("failed to deserialize field bigint")?;
    F::from_bigint(repr).ok_or_else(|| anyhow!("field element out of range"))
}

fn proof_to_json(proof: &Proof<Bn254>) -> RustProofJson {
    RustProofJson {
        a: [field_to_dec_string(&proof.a.x), field_to_dec_string(&proof.a.y)],
        b: [
            [
                field_to_dec_string(&proof.b.x.c0),
                field_to_dec_string(&proof.b.x.c1),
            ],
            [
                field_to_dec_string(&proof.b.y.c0),
                field_to_dec_string(&proof.b.y.c1),
            ],
        ],
        c: [field_to_dec_string(&proof.c.x), field_to_dec_string(&proof.c.y)],
        protocol: "groth16".to_string(),
        curve: "bn128".to_string(),
    }
}

fn json_to_proof(json: &RustProofJson) -> Result<Proof<Bn254>> {
    let ax = dec_string_to_field::<Fq>(&json.a[0])?;
    let ay = dec_string_to_field::<Fq>(&json.a[1])?;
    let bx0 = dec_string_to_field::<Fq>(&json.b[0][0])?;
    let bx1 = dec_string_to_field::<Fq>(&json.b[0][1])?;
    let by0 = dec_string_to_field::<Fq>(&json.b[1][0])?;
    let by1 = dec_string_to_field::<Fq>(&json.b[1][1])?;
    let cx = dec_string_to_field::<Fq>(&json.c[0])?;
    let cy = dec_string_to_field::<Fq>(&json.c[1])?;

    let a = G1Affine::new_unchecked(ax, ay);
    let b = G2Affine::new_unchecked(
        ark_bn254::Fq2::new(bx0, bx1),
        ark_bn254::Fq2::new(by0, by1),
    );
    let c = G1Affine::new_unchecked(cx, cy);

    Ok(Proof { a, b, c })
}
