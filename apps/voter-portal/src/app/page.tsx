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
      <div className="rounded-lg border border-neutral-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold">Iniciar Proceso Experimental</h2>
        <p className="mt-2 text-sm text-neutral-600">
          Ingrese el ID de la elección a la que desea acceder. Debe contar con un Permit JSON generado previamente.
        </p>
        
        <form onSubmit={handleStart} className="mt-6 space-y-4">
          <div>
            <label htmlFor="electionId" className="block text-sm font-medium text-neutral-700">
              Election ID
            </label>
            <input
              id="electionId"
              type="text"
              required
              value={electionId}
              onChange={(e) => setElectionId(e.target.value)}
              className="mt-1 block w-full rounded-md border-neutral-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm px-3 py-2 border"
              placeholder="Ej. 0"
            />
          </div>
          <button
            type="submit"
            className="w-full rounded-md bg-neutral-900 py-2 px-4 text-sm font-semibold text-white hover:bg-neutral-800"
          >
            Continuar
          </button>
        </form>
      </div>
    </main>
  );
}
