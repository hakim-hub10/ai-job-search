import { loadApplicationMockInterviewFeedback } from "@/lib/mock-interview-data";
import { MockInterviewResultsView } from "../../results-view";
import { configuredAuthorizationDependencies, requireOwnedInterviewSession } from "@/lib/authorization";
export const dynamic = "force-dynamic";
export default async function Page({ params }: { params: Promise<{ applicationId: string; sessionId: string }> }) {
  const { applicationId, sessionId } = await params;
  const authorization = configuredAuthorizationDependencies();
  const owned = authorization.ok ? await requireOwnedInterviewSession(sessionId, applicationId, authorization.value) : authorization;
  if (!owned.ok) return <main><h1>Intervjun kunde inte visas</h1></main>;
  return <MockInterviewResultsView applicationId={applicationId} result={await loadApplicationMockInterviewFeedback(applicationId, sessionId)} />;
}
