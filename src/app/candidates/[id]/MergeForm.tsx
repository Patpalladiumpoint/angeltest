"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { mergeCandidatesAction } from "@/candidates/actions";

interface Duplicate {
  id: string;
  fullName: string;
  currentTitle: string | null;
}

// spec 3.6: "Merges and deletions are soft and reversible for 90 days...
// Assume someone will fat-finger a merge of two senior candidates and need
// it undone." A reason is required and everything is audit-logged so that
// "undo" has something to point at.
export function MergeForm({ candidateId, duplicates }: { candidateId: string; duplicates: Duplicate[] }) {
  const [targetId, setTargetId] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  if (duplicates.length === 0) {
    return <p>No other candidates share this exact name.</p>;
  }

  function merge() {
    if (!targetId) {
      setError("Pick which record to keep");
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await mergeCandidatesAction(candidateId, targetId, reason);
      if (!result.ok) {
        setError(result.error ?? "Could not merge");
      } else {
        router.push(`/candidates/${targetId}`);
      }
    });
  }

  return (
    <div>
      <p>Possible duplicates with the same name:</p>
      <ul>
        {duplicates.map((d) => (
          <li key={d.id}>
            <label>
              <input
                type="radio"
                name="mergeTarget"
                value={d.id}
                onChange={() => setTargetId(d.id)}
              />
              {d.fullName} {d.currentTitle && `— ${d.currentTitle}`}
            </label>
          </li>
        ))}
      </ul>
      <label>
        Reason <input value={reason} onChange={(e) => setReason(e.target.value)} required />
      </label>
      <button onClick={merge} disabled={pending}>
        {pending ? "Merging..." : "Merge this record into the one selected above"}
      </button>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
