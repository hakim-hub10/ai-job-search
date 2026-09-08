import { loadApplicationInterviewPreparation } from "@/lib/interview-preparation-data";
import { PreparationDetailView } from "../../preparation-views";
import { startMockInterviewAction } from "../../sessions/actions";
export const dynamic = "force-dynamic";
export default async function Page({ params, searchParams }: {
  params: Promise<{ applicationId: string; preparationId: string }>;
  searchParams: Promise<{ startError?: string | string[] }>;
}) {
  const { applicationId, preparationId } = await params;
  const { startError } = await searchParams;
  return <PreparationDetailView applicationId={applicationId} result={await loadApplicationInterviewPreparation(applicationId, preparationId)}
    startAction={startMockInterviewAction} startError={typeof startError === "string" ? startError : undefined} />;
}
