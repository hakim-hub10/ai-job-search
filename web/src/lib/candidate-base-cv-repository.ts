import type { CandidateBaseCv } from "./candidate-base-cv";

export type CandidateBaseCvRepositoryErrorCode =
  | "NOT_FOUND"
  | "READ_FAILURE"
  | "WRITE_FAILURE"
  | "CORRUPT_STORAGE"
  | "UNSUPPORTED_SCHEMA_VERSION"
  | "INVALID_RECORD";

export interface CandidateBaseCvRepositoryError {
  code: CandidateBaseCvRepositoryErrorCode;
  message: string;
}

export type CandidateBaseCvRepositoryResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: CandidateBaseCvRepositoryError };

export interface CandidateBaseCvRepository {
  save(baseCv: CandidateBaseCv): Promise<CandidateBaseCvRepositoryResult<CandidateBaseCv>>;
  getByCandidateId(candidateId: string): Promise<CandidateBaseCvRepositoryResult<CandidateBaseCv>>;
}
