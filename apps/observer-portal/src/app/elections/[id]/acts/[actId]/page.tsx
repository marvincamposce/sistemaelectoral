import Link from "next/link";

import { getPublicEnv } from "../../../../../lib/env";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type ActMetaResponse = {
  ok: boolean;
  electionId: string;
  actId: string;
  act: {
    actId: string;
    electionId: string;
    actType: string;
    canonicalJson: any | null;
    signature: string | null;
    signerKeyId: string | null;
    signerPublicKey: string | null;
    contentHash: string | null;
    anchorTxHash: string | null;
    blockNumber: string | null;
    blockTimestamp: string | null;
    createdAt: string | null;
  };
};

type ActContentResponse = {
  ok: boolean;
  electionId: string;
  actId: string;
  signedJson: unknown;
};

type ActVerifyResponse = {
  ok: boolean;
  electionId: string;
  actId: string;
  signatureValid: boolean;
  hashMatchesAnchor: boolean;
  anchorFoundOnChain: boolean;
  consistencyStatus: string;
};

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`Evidence API error: ${res.status} ${res.statusText}`);
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

export default async function ActPage({
  params,
}: {
  params: Promise<{ id: string; actId: string }>;
}) {
  const env = getPublicEnv();
  const apiBase = env.NEXT_PUBLIC_EVIDENCE_API_URL.replace(/\/$/, "");

  const resolvedParams = await params;
  const electionId = String(resolvedParams.id);
  const actId = String(resolvedParams.actId).toLowerCase();

  const meta = await safeFetchJson<ActMetaResponse | null>(
    `${apiBase}/v1/elections/${encodeURIComponent(electionId)}/acts/${encodeURIComponent(actId)}`,
    null,
  );

  if (!meta || !meta.ok) {
    return (
      <main className="min-h-screen bg-white text-neutral-900">
        <div className="mx-auto max-w-5xl p-6 space-y-6">
          <header className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <h1 className="text-2xl font-semibold break-all">Acta {actId}</h1>
              <div className="rounded-md px-3 py-1 text-xs font-semibold bg-neutral-200 text-neutral-900">
                NO ENCONTRADA
              </div>
            </div>
            <div className="text-xs text-neutral-600">
              Elección #{electionId} · <Link className="underline" href="/">volver</Link>
            </div>
            <div className="text-xs text-neutral-500 break-all">API: {apiBase}</div>
          </header>

          <section className="rounded-lg border border-neutral-200 p-4 space-y-2">
            <div className="text-sm font-medium">No se encontró el acta</div>
            <div className="text-sm text-neutral-700">
              La Evidence API configurada no tiene un anchor ni contenido para este <span className="font-mono">actId</span>.
            </div>
            <div className="text-xs text-neutral-600">
              Tip: abre la portada y copia un <span className="font-mono">actId</span> desde “Actas (referencias ancladas)”, o asegúrate de que el indexer + API estén apuntando al mismo <span className="font-mono">ELECTION_REGISTRY_ADDRESS</span>.
            </div>
          </section>
        </div>
      </main>
    );
  }

  const verify = await safeFetchJson<ActVerifyResponse>(
    `${apiBase}/v1/elections/${encodeURIComponent(electionId)}/acts/${encodeURIComponent(actId)}/verify`,
    {
      ok: true,
      electionId,
      actId,
      signatureValid: false,
      hashMatchesAnchor: false,
      anchorFoundOnChain: false,
      consistencyStatus: "UNKNOWN",
    },
  );

  const content = await safeFetchJson<ActContentResponse | null>(
    `${apiBase}/v1/elections/${encodeURIComponent(electionId)}/acts/${encodeURIComponent(actId)}/content`,
    null,
  );

  const contentAvailable = Boolean(content && content.ok);

  const badge = (() => {
    if (!contentAvailable || !verify.anchorFoundOnChain) return "INCOMPLETA";
    if (verify.signatureValid && verify.hashMatchesAnchor && verify.consistencyStatus === "OK") {
      return "VÁLIDA";
    }
    return "INVÁLIDA";
  })();

  const badgeClass =
    badge === "VÁLIDA"
      ? "bg-neutral-900 text-white"
      : badge === "INCOMPLETA"
        ? "bg-neutral-200 text-neutral-900"
        : "bg-neutral-700 text-white";

  const downloadUrl = `${apiBase}/v1/elections/${encodeURIComponent(electionId)}/acts/${encodeURIComponent(actId)}/content`;

  return (
    <main className="min-h-screen bg-white text-neutral-900">
      <div className="mx-auto max-w-5xl p-6 space-y-6">
        <header className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <h1 className="text-2xl font-semibold break-all">Acta {actId}</h1>
            <div className={`rounded-md px-3 py-1 text-xs font-semibold ${badgeClass}`}>{badge}</div>
          </div>
          <div className="text-xs text-neutral-600">
            Elección #{electionId} · <Link className="underline" href="/">volver</Link>
          </div>
          <div className="text-xs text-neutral-500 break-all">API: {apiBase}</div>
        </header>

        <section className="rounded-lg border border-neutral-200 p-4 space-y-2">
          <div className="text-sm font-medium">Metadata del acta</div>
          <div className="text-xs text-neutral-700 break-all">actType: {meta.act.actType}</div>
          <div className="text-xs text-neutral-700 break-all">contentHash: {meta.act.contentHash ?? "(sin contenido)"}</div>
          <div className="text-xs text-neutral-700 break-all">signature: {meta.act.signature ?? "(sin contenido)"}</div>
          <div className="text-xs text-neutral-700 break-all">signerPublicKey: {meta.act.signerPublicKey ?? "(sin contenido)"}</div>
          <div className="text-xs text-neutral-700 break-all">signerKeyId: {meta.act.signerKeyId ?? "(sin contenido)"}</div>
          <div className="text-xs text-neutral-700 break-all">anchorTxHash: {meta.act.anchorTxHash ?? "(sin anchor)"}</div>
          <div className="text-xs text-neutral-700 break-all">blockNumber: {meta.act.blockNumber ?? "(sin anchor)"}</div>
          <div className="text-xs text-neutral-700 break-all">blockTimestamp: {meta.act.blockTimestamp ?? "(sin anchor)"}</div>
          <div className="text-xs text-neutral-700 break-all">createdAt: {meta.act.createdAt ?? "(sin contenido)"}</div>
        </section>

        <section className="rounded-lg border border-neutral-200 p-4 space-y-2">
          <div className="text-sm font-medium">Verificación</div>
          <div className="text-xs text-neutral-700">signatureValid: {String(verify.signatureValid)}</div>
          <div className="text-xs text-neutral-700">hashMatchesAnchor: {String(verify.hashMatchesAnchor)}</div>
          <div className="text-xs text-neutral-700">anchorFoundOnChain: {String(verify.anchorFoundOnChain)}</div>
          <div className="text-xs text-neutral-700">consistencyStatus: {verify.consistencyStatus}</div>
        </section>

        <section className="rounded-lg border border-neutral-200 p-4 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div className="text-sm font-medium">JSON firmado (contenido íntegro)</div>
            <a className="text-xs underline break-all" href={downloadUrl} target="_blank" rel="noreferrer">
              Descargar
            </a>
          </div>

          {contentAvailable ? (
            <pre className="text-xs whitespace-pre-wrap break-all rounded-md border border-neutral-200 p-3 bg-white">
              {JSON.stringify(content!.signedJson, null, 2)}
            </pre>
          ) : (
            <div className="text-sm text-neutral-600">(Sin contenido firmado disponible)</div>
          )}
        </section>

        {meta.act.canonicalJson ? (
          <section className="rounded-lg border border-neutral-200 p-4 space-y-3">
            <div className="text-sm font-medium">Canonical JSON (snapshot)</div>
            <pre className="text-xs whitespace-pre-wrap break-all rounded-md border border-neutral-200 p-3 bg-white">
              {JSON.stringify(meta.act.canonicalJson, null, 2)}
            </pre>
          </section>
        ) : null}
      </div>
    </main>
  );
}
