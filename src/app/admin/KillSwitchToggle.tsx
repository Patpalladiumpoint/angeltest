"use client";

import { useState } from "react";

export function KillSwitchToggle({ initialEnabled }: { initialEnabled: boolean }) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [pending, setPending] = useState(false);

  async function toggle() {
    const next = !enabled;
    const reason = window.prompt(
      next
        ? "Reason for re-enabling outbound sends:"
        : "Reason for halting all outbound sends:",
    );
    if (!reason) return;

    setPending(true);
    try {
      const res = await fetch("/api/admin/kill-switch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: next, reason }),
      });
      if (!res.ok) throw new Error(await res.text());
      setEnabled(next);
    } finally {
      setPending(false);
    }
  }

  return (
    <section>
      <h2>Outbound sending</h2>
      <p>
        Status: <strong>{enabled ? "Enabled" : "Halted"}</strong>
      </p>
      <button onClick={toggle} disabled={pending}>
        {enabled ? "Halt all outbound sends" : "Resume outbound sends"}
      </button>
    </section>
  );
}
