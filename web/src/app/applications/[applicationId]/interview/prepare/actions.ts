"use server";
import { redirect } from "next/navigation";
import { createApplicationInterviewPreparation } from "@/lib/interview-preparation-data";
import { preparationPath } from "@/lib/interview-preparation-presentation";

export async function createPreparationAction(formData: FormData) {
  const applicationId = formData.get("applicationId");
  const result = await createApplicationInterviewPreparation({ applicationId,
    language: formData.get("language"), interviewType: formData.get("interviewType") });
  if (!result.ok) {
    if (typeof applicationId !== "string" || !applicationId.trim()) redirect("/applications");
    redirect(`${preparationPath(applicationId)}?error=${result.code}`);
  }
  redirect(preparationPath(result.value.applicationId, result.value.preparationId));
}
