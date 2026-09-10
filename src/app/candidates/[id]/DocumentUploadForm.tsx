"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { uploadDocumentAction } from "@/documents/actions";

export function DocumentUploadForm({ candidateId }: { candidateId: string }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);
  const router = useRouter();

  function onSubmit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const result = await uploadDocumentAction(formData);
      if (!result.ok) {
        setError(result.error ?? "Upload failed");
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
        <select name="docType" defaultValue="resume">
          <option value="resume">Resume</option>
          <option value="attachment">Attachment</option>
          <option value="note_file">Note file</option>
        </select>
      </label>
      <input type="file" name="file" required />
      <button type="submit" disabled={pending}>
        {pending ? "Uploading..." : "Upload"}
      </button>
      {error && <p role="alert">{error}</p>}
    </form>
  );
}
