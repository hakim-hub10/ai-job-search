import { loadApplicationMockInterview } from "@/lib/mock-interview-data";
import { MockInterviewView } from "../overview";
import { skipMockInterviewQuestionAction, submitMockInterviewAnswerAction } from "../actions";
import { configuredAuthorizationDependencies, requireOwnedInterviewSession } from "../../../../../../lib/authorization";
export const dynamic = "force-dynamic";
export default async function Page({ params, searchParams }: { params: Promise<{ applicationId: string; sessionId: string }>; searchParams: Promise<{ answerError?: string | string[]; skipError?: string | string[] }> }) {
  const { applicationId, sessionId } = await params;
  const authorization = configuredAuthorizationDependencies();
  const owned = authorization.ok ? await requireOwnedInterviewSession(sessionId, applicationId, authorization.value) : authorization;
  if (!owned.ok) return <main><h1>Intervjun kunde inte visas</h1></main>;
  const { answerError, skipError } = await searchParams;
  return <MockInterviewView applicationId={applicationId} result={await loadApplicationMockInterview(applicationId, sessionId)} showAnswerForm answerAction={submitMockInterviewAnswerAction} skipAction={skipMockInterviewQuestionAction}
    answerError={typeof answerError === "string" ? answerError : undefined} skipError={typeof skipError === "string" ? skipError : undefined} />;
}
