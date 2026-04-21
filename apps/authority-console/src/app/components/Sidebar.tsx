"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, Shield, Eye, BarChart3, Vote, ChevronRight } from "lucide-react";

const NAV_SECTIONS = [
  {
    label: "Administración",
    items: [
      { href: "/", icon: LayoutDashboard, label: "Panel principal", external: false },
      { href: "/honduras", icon: Shield, label: "Expedientes", external: false },
    ],
  },
  {
    label: "Ecosistema",
    items: [
      { href: "http://localhost:3004/", icon: Vote, label: "Portal de votante", external: true },
      { href: "http://localhost:3005/", icon: BarChart3, label: "Escrutinio público", external: true },
      { href: "http://localhost:3011/", icon: Eye, label: "Observatorio", external: true },
    ],
  },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="admin-sidebar">
      {/* Brand */}
      <div className="admin-sidebar-header">
        <Link href="/" className="flex items-center gap-3 group">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center shadow-lg shadow-indigo-500/20 group-hover:shadow-indigo-500/40 transition-shadow">
            <Shield className="text-white" size={18} strokeWidth={2.5} />
          </div>
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-indigo-400">BlockUrna</div>
            <div className="text-sm font-bold text-white leading-tight">Consola AEA</div>
          </div>
        </Link>
      </div>

      {/* Navigation */}
      <nav className="admin-sidebar-nav">
        {NAV_SECTIONS.map((section) => (
          <div key={section.label} className="mb-5">
            <div className="px-3 mb-2 text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">
              {section.label}
            </div>
            <div className="space-y-1">
              {section.items.map((item) => {
                const isActive = !item.external && (
                  item.href === "/" ? pathname === "/" : pathname.startsWith(item.href)
                );
                const Icon = item.icon;

                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    target={item.external ? "_blank" : undefined}
                    className={`admin-nav-link ${isActive ? "active" : ""}`}
                  >
                    <Icon size={18} strokeWidth={isActive ? 2.5 : 2} />
                    <span className="flex-1 text-[13px]">{item.label}</span>
                    {item.external && (
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="opacity-40">
                        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
                      </svg>
                    )}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* Footer */}
      <div className="px-4 py-4 border-t border-slate-800/50">
        <div className="flex items-center gap-2 text-[11px] text-slate-600">
          <div className="w-2 h-2 rounded-full bg-emerald-500 shadow-sm shadow-emerald-500/50" />
          <span>Protocolo BU-PVP-1</span>
        </div>
      </div>
    </aside>
  );
}
