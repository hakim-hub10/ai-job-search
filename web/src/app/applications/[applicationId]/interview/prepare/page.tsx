import { listApplicationInterviewPreparations } from "@/lib/interview-preparation-data";
import { PreparationCreateView } from "../preparation-views";
import { createPreparationAction } from "./actions";
export const dynamic = "force-dynamic";
export default async function Page({ params, searchParams }: {
  params: Promise<{ applicationId: string }>;
  searchParams: Promise<{ error?: string | string[] }>;
}) {
  const { applicationId } = await params;
  const { error } = await searchParams;
  return <PreparationCreateView applicationId={applicationId} result={await listApplicationInterviewPreparations(applicationId)}
    action={createPreparationAction} error={typeof error === "string" ? error : undefined} />;
}
