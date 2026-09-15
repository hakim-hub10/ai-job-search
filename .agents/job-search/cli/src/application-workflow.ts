import {
  addApplicationNote,
  createApplication,
  findDuplicateApplications,
  reanalyzeApplication,
  updateApplicationStatus,
  type AddApplicationNoteInput,
  type ApplicationDomainError,
  type ApplicationDuplicateMatch,
  type ApplicationRecord,
  type ApplicationResult,
  type CreateApplicationInput,
  type ReanalyzeApplicationInput,
  type UpdateApplicationStatusInput,
} from "./applications"
import type {
  ApplicationRepository,
  ApplicationRepositoryError,
  ApplicationRepositoryResult,
} from "./application-repository"

export interface StartApplicationInput extends CreateApplicationInput {
  allowDuplicate?: boolean
}

export interface UpdateApplicationStatusAndSaveInput extends UpdateApplicationStatusInput {
  applicationId: string
}

export interface AddApplicationNoteAndSaveInput extends AddApplicationNoteInput {
  applicationId: string
}

export interface ReanalyzeApplicationAndSaveInput extends ReanalyzeApplicationInput {
  applicationId: string
}

export type ApplicationWorkflowError =
  | { kind: "duplicate_advisory"; duplicates: ApplicationDuplicateMatch[] }
  | { kind: "domain"; error: ApplicationDomainError }
  | { kind: "repository"; error: ApplicationRepositoryError }

export type ApplicationWorkflowResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: ApplicationWorkflowError }

export interface ApplicationWorkflow {
  startApplication(input: StartApplicationInput): Promise<ApplicationWorkflowResult<ApplicationRecord>>
  updateApplicationStatusAndSave(input: UpdateApplicationStatusAndSaveInput): Promise<ApplicationWorkflowResult<ApplicationRecord>>
  addApplicationNoteAndSave(input: AddApplicationNoteAndSaveInput): Promise<ApplicationWorkflowResult<ApplicationRecord>>
  /** Loads the application, replaces only its analysisSnapshot via reanalyzeApplication, and saves - the application's jobSnapshot and status/notes history are always preserved untouched. */
  reanalyzeApplicationAndSave(input: ReanalyzeApplicationAndSaveInput): Promise<ApplicationWorkflowResult<ApplicationRecord>>
}

function fromDomain<T>(result: ApplicationResult<T>): ApplicationWorkflowResult<T> {
  return result.ok ? result : { ok: false, error: { kind: "domain", error: result.error } }
}

function fromRepository<T>(result: ApplicationRepositoryResult<T>): ApplicationWorkflowResult<T> {
  return result.ok ? result : { ok: false, error: { kind: "repository", error: result.error } }
}

/**
 * Thin local-MVP coordinator. It intentionally inherits the repository's
 * single-writer read → domain operation → save limitation.
 */
export function createApplicationWorkflow(repository: ApplicationRepository): ApplicationWorkflow {
  return {
    async startApplication(input) {
      const listed = await repository.list()
      if (!listed.ok) return fromRepository(listed)

      const duplicates = findDuplicateApplications(listed.value, input.rankedJob)
      if (duplicates.length > 0 && input.allowDuplicate !== true) {
        return { ok: false, error: { kind: "duplicate_advisory", duplicates: structuredClone(duplicates) } }
      }

      const created = createApplication(input)
      if (!created.ok) return fromDomain(created)
      return fromRepository(await repository.create(created.value))
    },

    async updateApplicationStatusAndSave(input) {
      const loaded = await repository.getById(input.applicationId)
      if (!loaded.ok) return fromRepository(loaded)
      const updated = updateApplicationStatus(loaded.value, input)
      if (!updated.ok) return fromDomain(updated)
      return fromRepository(await repository.save(updated.value))
    },

    async addApplicationNoteAndSave(input) {
      const loaded = await repository.getById(input.applicationId)
      if (!loaded.ok) return fromRepository(loaded)
      const updated = addApplicationNote(loaded.value, input)
      if (!updated.ok) return fromDomain(updated)
      return fromRepository(await repository.save(updated.value))
    },

    async reanalyzeApplicationAndSave(input) {
      const loaded = await repository.getById(input.applicationId)
      if (!loaded.ok) return fromRepository(loaded)
      const updated = reanalyzeApplication(loaded.value, input)
      if (!updated.ok) return fromDomain(updated)
      return fromRepository(await repository.save(updated.value))
    },
  }
}
