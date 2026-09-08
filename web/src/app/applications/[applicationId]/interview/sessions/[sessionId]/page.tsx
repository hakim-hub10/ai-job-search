import { loadApplicationMockInterview } from "@/lib/mock-interview-data";
import { MockInterviewView } from "../overview";
import { skipMockInterviewQuestionAction, submitMockInterviewAnswerAction } from "../actions";
export const dynamic = "force-dynamic";
export default async function Page({ params, searchParams }: { params: Promise<{ applicationId: string; sessionId: string }>; searchParams: Promise<{ answerError?: string | string[]; skipError?: string | string[] }> }) {
  const { applicationId, sessionId } = await params;
  const { answerError, skipError } = await searchParams;
  return <MockInterviewView applicationId={applicationId} result={await loadApplicationMockInterview(applicationId, sessionId)} showAnswerForm answerAction={submitMockInterviewAnswerAction} skipAction={skipMockInterviewQuestionAction}
    answerError={typeof answerError === "string" ? answerError : undefined} skipError={typeof skipError === "string" ? skipError : undefined} />;
}
