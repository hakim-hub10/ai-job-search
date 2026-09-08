This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## Interview data (Phase 12.1)

`src/lib/interview-data.ts` provides server-side `loadInterviewOverview(applicationId)`
and `loadInterviewSession(applicationId, sessionId)` reads. Configure private runtime
variables `APPLICATION_REPOSITORY` and `INTERVIEW_SESSION_REPOSITORY` with trusted
storage paths outside public assets. The latter uses the existing core envelope
`{ schemaVersion: 1, sessions: InterviewSession[] }`. Missing configuration is an
explicit error; a missing session file is an empty collection. Reads never save.

This module imports Node-backed repositories and uses Next.js’s `server-only`
marker to reject imports from client components. Pass its plain read models to UI components;
do not pass dependencies, repositories or paths. Tests can supply read-only fake
repository dependencies without using the preview store.

Sessions retain repository order (stable ID order for file storage), which is not
chronological. There are no timestamps or latest-session semantics. The read models
contain application/job labels and session progress counts from the Phase 5 summary
API, with no answer bodies or warning tokens. They make no feedback-availability,
preparation-availability or provider-configuration claims.

Preparation can be derived by the existing core API from an application snapshot
and explicit candidate document evidence, but this read layer does not generate it.
Feedback also requires a compatible preparation plan and is not persisted. Evidence
selection and historical plan compatibility remain decisions for later phases.
Optional AI remains behind future explicit actions. No interview GUI is added here.

## Interview preparation (Phase 12.3B)

The interview overview links to `/applications/[applicationId]/interview/prepare`.
An explicit server action creates a preparation and redirects to
`/applications/[applicationId]/interview/preparations/[preparationId]`.
Opening or refreshing either page never generates or saves preparation.

Configure private `INTERVIEW_PREPARATION_REPOSITORY` with a trusted file path
outside public assets, alongside `APPLICATION_REPOSITORY`. Creation also requires
`COACH_DIR`: the server resolves the application's association, the exact candidate,
and that candidate's verified profile. No default profile, Base CV edits, tailored
CV, cover letter, or AI output supplies new evidence. Browser input is limited to
application ID, one supported interview type, and `sv` or `en`.

The server converts the verified profile with `buildCandidateEvidenceCatalog`,
passes explicit evidence to `createInterviewPreparationPlan`, and retains the
requirement context from `buildApplicationDocumentFoundation`. The core immutable
repository stores the exact plan and evidence snapshot with a random UUID.
Multiple preparations are allowed; none replaces another or is called "latest".
Lists follow repository ID order, not creation order. Detail reads resolve only
stored evidence, even after profile changes; they do not need `COACH_DIR`.

Creation writes are serialized within the web process. The underlying file
repository still requires a single writer across processes: do not run concurrent
web workers or CLI writers against the same preparation file. This phase adds no
session creation, session linkage, provider calls, or answer storage. Runtime
errors use fixed Swedish messages, and repository paths stay on the server.

The view explains STAR as general coaching and renders question-specific STAR
prompts only when the saved plan contains them. Phase 5 currently emits those
prompts for requirement-linked experience evidence. The verified profile schema
has no experience-to-requirement links, so this conversion does not infer them;
profile-based preparations can legitimately have an empty `starPrompts` array.
