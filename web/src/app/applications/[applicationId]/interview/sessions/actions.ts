"use server";
import { redirect } from "next/navigation";
import { skipApplicationMockInterviewQuestion, startApplicationMockInterview, submitApplicationMockInterviewAnswer } from "@/lib/mock-interview-data";
import { mockInterviewPath } from "@/lib/mock-interview-presentation";
import { preparationPath } from "@/lib/interview-preparation-presentation";
export async function startMockInterviewAction(data: FormData) {
  const applicationId = data.get("applicationId"), preparationId = data.get("preparationId");
  const result = await startApplicationMockInterview({ applicationId, preparationId });
  if (!result.ok) {
    if (typeof applicationId !== "string" || !applicationId.trim() || typeof preparationId !== "string" || !preparationId.trim()) redirect("/applications");
    redirect(`${preparationPath(applicationId, preparationId)}?startError=${result.code}`);
  }
  redirect(mockInterviewPath(result.value.application.applicationId, result.value.session.sessionId));
}
function progressErrorPath(applicationId: FormDataEntryValue | null, sessionId: FormDataEntryValue | null, key: "answerError" | "skipError", code: string) {
  if (typeof applicationId !== "string" || !applicationId.trim() || typeof sessionId !== "string" || !sessionId.trim()) return "/applications";
  return `${mockInterviewPath(applicationId, sessionId)}?${key}=${encodeURIComponent(code)}`;
}
export async function submitMockInterviewAnswerAction(data: FormData) {
  const applicationId = data.get("applicationId"), sessionId = data.get("sessionId"), expectedQuestionId = data.get("expectedQuestionId");
  const result = await submitApplicationMockInterviewAnswer({ applicationId, sessionId, expectedQuestionId, fields: {
    format: data.get("format"), text: data.get("text"),
  } });
  if (!result.ok) redirect(progressErrorPath(applicationId, sessionId, "answerError", result.code));
  redirect(mockInterviewPath(result.value.application.applicationId, result.value.session.sessionId));
}
export async function skipMockInterviewQuestionAction(data: FormData) {
  const applicationId = data.get("applicationId"), sessionId = data.get("sessionId"), expectedQuestionId = data.get("expectedQuestionId");
  const result = await skipApplicationMockInterviewQuestion({ applicationId, sessionId, expectedQuestionId });
  if (!result.ok) redirect(progressErrorPath(applicationId, sessionId, "skipError", result.code));
  redirect(mockInterviewPath(result.value.application.applicationId, result.value.session.sessionId));
}
