"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export function LiveRefresh({
  label = "Actualización automática",
  intervalMs = 12000,
}: {
  label?: string;
  intervalMs?: number;
}) {
  const router = useRouter();
  const [lastRefreshAt, setLastRefreshAt] = useState<Date | null>(null);

  useEffect(() => {
    const interval = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      router.refresh();
      setLastRefreshAt(new Date());
    }, intervalMs);
    return () => window.clearInterval(interval);
  }, [intervalMs, router]);

  return (
    <div className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-[11px] font-semibold text-emerald-800">
      {label}: {Math.round(intervalMs / 1000)}s{lastRefreshAt ? ` · ${lastRefreshAt.toLocaleTimeString()}` : ""}
    </div>
  );
}
