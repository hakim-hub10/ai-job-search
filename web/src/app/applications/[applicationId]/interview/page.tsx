import { loadInterviewHistory, loadInterviewOverview } from "@/lib/interview-data";
import { InterviewOverviewView } from "./overview";

export const dynamic = "force-dynamic";

export default async function ApplicationInterviewPage({ params }: {
  params: Promise<{ applicationId: string }>;
}) {
  // Next.js route parameters are already decoded. Preserve the exact identifier.
  const { applicationId } = await params;
  const result = await loadInterviewOverview(applicationId);
  const history = await loadInterviewHistory(applicationId);
  return <InterviewOverviewView applicationId={applicationId} result={result} history={history} />;
}
