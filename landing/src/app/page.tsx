export default function Home() {
  const dappUrl = process.env.NEXT_PUBLIC_DAPP_URL ?? "http://localhost:3001";

  return (
    <main className="min-h-screen bg-white text-neutral-900">
      <div className="mx-auto max-w-4xl p-6 space-y-10">
        <header className="space-y-2">
          <h1 className="text-4xl font-semibold">BlockUrna</h1>
          <p className="text-base text-neutral-700">
            Sistema de votación en blockchain con registro, aprobación y conteo transparente.
          </p>

          <div className="pt-2 flex flex-wrap gap-3">
            <a
              className="rounded-md bg-neutral-900 px-4 py-2 text-sm text-white"
              href={dappUrl}
            >
              Abrir sistema de votación
            </a>
            <a
              className="rounded-md border border-neutral-300 px-4 py-2 text-sm hover:bg-neutral-50"
              href="#como-funciona"
            >
              Cómo funciona
            </a>
          </div>
        </header>

        <section className="rounded-lg border border-neutral-200 p-5">
          <h2 className="text-xl font-medium">Objetivo</h2>
          <p className="mt-2 text-sm text-neutral-700">
            Desarrollar un sistema de votación digital basado en smart contracts, donde el registro,
            la emisión del voto y el conteo quedan registrados en cadena para auditoría.
          </p>
        </section>

        <section id="como-funciona" className="rounded-lg border border-neutral-200 p-5">
          <h2 className="text-xl font-medium">Cómo funciona</h2>
          <ol className="mt-3 space-y-2 text-sm text-neutral-700 list-decimal pl-5">
            <li>El admin abre el registro.</li>
            <li>Los votantes solicitan registro (auto-registro).</li>
            <li>El admin aprueba/rechaza solicitudes.</li>
            <li>El admin abre la votación.</li>
            <li>Votantes aprobados votan por 1 de mínimo 3 partidos.</li>
            <li>El conteo se actualiza on-chain y es visible para cualquiera.</li>
          </ol>
        </section>

        <section className="rounded-lg border border-neutral-200 p-5">
          <h2 className="text-xl font-medium">Características clave</h2>
          <ul className="mt-3 space-y-2 text-sm text-neutral-700 list-disc pl-5">
            <li>Mínimo 3 partidos políticos dentro del sistema.</li>
            <li>1 voto por wallet aprobada (prevención de doble voto).</li>
            <li>Conteo transparente (lectura directa del contrato).</li>
            <li>Eventos on-chain para auditoría del proceso.</li>
          </ul>
        </section>

        <section className="rounded-lg border border-neutral-200 p-5">
          <h2 className="text-xl font-medium">Tecnologías</h2>
          <ul className="mt-3 space-y-2 text-sm text-neutral-700 list-disc pl-5">
            <li>Smart contracts: Solidity + Hardhat</li>
            <li>dApp: Next.js + TypeScript + ethers.js</li>
            <li>Red: Hardhat local (demo) + opción Sepolia</li>
          </ul>
        </section>

        <footer className="pb-8 text-xs text-neutral-500">
          Nota: La demo local requiere MetaMask configurado para la red local (chainId 31337).
        </footer>
      </div>
    </main>
  );
}
