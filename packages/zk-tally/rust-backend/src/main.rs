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
use std::fmt::Write as FmtWrite;
use std::fs::{self, File};
use std::io::{self, Read, Write};
use std::path::Path;
use std::str::FromStr;

// Workaround: some Linux toolchains miss the expected stack-probe symbol when
// linking wasmer_vm. Provide a no-op shim so the binary can link.
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
    ExportSolidityVerifier {
        #[arg(long)]
        verifying_key: String,
        #[arg(long)]
        output: String,
        #[arg(long, default_value = "Groth16Verifier")]
        contract_name: String,
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
        Commands::ExportSolidityVerifier {
            verifying_key,
            output,
            contract_name,
        } => cmd_export_solidity_verifier(&verifying_key, &output, &contract_name),
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

fn cmd_export_solidity_verifier(
    verifying_key_path: &str,
    output_path: &str,
    contract_name: &str,
) -> Result<()> {
    validate_solidity_identifier(contract_name)?;

    let mut vk_file = File::open(verifying_key_path)
        .with_context(|| format!("failed to open verifying key: {verifying_key_path}"))?;
    let vk = VerifyingKey::<Bn254>::deserialize_compressed(&mut vk_file)
        .context("failed to deserialize verifying key")?;

    let solidity_source = render_solidity_verifier(&vk, contract_name)?;

    if let Some(parent) = Path::new(output_path).parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent).with_context(|| {
                format!("failed to create output directory: {}", parent.display())
            })?;
        }
    }

    let mut output_file = File::create(output_path)
        .with_context(|| format!("failed to create output file: {output_path}"))?;
    output_file
        .write_all(solidity_source.as_bytes())
        .with_context(|| format!("failed to write output file: {output_path}"))?;

    println!(
        "{{\"ok\":true,\"output\":\"{}\",\"contract\":\"{}\"}}",
        output_path, contract_name
    );

    Ok(())
}

fn validate_solidity_identifier(name: &str) -> Result<()> {
    let mut chars = name.chars();
    let Some(first) = chars.next() else {
        return Err(anyhow!("contract_name cannot be empty"));
    };

    if !(first == '_' || first.is_ascii_alphabetic()) {
        return Err(anyhow!(
            "contract_name must start with ASCII letter or underscore"
        ));
    }

    if !chars.all(|c| c == '_' || c.is_ascii_alphanumeric()) {
        return Err(anyhow!(
            "contract_name must contain only ASCII letters, digits, or underscore"
        ));
    }

    Ok(())
}

