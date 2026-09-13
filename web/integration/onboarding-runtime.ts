/** Run separately: cd web && bun integration/onboarding-runtime.ts
 * Requires PostgreSQL schema-creation permission and an unused BETTER_AUTH_URL
 * port. Uses real Better Auth and Next.js, an isolated schema, and temporary
 * Candidate storage. Never uses an existing account or logs document contents.
 */
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import { once } from "node:events";
import { Pool } from "pg";
import PDFDocument from "pdfkit";
import JSZip from "jszip";

const { encodeReply } = createRequire(import.meta.url)("next/dist/compiled/react-server-dom-turbopack/client.node") as { encodeReply(values: unknown[]): Promise<FormData> };

const origin = process.env.BETTER_AUTH_URL;
if (!origin || !process.env.DATABASE_URL) throw new Error("Configured auth origin and database required");
const url = new URL(origin);
const webDir = resolve(import.meta.dir, "..");
const schema = `onboarding_test_${crypto.randomUUID().replaceAll("-", "")}`;
const coachDir = await mkdtemp(join(tmpdir(), "onboarding-runtime-"));
const database = new Pool({ connectionString: process.env.DATABASE_URL });
let server: ReturnType<typeof spawn> | undefined;
let schemaCreated = false;
let passed = 0;

function check(value: unknown, label: string): asserts value {
  if (!value) throw new Error(label);
}
function pass(label: string) { passed++; console.log(`PASS ${label}`); }

async function pdf(): Promise<Uint8Array> {
  return new Promise((resolvePdf, reject) => {
    const document = new PDFDocument();
    const chunks: Buffer[] = [];
    document.on("data", (chunk: Buffer) => chunks.push(chunk));
    document.on("error", reject);
    document.on("end", () => resolvePdf(new Uint8Array(Buffer.concat(chunks))));
    document.text([
      "Tekniska kompetenser",
      "Windows", "Linux", "Directory services", "Cloud platform", "Endpoint management", "Nätverk", "TCP/IP", "DNS", "DHCP", "VPN", "Container tools",
      "Personliga egenskaper",
      "Problemlösning", "Kommunikation", "Samarbete",
      "Certifieringar",
      "Professionell certifiering A", "Professionell certifiering B", "Professionell certifiering C", "Professionell certifiering D", "Professionell certifiering E",
      "Språk",
      "Svenska (Flytande)", "Engelska (Flytande)",
    ].join("\n"));
    document.end();
  });
}

