import { listApplicationInterviewPreparations } from "@/lib/interview-preparation-data";
import { PreparationCreateView } from "../preparation-views";
import { createPreparationAction } from "./actions";
import { configuredAuthorizationDependencies, requireOwnedApplication } from "@/lib/authorization";
export const dynamic = "force-dynamic";
export default async function Page({ params, searchParams }: {
  params: Promise<{ applicationId: string }>;
  searchParams: Promise<{ error?: string | string[] }>;
}) {
  const { applicationId } = await params;
  const authorization = configuredAuthorizationDependencies();
  const owned = authorization.ok ? await requireOwnedApplication(applicationId, authorization.value) : authorization;
  if (!owned.ok) return <main><h1>Förberedelserna kunde inte visas</h1></main>;
  const { error } = await searchParams;
  return <PreparationCreateView applicationId={applicationId} result={await listApplicationInterviewPreparations(applicationId)}
    action={createPreparationAction} error={typeof error === "string" ? error : undefined} />;
}
