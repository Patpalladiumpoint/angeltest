"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { logActivityAction } from "@/candidates/actions";

// For recording something that already happened (a call the candidate
// initiated, a meeting note) -- distinct from LogContactForm, which is for
// a new outbound touch and goes through the 90-day collision gate. This one
// deliberately doesn't, since recording history isn't the same as
// initiating contact.
export function LogActivityForm({ candidateId }: { candidateId: string }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);
  const router = useRouter();

  function onSubmit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const result = await logActivityAction(formData);
      if (!result.ok) {
        setError(result.error ?? "Could not save");
      } else {
        formRef.current?.reset();
        router.refresh();
      }
    });
  }

  return (
    <form ref={formRef} action={onSubmit}>
      <input type="hidden" name="candidateId" value={candidateId} />
      <label>
        Type
        <select name="activityType" defaultValue="note">
          <option value="note">Note</option>
          <option value="call">Call</option>
          <option value="meeting">Meeting</option>
        </select>
      </label>
      <label>
        Subject <input name="subject" placeholder="optional" />
      </label>
      <label>
        Details <textarea name="body" placeholder="optional" />
      </label>
      <button type="submit" disabled={pending}>
        {pending ? "Saving..." : "Add to timeline"}
      </button>
      {error && <p role="alert">{error}</p>}
    </form>
  );
}
