"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function Home() {
  const router = useRouter();
  const [electionId, setElectionId] = useState("");

  const handleStart = (e: React.FormEvent) => {
    e.preventDefault();
    if (electionId.trim()) {
      router.push(`/vote/${encodeURIComponent(electionId.trim())}`);
    }
  };

  return (
    <main className="space-y-6">
      <section className="card p-6">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-slate-900">Iniciar Proceso de Votación</h2>
          <span className="badge badge-info">Paso 1</span>
        </div>
        <p className="mt-2 text-sm text-slate-600">
          Ingresa el identificador de elección para continuar hacia el flujo de registro y emisión de boleta cifrada.
          Necesitarás tu Permit JSON validado por la REA.
        </p>
        
        <form onSubmit={handleStart} className="mt-6 space-y-4">
          <div>
            <label htmlFor="electionId" className="block text-sm font-medium text-slate-700">
              Election ID
            </label>
            <input
              id="electionId"
              type="text"
              required
              value={electionId}
              onChange={(e) => setElectionId(e.target.value)}
              className="mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
              placeholder="Ej. 0"
            />
          </div>
          <button
            type="submit"
            className="w-full rounded-md bg-indigo-600 py-2 px-4 text-sm font-semibold text-white hover:bg-indigo-700"
          >
            Continuar
          </button>
        </form>
      </section>
    </main>
  );
}
