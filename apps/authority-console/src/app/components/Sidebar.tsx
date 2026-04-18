import Link from "next/link";
import { Settings, Shield, Activity, Users, Database } from "lucide-react";

export function Sidebar() {
  return (
    <aside className="admin-sidebar">
      <div className="admin-sidebar-header">
        <div className="flex items-center gap-3">
          <Shield className="text-blue-500" size={28} />
          <div>
            <div className="text-xs text-blue-400 font-bold uppercase tracking-wider">BlockUrna</div>
            <div className="font-semibold text-white">Centro de Mando</div>
          </div>
        </div>
      </div>
      <nav className="admin-sidebar-nav">
        <Link href="/" className="admin-nav-link active">
          <Activity size={20} />
          Panel Principal
        </Link>
        <Link href="/honduras" className="admin-nav-link">
          <Users size={20} />
          Expedientes (Scope)
        </Link>
        <Link href="http://localhost:3004/" className="admin-nav-link mt-8 border-t border-slate-800 pt-4">
          <Database size={20} />
          Portal Votante
        </Link>
        <Link href="http://localhost:3005/" className="admin-nav-link">
          <Settings size={20} />
          Pizarra Escrutinio
        </Link>
      </nav>
    </aside>
  );
}
