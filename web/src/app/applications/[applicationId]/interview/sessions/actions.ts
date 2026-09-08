"use server";
import { redirect } from "next/navigation";
import { requestInterviewAiCoaching, skipApplicationMockInterviewQuestion, startApplicationMockInterview, submitApplicationMockInterviewAnswer } from "@/lib/mock-interview-data";
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
export async function submitMockInterviewAnswerAction(previousState: unknown, data: FormData) {
  const applicationId = data.get("applicationId"), sessionId = data.get("sessionId"), expectedQuestionId = data.get("expectedQuestionId");
  const format = data.get("format"), text = data.get("text"), mode = data.get("mode");
  if (mode !== "deterministic" && mode !== "ai") return { ok: false as const, code: "INVALID_ANSWER" as const, message: "Skriv ett svar i ett format som kan behandlas." };
  if (mode === "ai" && data.get("aiConsent") !== "on") return { ok: false as const, code: "AI_CONSENT_REQUIRED" as const, message: "AI-stöd kräver ett uttryckligt godkännande för just denna åtgärd." };
  const result = await submitApplicationMockInterviewAnswer({ applicationId, sessionId, expectedQuestionId, fields: {
    format, text,
  } });
  if (!result.ok) redirect(progressErrorPath(applicationId, sessionId, "answerError", result.code));
  if (mode === "ai" && typeof applicationId === "string" && typeof sessionId === "string" && typeof expectedQuestionId === "string" && typeof text === "string") {
    const coaching = await requestInterviewAiCoaching({ applicationId, sessionId, questionId: expectedQuestionId,
      answer: { questionId: expectedQuestionId, format: "freeText", text }, consent: true });
    if (!coaching.ok) return coaching;
    return coaching;
  }
  redirect(mockInterviewPath(result.value.application.applicationId, result.value.session.sessionId));
}
export async function skipMockInterviewQuestionAction(data: FormData) {
  const applicationId = data.get("applicationId"), sessionId = data.get("sessionId"), expectedQuestionId = data.get("expectedQuestionId");
  const result = await skipApplicationMockInterviewQuestion({ applicationId, sessionId, expectedQuestionId });
  if (!result.ok) redirect(progressErrorPath(applicationId, sessionId, "skipError", result.code));
  redirect(mockInterviewPath(result.value.application.applicationId, result.value.session.sessionId));
}
