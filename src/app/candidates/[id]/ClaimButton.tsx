"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { claimCandidateAction } from "@/candidates/actions";

export function ClaimButton({ candidateId }: { candidateId: string }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function claim() {
    setError(null);
    startTransition(async () => {
      const result = await claimCandidateAction(candidateId);
      if (!result.ok) {
        setError(result.error ?? "Could not claim this candidate");
      } else {
        router.refresh();
      }
    });
  }

  return (
    <div>
      <button onClick={claim} disabled={pending}>
        {pending ? "Claiming..." : "Claim this candidate"}
      </button>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
