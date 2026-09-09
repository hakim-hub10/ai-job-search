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

## Mock interview start (Phase 12.4)

A saved preparation now offers **Starta mockintervju**. Its explicit server action
accepts only `applicationId` and `preparationId`, loads that exact immutable plan,
and calls the core `startInterviewSession` with a random UUID. Current profiles,
regeneration, list ordering and "latest" selection never participate.

Set private `APPLICATION_REPOSITORY`, `INTERVIEW_PREPARATION_REPOSITORY`,
`INTERVIEW_SESSION_REPOSITORY` and `INTERVIEW_SESSION_PREPARATION_LINK_REPOSITORY`
to trusted storage paths outside public assets. No `COACH_DIR` is required for
starting or reading a mock interview from an existing preparation.

The web process serializes the entire sequence: save the new session, create its
immutable link, read back the session, resolve and compare the exact preparation,
and only then return success and redirect. The session repository is an upsert,
so the operation checks for UUID collisions before saving. There is no cross-file
transaction or cross-process lock. Continue to run one writer per store across
web workers and CLI processes.

If session save, link creation or post-write verification fails, the action
returns a fixed Swedish error and does not redirect to a success page. It does
not delete or rewrite historical records. A link-write failure can leave an
unlinked session; a later verification failure can leave both records persisted.
Reads refuse missing or invalid linkage and never reconstruct it from question IDs.
A deliberate retry creates a separate session.

`/applications/[applicationId]/interview/sessions/[sessionId]` reads the durable
link and uses core `getCurrentInterviewQuestion` and `getInterviewSessionSummary`.
Only the current question and its stored evidence/context reach the view. It
handles completed sessions and legacy unlinked sessions explicitly. GET and
refresh do not write. There is no answer input, question advancement, feedback,
provider call, browser state storage or application/profile/document mutation.

## Candidate CV import admission (Phase 14.2)

`src/lib/candidate-import-upload.ts` is a server-only library boundary, not an
upload route or onboarding UI. It accepts caller-owned `Uint8Array` bytes and a
candidate resolved by server code, checks matching candidate IDs, and returns
only the core `ImportSession`/`ImportedDocument` metadata. Candidate IDs provide
internal scoping, not authentication or authorization. `getCandidateImport`
refuses mismatched candidate/document linkage and returns a detached snapshot.

The limit is **5 MiB (5 × 1024 × 1024 bytes)**, inclusive, suitable for ordinary
text CVs. Empty and larger uploads fail before signature inspection or hashing.
A future HTTP adapter must separately enforce its request limit before buffering;
this library cannot undo an allocation already made by its caller.

Admission requires a PDF/DOCX extension, matching declared MIME when supplied,
and a supported signature. PDF admission checks a versioned `%PDF-` header and
line ending. DOCX admission checks a ZIP local-file header signature and minimum
header length only: it does **not** prove a valid DOCX package. Passwords,
encryption, malformed document internals and DOCX archive/decompression risks
must be handled before extraction in later phases. No parser executes here.

Filenames are display metadata only; path separators, traversal paths, Windows
paths, controls and unsafe display characters are rejected. Generated UUIDs
identify sessions/documents. SHA-256 identifies equal byte content for future
comparison; it neither establishes trust nor triggers deduplication.

The sole status, `validated`, means admission passed in this request, not that
facts are verified, approved, or ready in durable storage. Metadata contains IDs,
candidate/import linkage, display filename, byte size, format, SHA-256,
validation version and timestamps. There is deliberately **no import store yet**:
with no retained bytes or extraction, a persisted resumable session would have
no source to resume. No binary, extracted text, claims, prompts or responses are
persisted. Bytes are not returned or retained by the validator, and there are no
temporary files; the caller releases its input after use. Garbage collection is
not a secure-erasure guarantee. Later extraction must receive and revalidate
actual bytes rather than trusting this metadata as a durable file reference.

Failures contain fixed codes/messages only. No extraction, external calls,
profile/Base CV mutation, cookies or browser storage are introduced.

## Bounded PDF Text Extraction (Phase 14.3)

`src/lib/candidate-import-pdf.ts` is a server-only, in-memory continuation of
the Phase 14.2 admission boundary. It revalidates the supplied upload and
accepts only an admitted PDF; a DOCX, invalid signature, invalid size, or other
admission failure is never sent to the PDF parser. The extractor returns text,
page count, and an explicit `untrusted` marker only. Extraction does not verify
facts, approve claims, or mutate a CandidateProfile or Base CV.

The implementation uses `pdf-parse` to derive text only. It does not render
pages, execute embedded JavaScript, follow links, fetch resources, invoke a
provider, create temporary files, or persist PDF bytes or extracted text. It
caps admitted input at the Phase 14.2 inclusive 5 MiB limit, rejects documents
above 20 pages, and rejects normalized text over 100,000 characters. CRLF/CR
line endings become LF and NUL characters are removed; no career facts are
rewritten, inferred, translated, or summarized.

Malformed, password-protected, image-only, page-limit, and text-limit inputs
produce fixed sanitized errors. No OCR is attempted. The parser runs in memory,
but its API does not offer a hard, safe execution-timeout mechanism; this phase
therefore makes no timeout guarantee. PDF bytes and extracted text remain
transient caller/request data. DOCX extraction, persistent import storage,
claim extraction/review, and onboarding UI remain future work.
