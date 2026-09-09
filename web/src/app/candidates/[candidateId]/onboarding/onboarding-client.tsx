"use client";

import { useActionState, useMemo, useState, type FormEvent } from "react";

import type { CandidateImportClaimKind } from "@/lib/candidate-import-claims";
import type { OnboardingActionResult, OnboardingClaimView } from "./actions";
import { applyCandidateOnboardingAction, uploadCandidateOnboardingAction } from "./actions";
import styles from "./onboarding.module.css";

interface ReviewItem {
  claim: OnboardingClaimView;
  decision: "pending" | "approved" | "edited-and-approved" | "rejected";
  reviewedValue?: string;
}

interface AddedItem {
  kind: CandidateImportClaimKind;
  value: string;
  decision: "approved";
}

const labels: Record<CandidateImportClaimKind, string> = {
  technicalSkill: "Kompetenser",
  softSkill: "Mjuka kompetenser",
  certification: "Certifieringar",
  language: "Språk",
  workExperience: "Arbetslivserfarenhet",
  education: "Utbildning",
  headline: "Titel",
};

function errorMessage(result: OnboardingActionResult | null): string | null {
  return result && !result.ok ? result.message : null;
}

export default function OnboardingClient({ candidateId }: { candidateId: string }) {
  const [uploadState, uploadAction, uploading] = useActionState<OnboardingActionResult | null, FormData>((_state, formData) => uploadCandidateOnboardingAction(formData), null);
  const [applyState, applyAction, applying] = useActionState<OnboardingActionResult | null, FormData>((_state, formData) => applyCandidateOnboardingAction(formData), null);
  const [items, setItems] = useState<ReviewItem[] | null>(null);
  const [added, setAdded] = useState<AddedItem[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [kind, setKind] = useState<CandidateImportClaimKind>("technicalSkill");
  const [newValue, setNewValue] = useState("");
  const initialItems: ReviewItem[] = uploadState?.ok && "claims" in uploadState
    ? uploadState.claims.map((claim) => ({ claim, decision: "pending" as const }))
    : [];
  const reviewItems = items ?? initialItems;
  const step: "upload" | "review" | "complete" = applyState?.ok && "complete" in applyState
    ? "complete"
    : uploadState?.ok && "claims" in uploadState ? "review" : "upload";

  const groups = useMemo(() => {
    const grouped = new Map<CandidateImportClaimKind, ReviewItem[]>();
    for (const item of reviewItems) {
      const group = grouped.get(item.claim.kind) ?? [];
      group.push(item);
      grouped.set(item.claim.kind, group);
    }
    return [...grouped.entries()];
  }, [reviewItems]);
  const hasPending = reviewItems.some((item) => item.decision === "pending");

  function setDecision(id: string, decision: ReviewItem["decision"], reviewedValue?: string) {
    setItems(reviewItems.map((item) => item.claim.id === id ? { ...item, decision, ...(reviewedValue === undefined ? {} : { reviewedValue }) } : item));
  }

  function approveAll() {
    setItems(reviewItems.map((item) => item.decision === "rejected" ? item : { ...item, decision: "approved" }));
  }

  function addMissing(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = newValue.trim();
    if (!value || value.length > 10_000) return;
    setAdded((current) => [...current, { kind, value, decision: "approved" }]);
    setNewValue("");
  }

  if (step === "complete") {
    return (
      <section className={styles.complete} aria-live="polite">
        <span className={styles.completeMark} aria-hidden="true">✓</span>
        <p className={styles.eyebrow}>Klart</p>
        <h2>Din profil är klar</h2>
        <p>Vi har sparat dina bekräftade uppgifter och uppdaterat ditt grund-CV.</p>
        <div className={styles.actions}>
          <a href={`/candidates/${encodeURIComponent(candidateId)}`}>Se min profil</a>
          <a href="/jobs">Hitta jobb</a>
        </div>
      </section>
    );
  }

  return (
    <div className={styles.flow}>
      <div className={styles.progress} aria-label="Onboardingens steg">
        <span className={step === "upload" ? styles.current : styles.done}>1. Ladda upp</span>
        <span className={step === "review" ? styles.current : ""}>2. Kontrollera</span>
        <span>3. Klart</span>
      </div>

      {step === "upload" ? (
        <section className={styles.card}>
          <p className={styles.eyebrow}>Din profil</p>
          <h2>Ladda upp ditt CV</h2>
          <p>Vi läser bara ut tydliga uppgifter och låter dig kontrollera allt innan något sparas.</p>
          <form action={uploadAction} className={styles.uploadForm}>
            <input type="hidden" name="candidateId" value={candidateId} />
            <label htmlFor="cv">CV-fil</label>
            <input id="cv" name="cv" type="file" accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" required />
            <small>PDF eller DOCX, max 5 MB</small>
            <button type="submit" disabled={uploading}>{uploading ? "Läser CV:t..." : "Fortsätt"}</button>
          </form>
          {errorMessage(uploadState) ? <p className={styles.error} role="alert">{errorMessage(uploadState)}</p> : null}
        </section>
      ) : (
        <>
          <section className={styles.card}>
            <div className={styles.cardHeading}>
              <div>
                <p className={styles.eyebrow}>Kontrollera</p>
                <h2>Vi hittade detta i ditt CV</h2>
                <p>Ändra sådant som inte stämmer och ta bort det du inte vill spara.</p>
              </div>
              <button type="button" className={styles.secondary} onClick={approveAll}>Godkänn alla</button>
            </div>
            {groups.length === 0 && added.length === 0 ? <p className={styles.empty}>Vi hittade inga tydliga uppgifter. Lägg till det du vill spara nedan.</p> : null}
            <div className={styles.groups}>
              {groups.map(([groupKind, group]) => (
                <section key={groupKind} className={styles.group} aria-labelledby={`group-${groupKind}`}>
                  <h3 id={`group-${groupKind}`}>{labels[groupKind]}</h3>
                  {group.map((item) => {
                    const removed = item.decision === "rejected";
                    const editing = editingId === item.claim.id;
                    return (
                      <div className={`${styles.item} ${removed ? styles.removed : ""}`} key={item.claim.id}>
                        <div className={styles.itemValue}>
                          {editing ? <input aria-label={`Ändra ${labels[item.claim.kind]}`} value={editValue} onChange={(event) => setEditValue(event.target.value)} /> : <span>{item.reviewedValue ?? item.claim.value}</span>}
                          {item.claim.source === "user" ? <small>Tillagd av dig</small> : null}
                        </div>
                        <div className={styles.itemActions}>
                          {editing ? <button type="button" onClick={() => { if (editValue.trim()) { setDecision(item.claim.id, "edited-and-approved", editValue.trim()); setEditingId(null); } }}>Spara ändring</button> : <button type="button" onClick={() => { setEditingId(item.claim.id); setEditValue(item.reviewedValue ?? item.claim.value); }}>Ändra</button>}
                          <button type="button" className={item.decision === "approved" || item.decision === "edited-and-approved" ? styles.selected : ""} onClick={() => setDecision(item.claim.id, "approved")}>Godkänn</button>
                          <button type="button" className={removed ? styles.selected : ""} onClick={() => setDecision(item.claim.id, "rejected")}>{removed ? "Ångra" : "Ta bort"}</button>
                        </div>
                      </div>
                    );
                  })}
                </section>
              ))}
            </div>
          </section>

          <section className={styles.card}>
            <p className={styles.eyebrow}>Komplettera</p>
            <h2>Lägg till uppgift</h2>
            <form onSubmit={addMissing} className={styles.addForm}>
              <label htmlFor="kind">Typ</label>
              <select id="kind" value={kind} onChange={(event) => setKind(event.target.value as CandidateImportClaimKind)}>
                <option value="technicalSkill">Kompetens</option>
                <option value="softSkill">Mjuk kompetens</option>
                <option value="certification">Certifiering</option>
                <option value="language">Språk (ange nivå, till exempel Svenska (B2))</option>
              </select>
              <label htmlFor="new-value">Vad vill du lägga till?</label>
              <input id="new-value" value={newValue} onChange={(event) => setNewValue(event.target.value)} maxLength={10_000} />
              <button type="submit">Lägg till</button>
            </form>
            {added.length > 0 ? <div className={styles.addedList}>{added.map((item, index) => <div className={styles.item} key={`${item.kind}-${index}`}><span>{item.value}</span><button type="button" onClick={() => setAdded((current) => current.filter((_, itemIndex) => itemIndex !== index))}>Ta bort</button></div>)}</div> : null}
          </section>

          <form action={applyAction} className={styles.confirm}>
            <input type="hidden" name="candidateId" value={candidateId} />
            <input type="hidden" name="importId" value={uploadState && uploadState.ok && "importId" in uploadState ? uploadState.importId : ""} />
            <input type="hidden" name="documentId" value={uploadState && uploadState.ok && "documentId" in uploadState ? uploadState.documentId : ""} />
            <input type="hidden" name="reviews" value={JSON.stringify(reviewItems.map(({ claim, decision, reviewedValue }) => ({ claimId: claim.id, decision, ...(reviewedValue === undefined ? {} : { reviewedValue }) })))} />
            <input type="hidden" name="added" value={JSON.stringify(added)} />
            <label className={styles.confirmChoice}>
              <input type="checkbox" name="confirmHeadline" />
              Jag godkänner att en befintlig titel ersätts om jag har valt en ny.
            </label>
            <p><strong>Kontrollera dina uppgifter innan du sparar.</strong> Endast det du har godkänt följer med.</p>
            <button type="submit" disabled={applying || hasPending}>{applying ? "Sparar..." : hasPending ? "Godkänn uppgifterna först" : "Spara profil"}</button>
            {errorMessage(applyState) ? <p className={styles.error} role="alert">{errorMessage(applyState)}</p> : null}
          </form>
        </>
      )}
    </div>
  );
}
