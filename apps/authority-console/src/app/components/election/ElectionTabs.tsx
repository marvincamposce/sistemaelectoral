"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, Users, Workflow, FileCheck, ScrollText } from "lucide-react";

const TABS = [
  { segment: "dashboard", label: "Resumen", icon: LayoutDashboard },
  { segment: "catalog", label: "Candidaturas", icon: Users },
  { segment: "orchestration", label: "Fases", icon: Workflow },
  { segment: "evidence", label: "Evidencia", icon: FileCheck },
  { segment: "logs", label: "Bitácora", icon: ScrollText },
];

export function ElectionTabs({ electionIdStr }: { electionIdStr: string }) {
  const pathname = usePathname();
  const basePath = `/elections/${electionIdStr}`;

  return (
    <div className="election-tabs">
      {TABS.map(({ segment, label, icon: Icon }) => {
        const isActive = pathname.includes(`/${segment}`);
        return (
          <Link
            key={segment}
            href={`${basePath}/${segment}`}
            className={`election-tab ${isActive ? "active" : ""}`}
          >
            <Icon size={16} />
            {label}
          </Link>
        );
      })}
    </div>
  );
}
