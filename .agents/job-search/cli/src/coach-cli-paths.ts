import { join } from "node:path"

export interface CoachRepositoryPaths {
  candidates: string
  candidateProfiles: string
  associations: string
  followUps: string
  operations: string
}

export function resolveCoachRepositoryPaths(coachDir: string): CoachRepositoryPaths {
  return {
    candidates: join(coachDir, "candidates.json"),
    candidateProfiles: join(coachDir, "candidate-profiles.json"),
    associations: join(coachDir, "associations.json"),
    followUps: join(coachDir, "follow-ups.json"),
    operations: join(coachDir, "operations.json"),
  }
}