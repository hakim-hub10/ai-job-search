import { loadApplicationInterviewPreparation } from "@/lib/interview-preparation-data";
import { PreparationDetailView } from "../../preparation-views";
import { startMockInterviewAction } from "../../sessions/actions";
import { configuredAuthorizationDependencies, requireOwnedInterviewPreparation } from "../../../../../../lib/authorization";
export const dynamic = "force-dynamic";
export default async function Page({ params, searchParams }: {
  params: Promise<{ applicationId: string; preparationId: string }>;
  searchParams: Promise<{ startError?: string | string[] }>;
}) {
  const { applicationId, preparationId } = await params;
  const authorization = configuredAuthorizationDependencies();
  const owned = authorization.ok ? await requireOwnedInterviewPreparation(preparationId, authorization.value) : authorization;
  if (!owned.ok || owned.value.application.id !== applicationId) return <main><h1>Förberedelsen kunde inte visas</h1></main>;
  const { startError } = await searchParams;
  return <PreparationDetailView applicationId={applicationId} result={await loadApplicationInterviewPreparation(applicationId, preparationId)}
    startAction={startMockInterviewAction} startError={typeof startError === "string" ? startError : undefined} />;
}
