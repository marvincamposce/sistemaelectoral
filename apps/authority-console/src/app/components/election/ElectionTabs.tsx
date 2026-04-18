"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function ElectionTabs({ electionIdStr }: { electionIdStr: string }) {
  const pathname = usePathname();
  const basePath = `/elections/${electionIdStr}`;

  return (
    <div className="mb-6 border-b border-slate-200">
      <nav className="-mb-px flex space-x-8" aria-label="Tabs">
        <Link
          href={`${basePath}/dashboard`}
          className={`${
            pathname.includes("/dashboard")
              ? "border-indigo-500 text-indigo-600"
              : "border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700"
          } whitespace-nowrap border-b-2 py-4 px-1 text-sm font-medium`}
        >
          Dashboard
        </Link>
        <Link
          href={`${basePath}/catalog`}
          className={`${
            pathname.includes("/catalog")
              ? "border-indigo-500 text-indigo-600"
              : "border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700"
          } whitespace-nowrap border-b-2 py-4 px-1 text-sm font-medium`}
        >
          Catálogo Oficial
        </Link>
        <Link
          href={`${basePath}/orchestration`}
          className={`${
            pathname.includes("/orchestration")
              ? "border-indigo-500 text-indigo-600"
              : "border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700"
          } whitespace-nowrap border-b-2 py-4 px-1 text-sm font-medium`}
        >
          Orquestación
        </Link>
        <Link
          href={`${basePath}/evidence`}
          className={`${
            pathname.includes("/evidence")
              ? "border-indigo-500 text-indigo-600"
              : "border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700"
          } whitespace-nowrap border-b-2 py-4 px-1 text-sm font-medium`}
        >
          Evidencia
        </Link>
        <Link
          href={`${basePath}/logs`}
          className={`${
            pathname.includes("/logs")
              ? "border-indigo-500 text-indigo-600"
              : "border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700"
          } whitespace-nowrap border-b-2 py-4 px-1 text-sm font-medium`}
        >
          Logs
        </Link>
      </nav>
    </div>
  );
}
