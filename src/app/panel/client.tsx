"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

/** Copies a value, with a moment of feedback. */
export function Copy({ value }: { value: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="copy"
      aria-label={`Copy ${value}`}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setDone(true);
          setTimeout(() => setDone(false), 1200);
        } catch {
          // Clipboard blocked: the value is on screen to select by hand.
        }
      }}
    >
      {done ? "Copied" : "Copy"}
    </button>
  );
}

/** Re-reads the page every few seconds while on, to watch a sync arrive. */
export function LiveRefresh({ seconds = 3 }: { seconds?: number }) {
  const router = useRouter();
  const [on, setOn] = useState(true);
  useEffect(() => {
    if (!on) return;
    const t = setInterval(() => router.refresh(), seconds * 1000);
    return () => clearInterval(t);
  }, [on, router, seconds]);
  return (
    <label className="toggle">
      <input type="checkbox" checked={on} onChange={(e) => setOn(e.target.checked)} /> Update every {seconds} seconds
    </label>
  );
}
