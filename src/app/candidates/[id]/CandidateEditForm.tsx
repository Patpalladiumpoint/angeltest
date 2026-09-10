"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateCandidateAction } from "@/candidates/actions";

interface Firm {
  id: string;
  canonicalName: string;
}

interface CandidateEditable {
  id: string;
  fullName: string;
  preferredName: string | null;
  currentTitle: string | null;
  currentFirmRaw: string | null;
  resolvedFirmId: string | null;
  linkedinUrl: string | null;
  specialty: string | null;
  location: string | null;
  seniority: string | null;
  summary: string | null;
}

export function CandidateEditForm({ candidate, firms }: { candidate: CandidateEditable; firms: Firm[] }) {
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  if (!editing) {
    return <button onClick={() => setEditing(true)}>Edit</button>;
  }

  function onSubmit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const result = await updateCandidateAction(candidate.id, formData);
      if (!result.ok) {
        setError(result.error ?? "Could not save changes");
      } else {
        setEditing(false);
        router.refresh();
      }
    });
  }

  return (
    <form action={onSubmit}>
      <div>
        <label>
          Full name <input name="fullName" defaultValue={candidate.fullName} required />
        </label>
      </div>
      <div>
        <label>
          Preferred name <input name="preferredName" defaultValue={candidate.preferredName ?? ""} />
        </label>
      </div>
      <div>
        <label>
          Current title <input name="currentTitle" defaultValue={candidate.currentTitle ?? ""} />
        </label>
      </div>
      <div>
        <label>
          Current firm (free text)
          <input name="currentFirmRaw" defaultValue={candidate.currentFirmRaw ?? ""} />
        </label>
      </div>
      <div>
        <label>
          Resolved firm (picking one here overrides the automatic resolver)
          <select name="resolvedFirmId" defaultValue={candidate.resolvedFirmId ?? ""}>
            <option value="">— let the resolver decide —</option>
            {firms.map((f) => (
              <option key={f.id} value={f.id}>
                {f.canonicalName}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div>
        <label>
          Specialty <input name="specialty" defaultValue={candidate.specialty ?? ""} />
        </label>
      </div>
      <div>
        <label>
          Location <input name="location" defaultValue={candidate.location ?? ""} />
        </label>
      </div>
      <div>
        <label>
          Seniority <input name="seniority" defaultValue={candidate.seniority ?? ""} />
        </label>
      </div>
      <div>
        <label>
          LinkedIn URL <input name="linkedinUrl" defaultValue={candidate.linkedinUrl ?? ""} />
        </label>
      </div>
      <div>
        <label>
          Summary <textarea name="summary" defaultValue={candidate.summary ?? ""} />
        </label>
      </div>
      <button type="submit" disabled={pending}>
        {pending ? "Saving..." : "Save"}
      </button>
      <button type="button" onClick={() => setEditing(false)} disabled={pending}>
        Cancel
      </button>
      {error && <p role="alert">{error}</p>}
    </form>
  );
}
