import Link from "next/link";

import { getPublicEnv } from "../../../../../../lib/env";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type SignupEvidenceResponse =
  | {
      ok: false;
      error: string;
    }
  | {
      ok: true;
      chainId: string;
      contractAddress: string;
      electionId: string;
      signup: {
        registryNullifier: string;
        votingPubKey: string;
        blockNumber: string;
        blockTimestamp: string | null;
        txHash: string;
        logIndex: number;
        permit:
          | null
          | {
              credentialId: string | null;
              issuerAddress: string | null;
              permitSig: string;
              issuedAt: string | null;
              recordedAt: string | null;
            };
        validity: {
          status: "VALID" | "UNVERIFIED" | "INVALID";
          reason: string | null;
          recoveredIssuerAddress: string | null;
          error?: string;
        };
      };
    };

function validityBadge(status: string): { label: string; className: string } {
  const s = String(status ?? "").toUpperCase();
  if (s === "VALID") return { label: "VÁLIDA", className: "bg-neutral-900 text-white" };
  if (s === "UNVERIFIED") return { label: "SIN BITÁCORA", className: "bg-neutral-200 text-neutral-900" };
  return { label: "INVÁLIDA", className: "bg-neutral-700 text-white" };
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Evidence API error: ${res.status} ${res.statusText}${text ? `: ${text}` : ""}`);
  }
  return (await res.json()) as T;
}

async function safeFetchJson<T>(url: string, fallback: T): Promise<T> {
  try {
    return await fetchJson<T>(url);
  } catch {
    return fallback;
  }
}

export default async function SignupEvidencePage({
  params,
}: {
  params: Promise<{ id: string; txHash: string; logIndex: string }>;
}) {
  const env = getPublicEnv();
  const apiBase = env.NEXT_PUBLIC_EVIDENCE_API_URL.replace(/\/$/, "");

  const resolvedParams = await params;
  const electionId = String(resolvedParams.id);
  const txHash = String(resolvedParams.txHash).toLowerCase();
  const logIndex = String(resolvedParams.logIndex);

  const evidence = await safeFetchJson<SignupEvidenceResponse | null>(
    `${apiBase}/v1/elections/${encodeURIComponent(electionId)}/signups/${encodeURIComponent(txHash)}/${encodeURIComponent(logIndex)}`,
    null,
  );

  if (!evidence || !evidence.ok) {
    return (
      <main className="min-h-screen bg-white text-neutral-900">
        <div className="mx-auto max-w-5xl p-6 space-y-6">
          <header className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <h1 className="text-2xl font-semibold break-all">Signup</h1>
              <div className="rounded-md px-3 py-1 text-xs font-semibold bg-neutral-200 text-neutral-900">
                NO ENCONTRADA
              </div>
            </div>
            <div className="text-xs text-neutral-600">
              Elección #{electionId} · <Link className="underline" href={`/elections/${encodeURIComponent(electionId)}/signups`}>
                volver
              </Link>
            </div>
            <div className="text-xs text-neutral-500 break-all">API: {apiBase}</div>
          </header>

          <section className="rounded-lg border border-neutral-200 p-4 space-y-2">
            <div className="text-sm font-medium">No se encontró el signup</div>
            <div className="text-sm text-neutral-700 break-all">
              tx: {txHash} · logIndex: {logIndex}
            </div>
          </section>
        </div>
      </main>
    );
  }

  const s = evidence.signup;
  const badge = validityBadge(s.validity?.status);

  return (
    <main className="min-h-screen bg-white text-neutral-900">
      <div className="mx-auto max-w-5xl p-6 space-y-6">
        <header className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <h1 className="text-2xl font-semibold break-all">Signup · Evidencia</h1>
            <div className={`rounded-md px-3 py-1 text-xs font-semibold ${badge.className}`}>{badge.label}</div>
          </div>
          <div className="text-xs text-neutral-600">
            Elección #{electionId} · <Link className="underline" href={`/elections/${encodeURIComponent(electionId)}/signups`}>
              volver
            </Link>
          </div>
          <div className="text-xs text-neutral-500 break-all">API: {apiBase}</div>
        </header>

        <section className="rounded-lg border border-neutral-200 p-4 space-y-2">
          <div className="text-sm font-medium">On-chain (evento indexado)</div>
          <div className="text-xs text-neutral-700 break-all">txHash: {s.txHash}</div>
          <div className="text-xs text-neutral-700">logIndex: {s.logIndex}</div>
          <div className="text-xs text-neutral-700">blockNumber: {s.blockNumber}</div>
          <div className="text-xs text-neutral-700">blockTimestamp: {s.blockTimestamp ?? "(sin timestamp)"}</div>
          <div className="text-xs text-neutral-700 break-all">registryNullifier: {s.registryNullifier}</div>
          <div className="text-xs text-neutral-700 break-all">votingPubKey: {s.votingPubKey}</div>
        </section>

        <section className="rounded-lg border border-neutral-200 p-4 space-y-2">
          <div className="text-sm font-medium">Validez</div>
          <div className="text-xs text-neutral-700">status: {s.validity.status}</div>
          <div className="text-xs text-neutral-700">reason: {s.validity.reason ?? "(none)"}</div>
          <div className="text-xs text-neutral-700 break-all">
            recoveredIssuerAddress: {s.validity.recoveredIssuerAddress ?? "(none)"}
          </div>
          {s.validity.error ? (
            <div className="text-xs text-neutral-700 break-all">error: {s.validity.error}</div>
          ) : null}
        </section>

        <section className="rounded-lg border border-neutral-200 p-4 space-y-2">
          <div className="text-sm font-medium">Bitácora REA (permit emitido)</div>
          {s.permit ? (
            <>
              <div className="text-xs text-neutral-700 break-all">credentialId: {s.permit.credentialId ?? "(unknown)"}</div>
              <div className="text-xs text-neutral-700 break-all">issuerAddress: {s.permit.issuerAddress ?? "(unknown)"}</div>
              <div className="text-xs text-neutral-700">issuedAt: {s.permit.issuedAt ?? "(unknown)"}</div>
              <div className="text-xs text-neutral-700">recordedAt: {s.permit.recordedAt ?? "(unknown)"}</div>
              <div className="text-xs text-neutral-700 break-all">permitSig: {s.permit.permitSig}</div>
            </>
          ) : (
            <div className="text-sm text-neutral-600">(Sin registro de emisión)</div>
          )}
        </section>
      </div>
    </main>
  );
}
