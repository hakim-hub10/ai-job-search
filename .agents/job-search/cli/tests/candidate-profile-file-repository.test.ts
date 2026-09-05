import { afterEach, describe, expect, it } from "bun:test"
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises"
import { dirname, join } from "node:path"
import { tmpdir } from "node:os"

import { createFileCandidateProfileRepository } from "../src/candidate-profile-file-repository"
import { parseCandidateProfile } from "../src/profile-input"

const directories: string[] = []

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  )
})

function profile(headline = "IT support technician") {
  return parseCandidateProfile({
    headline,
    targetRoles: ["IT Support"],
    locationPreferences: ["Jönköping"],
    workMode: "open",
    remotePreference: true,
    preferredIndustries: ["IT"],
    preferredEmploymentType: ["full-time"],
    skills: {
      technical: ["Microsoft 365"],
      soft: ["Communication"],
    },
    workExperience: [],
    education: [],
    certifications: [],
    languages: [
      { name: "Swedish", level: "Professional" },
      { name: "English", level: "Professional" },
    ],
    yearsOfExperience: 1,
    careerGoals: ["Work in IT support"],
  })
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "candidate-profiles-"))
  directories.push(root)

  const directory = join(root, "private")
  const path = join(directory, "candidate-profiles.json")

  return {
    root,
    directory,
    path,
    repository: createFileCandidateProfileRepository(path),
  }
}

describe("candidate profile file repository", () => {
  it("treats missing storage as empty and persists profiles deterministically", async () => {
    const { path, repository } = await fixture()

    expect(await repository.listProfiles()).toEqual({ ok: true, value: [] })

    expect((await repository.saveProfile("candidate-b", profile("Support B"))).ok).toBe(true)
    expect((await repository.saveProfile("candidate-a", profile("Support A"))).ok).toBe(true)

    expect(await repository.listProfiles()).toMatchObject({
      ok: true,
      value: [
        { candidateId: "candidate-a" },
        { candidateId: "candidate-b" },
      ],
    })

    expect(
      await createFileCandidateProfileRepository(path)
        .getProfileByCandidateId("candidate-a"),
    ).toMatchObject({
      ok: true,
      value: {
        candidateId: "candidate-a",
        profile: { headline: "Support A" },
      },
    })
  })

  it("upserts one candidate profile without creating duplicate records", async () => {
    const { repository } = await fixture()

    expect((await repository.saveProfile("candidate-a", profile("First"))).ok).toBe(true)
    expect((await repository.saveProfile("candidate-a", profile("Updated"))).ok).toBe(true)

    const listed = await repository.listProfiles()
    expect(listed).toMatchObject({
      ok: true,
      value: [
        {
          candidateId: "candidate-a",
          profile: { headline: "Updated" },
        },
      ],
    })
  })

  it("rejects invalid records without injecting candidate facts", async () => {
    const { repository } = await fixture()

    expect(
      await repository.saveProfile(
        "",
        profile(),
      ),
    ).toMatchObject({
      ok: false,
      error: { code: "INVALID_RECORD" },
    })

    expect(
      await repository.saveProfile(
        "candidate-a",
        { ...profile(), skills: { technical: ["TypeScript"] } } as never,
      ),
    ).toMatchObject({
      ok: false,
      error: { code: "INVALID_RECORD" },
    })

    expect(await repository.listProfiles()).toEqual({ ok: true, value: [] })
  })

  it("returns detached records and uses restrictive storage permissions", async () => {
    const { directory, path, repository } = await fixture()

    const original = profile()
    const saved = await repository.saveProfile("candidate-a", original)
    if (!saved.ok) throw new Error(saved.error.message)

    saved.value.profile.skills.technical[0] = "Changed return"

    const loaded = await repository.getProfileByCandidateId("candidate-a")
    if (!loaded.ok) throw new Error(loaded.error.message)

    loaded.value.profile.skills.technical[0] = "Changed loaded"

    expect(
      await repository.getProfileByCandidateId("candidate-a"),
    ).toMatchObject({
      ok: true,
      value: {
        profile: {
          skills: { technical: ["Microsoft 365"] },
        },
      },
    })

    expect((await stat(path)).mode & 0o777).toBe(0o600)
    expect((await stat(directory)).mode & 0o777).toBe(0o700)
  })

  it("fails closed for malformed, duplicate, and unsupported persisted envelopes", async () => {
    const { path, repository } = await fixture()

    await mkdir(dirname(path), { recursive: true })

    await writeFile(path, "{", "utf8")
    expect(await repository.listProfiles()).toMatchObject({
      ok: false,
      error: { code: "CORRUPT_STORAGE" },
    })

    await writeFile(
      path,
      JSON.stringify({ schemaVersion: 2, profiles: [] }),
      "utf8",
    )
    expect(await repository.listProfiles()).toMatchObject({
      ok: false,
      error: { code: "UNSUPPORTED_SCHEMA_VERSION" },
    })

    const item = {
      candidateId: "candidate-a",
      profile: profile(),
    }

    await writeFile(
      path,
      JSON.stringify({
        schemaVersion: 1,
        profiles: [item, item],
      }),
      "utf8",
    )

    expect(await repository.listProfiles()).toMatchObject({
      ok: false,
      error: { code: "CORRUPT_STORAGE" },
    })
  })

  it("reports missing profiles and practical write failures safely", async () => {
    const { path, repository } = await fixture()

    expect(
      await repository.getProfileByCandidateId("missing"),
    ).toMatchObject({
      ok: false,
      error: { code: "NOT_FOUND" },
    })

    expect((await repository.saveProfile("retained", profile("Retained"))).ok).toBe(true)
    const before = await readFile(path, "utf8")

    await mkdir(join(dirname(path), ".candidate-profiles.json.tmp"))

    expect(
      await repository.saveProfile(
        "private-id",
        profile("PRIVATE PROFILE"),
      ),
    ).toMatchObject({
      ok: false,
      error: {
        code: "WRITE_FAILURE",
        message: expect.not.stringContaining("PRIVATE"),
      },
    })

    expect(await readFile(path, "utf8")).toBe(before)
  })
})
