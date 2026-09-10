import { loadInterviewHistory, loadInterviewOverview } from "@/lib/interview-data";
import { InterviewOverviewView } from "./overview";
import { configuredAuthorizationDependencies, requireOwnedApplication } from "@/lib/authorization";

export const dynamic = "force-dynamic";

export default async function ApplicationInterviewPage({ params }: {
  params: Promise<{ applicationId: string }>;
}) {
  // Next.js route parameters are already decoded. Preserve the exact identifier.
  const { applicationId } = await params;
  const authorization = configuredAuthorizationDependencies();
  const owned = authorization.ok ? await requireOwnedApplication(applicationId, authorization.value) : authorization;
  if (!owned.ok) return <main><h1>Intervjun kunde inte visas</h1></main>;
  const result = await loadInterviewOverview(applicationId);
  const history = await loadInterviewHistory(applicationId);
  return <InterviewOverviewView applicationId={applicationId} result={result} history={history} />;
}