try {
  // Refuse to send test requests to an already-running application.
  let occupied = false;
  try { await fetch(origin, { signal: AbortSignal.timeout(1500) }); occupied = true; } catch {}
  check(!occupied, "Stop the existing dev server before running this integration test");
  await database.query(`CREATE SCHEMA "${schema}"`);
  schemaCreated = true;
  const isolatedUrl = new URL(process.env.DATABASE_URL);
  isolatedUrl.searchParams.set("options", `-c search_path=${schema}`);
  const isolated = new Pool({ connectionString: isolatedUrl.toString() });
  try {
    await isolated.query(await readFile(join(webDir, "migrations/0001_auth_and_candidate_ownership.sql"), "utf8"));
  } finally { await isolated.end(); }

  server = spawn(process.execPath, ["run", "dev", "--hostname", url.hostname, "--port", url.port || "3000"], {
    cwd: webDir, detached: true, stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, DATABASE_URL: isolatedUrl.toString(), COACH_DIR: coachDir, APPLICATION_REPOSITORY: join(coachDir, "applications.json"), APPLICATION_DOCUMENT_REPOSITORY: join(coachDir, "documents.json"), INTERVIEW_PREPARATION_REPOSITORY: join(coachDir, "preparations.json"), INTERVIEW_SESSION_REPOSITORY: join(coachDir, "sessions.json"), INTERVIEW_SESSION_PREPARATION_LINK_REPOSITORY: join(coachDir, "session-links.json") },
  });
  // Drain output without exposing URLs, account details, cookies, or documents.
  server.stdout?.resume(); server.stderr?.resume();
  const deadline = Date.now() + 120_000;
  let ready = false;
  while (Date.now() < deadline) {
    check(server.exitCode === null, "Integration dev server exited before readiness");
    try { ready = (await fetch(`${origin}/login`, { signal: AbortSignal.timeout(3000) })).ok; } catch {}
    if (ready) break;
    await Bun.sleep(500);
  }
  check(ready, "Integration dev server readiness timeout");

  async function register() {
    const response = await fetch(`${origin}/api/auth/sign-up/email`, {
      method: "POST", headers: { "Content-Type": "application/json", Origin: origin! },
      body: JSON.stringify({ name: "Synthetic integration", email: `${crypto.randomUUID()}@example.test`, password: crypto.randomUUID() }),
    });
    check(response.ok, "Synthetic Better Auth registration failed");
    const cookie = response.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
    check(cookie, "Better Auth did not issue a session cookie");
    const root = await fetch(`${origin}/`, { headers: { Cookie: cookie }, redirect: "manual" });
    const location = root.headers.get("location");
    check(location && /^\/candidates\/[^/]+\/onboarding$/.test(location), "Authenticated root did not redirect to onboarding");
    const page = await fetch(new URL(location, origin), { headers: { Cookie: cookie } });
    check(page.ok, "Owned onboarding page failed");
    await page.text();
    return { cookie, location, candidateId: location.split("/")[2]! };
  }
  const owner = await register();
  const foreign = await register();
  const ownerSession = await fetch(`${origin}/api/auth/get-session`, { headers: { Cookie: owner.cookie } });
  const session = await ownerSession.json();
  check(ownerSession.ok && session?.user?.id, "Owner session did not resolve before upload");
  const ownedRows = await database.query(`SELECT "candidateId" FROM "${schema}".candidate_ownership WHERE "userId" = $1`, [session.user.id]);
  check(ownedRows.rows.length === 1 && ownedRows.rows[0].candidateId === owner.candidateId, "Owner session and route Candidate differ");
  pass("real Better Auth sessions and owned onboarding routes");
  const manifest = JSON.parse(await readFile(join(webDir, ".next/dev/server/server-reference-manifest.json"), "utf8"));
  const action = Object.entries(manifest.node as Record<string, { exportedName?: string }>).find(([, value]) => value.exportedName === "uploadCandidateOnboardingAction")?.[0];
  check(action, "Onboarding upload Server Action missing from Next manifest");

  async function upload(bytes: Uint8Array, filename: string, mime: string, candidateId = owner.candidateId, cookie = owner.cookie) {
    const form = new FormData();
    form.set("candidateId", candidateId);
    form.set("cv", new File([new Uint8Array(bytes)], filename, { type: mime }));
    // Bun adds FormData.toJSON; disable it on this test value so React sees
    // the same FormData instance that a browser passes to encodeReply.
    Object.defineProperty(form, "toJSON", { value: undefined });
    const body = await encodeReply([form]);
    check(body instanceof FormData, "React did not encode a multipart action");
    const response = await fetch(new URL(owner.location, origin), {
      method: "POST", headers: { Origin: origin!, Cookie: cookie, "Next-Action": action!, Accept: "text/x-component" }, body,
    });
    check(response.ok, `Server Action HTTP failure (${response.status})`);
    const wire = await response.text();
    // Only inspect the typed action result; never print the Flight payload.
    const result = wire.split("\n").flatMap(line => {
      const colon = line.indexOf(":");
      try { const value = JSON.parse(line.slice(colon + 1)); return typeof value?.ok === "boolean" ? [value] : []; } catch { return []; }
    })[0] as { ok: boolean; code?: string; claims?: unknown[] } | undefined;
    check(result, "Typed onboarding action result missing from Flight response");
    return result;
  }
  const small = await pdf();
  let result = await upload(small, "synthetic.pdf", "application/pdf");
  check(result.ok && Array.isArray(result.claims), `Small PDF did not reach claims review (ok=${result.ok}, code=${result.code ?? "none"}, claims=${result.claims?.length ?? "none"})`);
  pass("small generated PDF reaches claims review through Next.js");

  // Valid PDF with harmless trailing whitespace: real bytes above the old limit.
  const large = new Uint8Array(2 * 1024 * 1024).fill(32); large.set(small);
  result = await upload(large, "synthetic.pdf", "application/pdf");
  check(result.ok && Array.isArray(result.claims), "PDF above 1 MiB failed");
  pass("2 MiB valid PDF reaches claims review");
  const maximum = new Uint8Array(5 * 1024 * 1024).fill(32); maximum.set(small);
  result = await upload(maximum, "synthetic.pdf", "application/pdf");
  check(result.ok, "Exact 5 MiB PDF plus multipart overhead failed");
  pass("exact 5 MiB valid PDF accepted with multipart overhead");

  result = await upload(new TextEncoder().encode("%PDF-1.7\nbroken"), "synthetic.pdf", "application/pdf");
  check(!result.ok && result.code === "PDF_PARSE_FAILED", "Malformed PDF was not safely rejected");
  pass("malformed PDF returns PDF_PARSE_FAILED");
  result = await upload(new Uint8Array(), "synthetic.pdf", "application/pdf");
  check(!result.ok && result.code === "EMPTY_FILE", "Empty upload was not safely rejected");
  pass("empty file returns EMPTY_FILE");
  const oversized = new Uint8Array(5 * 1024 * 1024 + 1).fill(32); oversized.set(small);
  result = await upload(oversized, "synthetic.pdf", "application/pdf");
  check(!result.ok && result.code === "FILE_TOO_LARGE", "Product size validation did not reject oversized file");
  pass("5 MiB plus one byte reaches product validation and returns FILE_TOO_LARGE");

  const zip = new JSZip();
  zip.file("[Content_Types].xml", '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file("word/document.xml", '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Technical Skills</w:t></w:r></w:p><w:p><w:r><w:t>Python, TypeScript</w:t></w:r></w:p></w:body></w:document>');
  result = await upload(await zip.generateAsync({ type: "uint8array" }), "synthetic.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  check(result.ok && Array.isArray(result.claims), "DOCX regression");
  pass("real DOCX reaches claims review");
  result = await upload(small, "synthetic.pdf", "application/pdf", foreign.candidateId);
  check(!result.ok && result.code === "FORBIDDEN", "Foreign candidate upload was not denied");
  pass("foreign Candidate tampering denied");
  result = await upload(small, "synthetic.pdf", "application/pdf", owner.candidateId, "");
  check(!result.ok && result.code === "FORBIDDEN", "Unauthenticated upload was not denied");
  pass("unauthenticated upload denied");
  console.log(`${passed} integration checks passed`);
  if (process.argv.includes("--profile-journey")) {
    const { verifyProfileJourney } = await import("./profile-journey");
    await verifyProfileJourney({ origin, coachDir, webDir, owner, foreign, small });
  }
} catch (error) {
  // Assertion messages are controlled; do not expose driver/request exceptions.
  console.error("Integration failed:", error instanceof Error && !('code' in error) ? error.message : "environment/database operation failed");
  process.exitCode = 1;
} finally {
  if (server?.pid && server.exitCode === null) {
    const exited = once(server, "exit");
    process.kill(-server.pid, "SIGTERM");
    await exited;
  }
  try { if (schemaCreated) await database.query(`DROP SCHEMA "${schema}" CASCADE`); }
  finally { await database.end(); await rm(coachDir, { recursive: true, force: true }); }
}
