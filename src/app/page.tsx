import { redirect } from "next/navigation";
import { getCurrentActor } from "@/auth/session";

export default async function HomePage() {
  const actor = await getCurrentActor();
  redirect(actor ? "/dashboard" : "/sign-in");
}
