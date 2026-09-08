"use server";
import { redirect } from "next/navigation";
import { startApplicationMockInterview } from "@/lib/mock-interview-data";
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
