"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { logContactAction } from "@/candidates/actions";

export function LogContactForm({
  candidateId,
  disabled,
}: {
  candidateId: string;
  disabled: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);
  const router = useRouter();

  function onSubmit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const result = await logContactAction(formData);
      if (!result.ok) {
        setError(result.error ?? "Could not log this contact");
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
        Channel
        <select name="channel" defaultValue="email">
          <option value="email">Email</option>
          <option value="call">Call</option>
          <option value="linkedin">LinkedIn</option>
          <option value="note">Note</option>
        </select>
      </label>
      <label>
        Outcome <input name="outcome" placeholder="optional" />
      </label>
      <button type="submit" disabled={disabled || pending}>
        {pending ? "Logging..." : "Log contact"}
      </button>
      {error && <p role="alert">{error}</p>}
    </form>
  );
}
