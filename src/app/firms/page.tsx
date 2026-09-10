import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/auth/config";
import { listFirms } from "@/candidates/queries";
import { createFirmAction } from "@/firms/actions";

export default async function FirmsPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/sign-in");

  const firms = await listFirms();

  return (
    <main>
      <h1>Firms</h1>

      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Top 100 rank</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {firms.map((f) => (
            <tr key={f.id}>
              <td>
                <Link href={`/firms/${f.id}`}>{f.canonicalName}</Link>
              </td>
              <td>{f.top100Rank ?? "—"}</td>
              <td>{f.status}</td>
            </tr>
          ))}
          {firms.length === 0 && (
            <tr>
              <td colSpan={3}>No firms yet.</td>
            </tr>
          )}
        </tbody>
      </table>

      <h2>Add a firm</h2>
      <form action={createFirmAction}>
        <div>
          <label>
            Canonical name <input name="canonicalName" required />
          </label>
        </div>
        <div>
          <label>
            Top 100 rank <input name="top100Rank" type="number" min="1" max="100" />
          </label>
        </div>
        <button type="submit">Add firm</button>
      </form>

      <p>
        <Link href="/candidates">Back to candidates</Link>
      </p>
    </main>
  );
}
