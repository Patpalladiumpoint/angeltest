"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { unmergeCandidatesAction } from "@/candidates/actions";

export function UnmergeButton({ candidateId }: { candidateId: string }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function unmerge() {
    const reason = window.prompt("Reason for unmerging this candidate:");
    if (!reason) return;
    setError(null);
    startTransition(async () => {
      const result = await unmergeCandidatesAction(candidateId, reason);
      if (!result.ok) {
        setError(result.error ?? "Could not unmerge");
      } else {
        router.refresh();
      }
    });
  }

  return (
    <div>
      <button onClick={unmerge} disabled={pending}>
        {pending ? "Restoring..." : "Undo this merge"}
      </button>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
