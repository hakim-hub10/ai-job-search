import { redirect } from "next/navigation";
import { configuredAuthorizationDependencies, getAuthorizedCandidateContext } from "@/lib/authorization";

export const dynamic = "force-dynamic";

export default async function PersonalEntryPage() {
  const dependencies = configuredAuthorizationDependencies();
  const owned = dependencies.ok ? await getAuthorizedCandidateContext(dependencies.value) : dependencies;
  if (!owned.ok) return <main><h1>Vyn kunde inte visas</h1><p>Logga in för att öppna din personliga vy.</p></main>;
  redirect(`/reports/${encodeURIComponent(owned.value.candidate.id)}`);
}
