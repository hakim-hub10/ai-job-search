import { loadApplicationMockInterview } from "@/lib/mock-interview-data";
import { MockInterviewView } from "../overview";
export const dynamic = "force-dynamic";
export default async function Page({ params }: { params: Promise<{ applicationId: string; sessionId: string }> }) {
  const { applicationId, sessionId } = await params;
  return <MockInterviewView applicationId={applicationId} result={await loadApplicationMockInterview(applicationId, sessionId)} />;
}
