"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export function LiveRefresh({
  label = "Panel en vivo",
  intervalMs = 15000,
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
    <div className="badge badge-valid">
      {label} · {Math.round(intervalMs / 1000)}s{lastRefreshAt ? ` · ${lastRefreshAt.toLocaleTimeString()}` : ""}
    </div>
  );
}