fn render_solidity_verifier(vk: &VerifyingKey<Bn254>, contract_name: &str) -> Result<String> {
    validate_solidity_identifier(contract_name)?;

    let input_count = vk
        .gamma_abc_g1
        .len()
        .checked_sub(1)
        .ok_or_else(|| anyhow!("verifying key has no gamma_abc_g1 entries"))?;

    let mut out = String::new();

    out.push_str(
        r#"// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

library Pairing {
    uint256 internal constant PRIME_Q =
        21888242871839275222246405745257275088696311157297823662689037894645226208583;

    struct G1Point {
        uint256 X;
        uint256 Y;
    }

    struct G2Point {
        uint256[2] X;
        uint256[2] Y;
    }

    function negate(G1Point memory p) internal pure returns (G1Point memory) {
        if (p.X == 0 && p.Y == 0) {
            return G1Point(0, 0);
        }
        return G1Point(p.X, PRIME_Q - (p.Y % PRIME_Q));
    }

    function addition(
        G1Point memory p1,
        G1Point memory p2
    ) internal view returns (G1Point memory r) {
        uint256[4] memory input;
        input[0] = p1.X;
        input[1] = p1.Y;
        input[2] = p2.X;
        input[3] = p2.Y;

        bool success;
        assembly {
            success := staticcall(gas(), 6, input, 0x80, r, 0x40)
        }
        require(success, "pairing-add-failed");
    }

    function scalar_mul(
        G1Point memory p,
        uint256 s
    ) internal view returns (G1Point memory r) {
        uint256[3] memory input;
        input[0] = p.X;
        input[1] = p.Y;
        input[2] = s;

        bool success;
        assembly {
            success := staticcall(gas(), 7, input, 0x60, r, 0x40)
        }
        require(success, "pairing-mul-failed");
    }

    function pairing(
        G1Point[] memory p1,
        G2Point[] memory p2
    ) internal view returns (bool) {
        require(p1.length == p2.length, "pairing-length-mismatch");

        uint256 elements = p1.length;
        uint256 inputSize = elements * 6;
        uint256[] memory input = new uint256[](inputSize);

        for (uint256 i = 0; i < elements; i++) {
            uint256 offset = i * 6;
            input[offset] = p1[i].X;
            input[offset + 1] = p1[i].Y;
            input[offset + 2] = p2[i].X[0];
            input[offset + 3] = p2[i].X[1];
            input[offset + 4] = p2[i].Y[0];
            input[offset + 5] = p2[i].Y[1];
        }

        uint256[1] memory out;
        bool success;
        assembly {
            success := staticcall(
                gas(),
                8,
                add(input, 0x20),
                mul(inputSize, 0x20),
                out,
                0x20
            )
        }

        require(success, "pairing-opcode-failed");
        return out[0] != 0;
    }

    function pairingProd4(
        G1Point memory a1,
        G2Point memory a2,
        G1Point memory b1,
        G2Point memory b2,
        G1Point memory c1,
        G2Point memory c2,
        G1Point memory d1,
        G2Point memory d2
    ) internal view returns (bool) {
        G1Point[] memory p1 = new G1Point[](4);
        G2Point[] memory p2 = new G2Point[](4);

        p1[0] = a1;
        p1[1] = b1;
        p1[2] = c1;
        p1[3] = d1;

        p2[0] = a2;
        p2[1] = b2;
        p2[2] = c2;
        p2[3] = d2;

        return pairing(p1, p2);
    }
}

"#,
    );

    {
        macro_rules! pushln {
            ($($arg:tt)*) => {{
                writeln!(out, $($arg)*)
                    .map_err(|_| anyhow!("failed to render Solidity verifier"))?;
            }};
        }

        pushln!("contract {} {{", contract_name);
        pushln!(
            "    uint256 internal constant SNARK_SCALAR_FIELD = {};",
            Fr::MODULUS
        );
        pushln!("    uint256 internal constant INPUT_COUNT = {};", input_count);
        pushln!("");
        pushln!("    struct VerifyingKey {{");
        pushln!("        Pairing.G1Point alfa1;");
        pushln!("        Pairing.G2Point beta2;");
        pushln!("        Pairing.G2Point gamma2;");
        pushln!("        Pairing.G2Point delta2;");
        pushln!("        Pairing.G1Point[] IC;");
        pushln!("    }}");
        pushln!("");
        pushln!("    struct Proof {{");
        pushln!("        Pairing.G1Point A;");
        pushln!("        Pairing.G2Point B;");
        pushln!("        Pairing.G1Point C;");
        pushln!("    }}");
        pushln!("");
        pushln!("    error InvalidPublicInputLength(uint256 expected, uint256 received);");
        pushln!("    error PublicInputOutOfRange(uint256 index);");
        pushln!("");
    }

    append_verifier_key(&mut out, vk)?;

    out.push_str(
        r#"

    function _verify(
        uint256[] memory input,
        Proof memory proof
    ) internal view returns (bool) {
        VerifyingKey memory vk = verifyingKey();

        if (input.length + 1 != vk.IC.length) {
            revert InvalidPublicInputLength(vk.IC.length - 1, input.length);
        }

        Pairing.G1Point memory vk_x = Pairing.G1Point(0, 0);
        for (uint256 i = 0; i < input.length; i++) {
            if (input[i] >= SNARK_SCALAR_FIELD) {
                revert PublicInputOutOfRange(i);
            }
            vk_x = Pairing.addition(vk_x, Pairing.scalar_mul(vk.IC[i + 1], input[i]));
        }
        vk_x = Pairing.addition(vk_x, vk.IC[0]);

        return Pairing.pairingProd4(
            proof.A,
            proof.B,
            Pairing.negate(vk_x),
            vk.gamma2,
            Pairing.negate(proof.C),
            vk.delta2,
            Pairing.negate(vk.alfa1),
            vk.beta2
        );
    }

    function verifyProof(
        uint256[2] calldata a,
        uint256[2][2] calldata b,
        uint256[2] calldata c,
        uint256[] calldata input
    ) external view returns (bool) {
        Proof memory proof;
        proof.A = Pairing.G1Point(a[0], a[1]);
        proof.B = Pairing.G2Point([b[0][0], b[0][1]], [b[1][0], b[1][1]]);
        proof.C = Pairing.G1Point(c[0], c[1]);

        uint256[] memory copiedInput = new uint256[](input.length);
        for (uint256 i = 0; i < input.length; i++) {
            copiedInput[i] = input[i];
        }

        return _verify(copiedInput, proof);
    }
}
"#,
    );

    Ok(out)
}

fn append_verifier_key(out: &mut String, vk: &VerifyingKey<Bn254>) -> Result<()> {
    macro_rules! pushln {
        ($($arg:tt)*) => {{
            writeln!(out, $($arg)*)
                .map_err(|_| anyhow!("failed to render Solidity verifier"))?;
        }};
    }

    pushln!("    function verifyingKey() internal pure returns (VerifyingKey memory vk) {{");
    append_g1_point(out, "        vk.alfa1", &vk.alpha_g1)?;
    append_g2_point(out, "        vk.beta2", &vk.beta_g2)?;
    append_g2_point(out, "        vk.gamma2", &vk.gamma_g2)?;
    append_g2_point(out, "        vk.delta2", &vk.delta_g2)?;

    pushln!(
        "        vk.IC = new Pairing.G1Point[]({});",
        vk.gamma_abc_g1.len()
    );
    for (index, point) in vk.gamma_abc_g1.iter().enumerate() {
        append_g1_point(out, &format!("        vk.IC[{index}]"), point)?;
    }

    pushln!("    }}");
    Ok(())
}

fn append_g1_point(out: &mut String, lhs: &str, point: &G1Affine) -> Result<()> {
    writeln!(
        out,
        "{} = Pairing.G1Point(uint256({}), uint256({}));",
        lhs,
        field_to_dec_string(&point.x),
        field_to_dec_string(&point.y)
    )
    .map_err(|_| anyhow!("failed to render G1 point"))?;

    Ok(())
}

fn append_g2_point(out: &mut String, lhs: &str, point: &G2Affine) -> Result<()> {
    // EVM pairing precompile expects Fq2 coefficients as [c1, c0].
    let x_c0 = field_to_dec_string(&point.x.c0);
    let x_c1 = field_to_dec_string(&point.x.c1);
    let y_c0 = field_to_dec_string(&point.y.c0);
    let y_c1 = field_to_dec_string(&point.y.c1);

    writeln!(
        out,
        "{} = Pairing.G2Point([uint256({}), uint256({})], [uint256({}), uint256({})]);",
        lhs, x_c1, x_c0, y_c1, y_c0
    )
    .map_err(|_| anyhow!("failed to render G2 point"))?;

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
