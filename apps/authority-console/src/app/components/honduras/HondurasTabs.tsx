"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function HondurasTabs() {
  const pathname = usePathname();

  return (
    <div className="mb-6 border-b border-slate-200">
      <nav className="-mb-px flex space-x-8" aria-label="Tabs">
        <Link
          href="/honduras/dashboard"
          className={`${
            pathname.includes("/dashboard")
              ? "border-blue-500 text-blue-600"
              : "border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700"
          } whitespace-nowrap border-b-2 py-4 px-1 text-sm font-medium`}
        >
          Dashboard y Resumen
        </Link>
        <Link
          href="/honduras/census"
          className={`${
            pathname.includes("/census")
              ? "border-blue-500 text-blue-600"
              : "border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700"
          } whitespace-nowrap border-b-2 py-4 px-1 text-sm font-medium`}
        >
          Censo y Autorizaciones
        </Link>
        <Link
          href="/honduras/audits"
          className={`${
            pathname.includes("/audits")
              ? "border-blue-500 text-blue-600"
              : "border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700"
          } whitespace-nowrap border-b-2 py-4 px-1 text-sm font-medium`}
        >
          Auditorías y Solicitudes
        </Link>
      </nav>
    </div>
  );
}
