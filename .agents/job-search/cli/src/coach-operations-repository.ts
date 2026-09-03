import type { CoachActivity } from "./coach-activity"
import type { CoachGoal } from "./coach-goal"
import type { CoachNote } from "./coach-note"

export type CoachOperationsRepositoryErrorCode = "NOT_FOUND" | "DUPLICATE_ID" | "READ_FAILURE" | "WRITE_FAILURE" | "CORRUPT_STORAGE" | "UNSUPPORTED_SCHEMA_VERSION" | "INVALID_RECORD"
export interface CoachOperationsRepositoryError { code: CoachOperationsRepositoryErrorCode; message: string }
export type CoachOperationsRepositoryResult<T> = { ok: true; value: T } | { ok: false; error: CoachOperationsRepositoryError }

export interface CoachOperationsRepository {
  createNote(note: CoachNote): Promise<CoachOperationsRepositoryResult<CoachNote>>
  getNoteById(id: string): Promise<CoachOperationsRepositoryResult<CoachNote>>
  listNotesByCandidateId(candidateId: string): Promise<CoachOperationsRepositoryResult<CoachNote[]>>
  saveNote(note: CoachNote): Promise<CoachOperationsRepositoryResult<CoachNote>>
  createGoal(goal: CoachGoal): Promise<CoachOperationsRepositoryResult<CoachGoal>>
  getGoalById(id: string): Promise<CoachOperationsRepositoryResult<CoachGoal>>
  listGoalsByCandidateId(candidateId: string): Promise<CoachOperationsRepositoryResult<CoachGoal[]>>
  saveGoal(goal: CoachGoal): Promise<CoachOperationsRepositoryResult<CoachGoal>>
  createActivity(activity: CoachActivity): Promise<CoachOperationsRepositoryResult<CoachActivity>>
  getActivityById(id: string): Promise<CoachOperationsRepositoryResult<CoachActivity>>
  listActivitiesByCandidateId(candidateId: string): Promise<CoachOperationsRepositoryResult<CoachActivity[]>>
  saveActivity(activity: CoachActivity): Promise<CoachOperationsRepositoryResult<CoachActivity>>
}