import { loadApplicationInterviewPreparation } from "@/lib/interview-preparation-data";
import { PreparationDetailView } from "../../preparation-views";
export const dynamic = "force-dynamic";
export default async function Page({ params }: { params: Promise<{ applicationId: string; preparationId: string }> }) {
  const { applicationId, preparationId } = await params;
  return <PreparationDetailView applicationId={applicationId} result={await loadApplicationInterviewPreparation(applicationId, preparationId)} />;
}
