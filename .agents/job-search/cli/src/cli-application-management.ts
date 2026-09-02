import type { ApplicationRepository } from "./application-repository"
import { createApplicationWorkflow, type ApplicationWorkflowResult } from "./application-workflow"
import type { ApplicationRecord, ApplicationStatus } from "./applications"

export interface ApplicationStatusManagementInput {
  applicationId: string
  status: ApplicationStatus
  timestamp: string
}

export interface ApplicationNoteManagementInput {
  applicationId: string
  text: string
  timestamp: string
}

export function updateManagedApplicationStatus(
  repository: ApplicationRepository,
  input: ApplicationStatusManagementInput,
): Promise<ApplicationWorkflowResult<ApplicationRecord>> {
  return createApplicationWorkflow(repository).updateApplicationStatusAndSave({
    applicationId: input.applicationId,
    status: input.status,
    timestamp: input.timestamp,
  })
}

export function appendManagedApplicationNote(
  repository: ApplicationRepository,
  input: ApplicationNoteManagementInput,
): Promise<ApplicationWorkflowResult<ApplicationRecord>> {
  return createApplicationWorkflow(repository).addApplicationNoteAndSave({
    applicationId: input.applicationId,
    text: input.text,
    createdAt: input.timestamp,
  })
}

export function formatStatusUpdateConfirmation(input: ApplicationStatusManagementInput): string {
  return `Application ${input.applicationId} status updated to ${input.status} at ${input.timestamp}.`
}

export function formatNoteAppendConfirmation(input: Pick<ApplicationNoteManagementInput, "applicationId" | "timestamp">): string {
  return `Application ${input.applicationId} note added at ${input.timestamp}.`
}
