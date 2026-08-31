export type WorkMode = "remote" | "hybrid" | "onsite" | "open"
export type EmploymentType = "full-time" | "part-time" | "contract" | "temporary" | "internship" | "open"

export interface CandidateProfile {
  headline: string
  targetRoles: string[]
  locationPreferences: string[]
  workMode: WorkMode
  remotePreference: boolean
  preferredIndustries: string[]
  preferredEmploymentType: EmploymentType[]
  skills: {
    technical: string[]
    soft: string[]
  }
  workExperience: Array<{
    title: string
    company: string
    location: string
    startDate?: string
    endDate?: string
    summary?: string
  }>
  education: Array<{
    degree: string
    field: string
    institution: string
    startYear?: number
    endYear?: number
  }>
  certifications: string[]
  languages: Array<{
    name: string
    level: string
  }>
  yearsOfExperience: number
  careerGoals: string[]
  summary?: string
  updatedAt?: string
}

export function createDefaultCandidateProfile(): CandidateProfile {
  return {
    headline: "Technology professional with systems, software, and operations experience",
    targetRoles: ["Software Engineer", "Platform Engineer", "IT Specialist"],
    locationPreferences: ["Jönköping, Sweden", "Remote"],
    workMode: "hybrid",
    remotePreference: true,
    preferredIndustries: ["Technology", "Manufacturing", "Public Sector"],
    preferredEmploymentType: ["full-time", "contract", "open"],
    skills: {
      technical: ["TypeScript", "Bun", "SQL", "Linux", "APIs", "Cloud"],
      soft: ["Communication", "Problem solving", "Collaboration", "Ownership"],
    },
    workExperience: [
      {
        title: "Engineer",
        company: "Example Company",
        location: "Sweden",
        summary: "Delivered software and operational improvements.",
      },
    ],
    education: [
      {
        degree: "Bachelor's or Master's degree",
        field: "Computer Science / Engineering",
        institution: "University",
      },
    ],
    certifications: ["Professional certification"],
    languages: [
      { name: "English", level: "Professional working proficiency" },
      { name: "Swedish", level: "Working proficiency" },
    ],
    yearsOfExperience: 3,
    careerGoals: ["Build reliable systems", "Grow in platform engineering", "Work with product-minded teams"],
    summary: "Candidate profile foundation for later Phase 2 matching and skill-gap analysis.",
    updatedAt: new Date().toISOString(),
  }
}

export function normalizeCandidateProfile(input: Partial<CandidateProfile>): CandidateProfile {
  const base = createDefaultCandidateProfile()
  const profile: CandidateProfile = {
    ...base,
    ...input,
    targetRoles: input.targetRoles?.length ? input.targetRoles : base.targetRoles,
    locationPreferences: input.locationPreferences?.length ? input.locationPreferences : base.locationPreferences,
    workMode: input.workMode ?? base.workMode,
    remotePreference: input.remotePreference ?? base.remotePreference,
    preferredIndustries: input.preferredIndustries?.length ? input.preferredIndustries : base.preferredIndustries,
    preferredEmploymentType: input.preferredEmploymentType?.length ? input.preferredEmploymentType : base.preferredEmploymentType,
    skills: {
      technical: input.skills?.technical?.length ? input.skills.technical : base.skills.technical,
      soft: input.skills?.soft?.length ? input.skills.soft : base.skills.soft,
    },
    workExperience: input.workExperience?.length ? input.workExperience : base.workExperience,
    education: input.education?.length ? input.education : base.education,
    certifications: input.certifications?.length ? input.certifications : base.certifications,
    languages: input.languages?.length ? input.languages : base.languages,
    careerGoals: input.careerGoals?.length ? input.careerGoals : base.careerGoals,
    yearsOfExperience: input.yearsOfExperience ?? base.yearsOfExperience,
  }

  return profile
}
