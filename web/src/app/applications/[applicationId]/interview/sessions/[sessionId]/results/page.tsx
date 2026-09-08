import { loadApplicationMockInterviewFeedback } from "@/lib/mock-interview-data";
import { MockInterviewResultsView } from "../../results-view";
export const dynamic = "force-dynamic";
export default async function Page({ params }: { params: Promise<{ applicationId: string; sessionId: string }> }) {
  const { applicationId, sessionId } = await params;
  return <MockInterviewResultsView applicationId={applicationId} result={await loadApplicationMockInterviewFeedback(applicationId, sessionId)} />;
}
