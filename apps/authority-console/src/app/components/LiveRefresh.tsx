"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export function LiveRefresh({
  label = "Actualización automática",
  intervalMs = 15000,
}: {
  label?: string;
  intervalMs?: number;
}) {
  const router = useRouter();
  const [lastRefreshAt, setLastRefreshAt] = useState<Date | null>(null);

  useEffect(() => {
    const interval = window.setInterval(() => {
      const activeTag = document.activeElement?.tagName?.toLowerCase();
      const isEditing =
        activeTag === "input" ||
        activeTag === "textarea" ||
        activeTag === "select" ||
        document.activeElement?.getAttribute("contenteditable") === "true";

      if (document.visibilityState !== "visible" || isEditing) {
        return;
      }

      router.refresh();
      setLastRefreshAt(new Date());
    }, intervalMs);

    return () => window.clearInterval(interval);
  }, [intervalMs, router]);

  return (
    <div className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-[11px] font-semibold text-emerald-800">
      {label}: cada {Math.round(intervalMs / 1000)}s{lastRefreshAt ? ` · última ${lastRefreshAt.toLocaleTimeString()}` : ""}
    </div>
  );
}
