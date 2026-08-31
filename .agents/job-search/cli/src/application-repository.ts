import type { ApplicationRecord } from "./applications"

export type ApplicationRepositoryErrorCode =
  | "NOT_FOUND"
  | "DUPLICATE_ID"
  | "READ_FAILURE"
  | "WRITE_FAILURE"
  | "CORRUPT_STORAGE"
  | "UNSUPPORTED_SCHEMA_VERSION"
  | "INVALID_RECORD"

export interface ApplicationRepositoryError {
  code: ApplicationRepositoryErrorCode
  message: string
}

export type ApplicationRepositoryResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: ApplicationRepositoryError }

/** Storage boundary only: application-domain operations happen before persistence. */
export interface ApplicationRepository {
  create(record: ApplicationRecord): Promise<ApplicationRepositoryResult<ApplicationRecord>>
  save(record: ApplicationRecord): Promise<ApplicationRepositoryResult<ApplicationRecord>>
  getById(id: string): Promise<ApplicationRepositoryResult<ApplicationRecord>>
  list(): Promise<ApplicationRepositoryResult<ApplicationRecord[]>>
}
