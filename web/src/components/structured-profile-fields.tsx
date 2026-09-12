"use client";

import { useState } from "react";
import type { CandidateProfile, Project } from "../../../.agents/job-search/cli/src/profile";
import styles from "../app/page.module.css";

type Evidence = Pick<CandidateProfile, "headline" | "summary" | "workExperience" | "education" | "projects">;
type ProjectDraft = { title: string; description: string; technologies: string; url: string };

function toDraft(project: Project): ProjectDraft {
  return { title: project.title, description: project.description ?? "", technologies: project.technologies?.join(", ") ?? "", url: project.url ?? "" };
}

function toProject(draft: ProjectDraft): Project {
  const technologies = draft.technologies.split(",").map(item => item.trim()).filter(Boolean);
  return {
    title: draft.title,
    ...(draft.description.trim() ? { description: draft.description.trim() } : {}),
    ...(technologies.length ? { technologies } : {}),
    ...(draft.url.trim() ? { url: draft.url.trim() } : {}),
  };
}

export default function StructuredProfileFields({ profile, includePresentation = false }: { profile?: Partial<Evidence> | null; includePresentation?: boolean }) {
  const [experience, setExperience] = useState(profile?.workExperience ?? []);
  const [education, setEducation] = useState(profile?.education ?? []);
  const [projects, setProjects] = useState((profile?.projects ?? []).map(toDraft));
  const [headline, setHeadline] = useState(profile?.headline === "Job seeker" ? "" : profile?.headline ?? "");
  const [summary, setSummary] = useState(profile?.summary ?? "");
  function updateExperience(index: number, key: keyof Evidence["workExperience"][number], value: string) {
    setExperience(rows => rows.map((row, i) => i === index ? { ...row, [key]: value } : row));
  }
  function updateEducation(index: number, key: keyof Evidence["education"][number], value: string) {
    setEducation(rows => rows.map((row, i) => i === index ? { ...row, [key]: key === "startYear" || key === "endYear" ? (value ? Number(value) : undefined) : value } : row));
  }
  function updateProject(index: number, key: keyof ProjectDraft, value: string) {
    setProjects(rows => rows.map((row, i) => i === index ? { ...row, [key]: value } : row));
  }
  return <section className={styles.profileForm} aria-label="Strukturerade profiluppgifter">
    <input type="hidden" name="structuredProfile" value={JSON.stringify({ workExperience: experience, education, projects: projects.filter(row => row.title.trim()).map(toProject), ...(includePresentation ? { headline: headline.trim(), summary: summary.trim() } : {}) })} />
    {includePresentation && <>
      <label className={styles.profileField}>Din yrkesrubrik<input required value={headline} onChange={event => setHeadline(event.target.value)} placeholder="Ange din egen yrkesrubrik" /></label>
      <label className={styles.profileField}>Professionell sammanfattning (valfri)<textarea rows={4} value={summary} onChange={event => setSummary(event.target.value)} /></label>
    </>}
    <h3>Arbetslivserfarenhet</h3>
    <p>Lägg till de anställningar du vill använda i ditt CV. Lämna tomt om du saknar arbetslivserfarenhet.</p>
    {experience.map((row, index) => <fieldset key={index} className={styles.profileFieldset}>
      <legend>Anställning {index + 1}</legend>
      <div className={styles.profileGrid}>
        {([['company', 'Arbetsgivare'], ['title', 'Roll / titel'], ['location', 'Ort / plats']] as const).map(([key, label]) => <label key={key} className={styles.profileField}>{label}<input required value={row[key]} onChange={event => updateExperience(index, key, event.target.value)} /></label>)}
        <label className={styles.profileField}>Startdatum (valfritt)<input value={row.startDate ?? ""} placeholder="ÅÅÅÅ-MM" onChange={event => updateExperience(index, 'startDate', event.target.value)} /></label>
        <label className={styles.profileField}>Slutdatum (valfritt)<input disabled={row.endDate === "Pågående"} value={row.endDate === "Pågående" ? "" : row.endDate ?? ""} placeholder="ÅÅÅÅ-MM" onChange={event => updateExperience(index, 'endDate', event.target.value)} /></label>
        <label className={styles.profileCheckbox}><input type="checkbox" checked={row.endDate === "Pågående"} onChange={event => updateExperience(index, 'endDate', event.target.checked ? "Pågående" : "")} />Pågående anställning</label>
        <label className={`${styles.profileField} ${styles.profileFieldWide}`}>Beskrivning / resultat (valfritt)<textarea rows={3} value={row.summary ?? ""} onChange={event => updateExperience(index, 'summary', event.target.value)} /></label>
      </div>
      <button type="button" className={styles.secondaryButton} onClick={() => setExperience(rows => rows.filter((_, i) => i !== index))}>Ta bort anställning {index + 1}</button>
    </fieldset>)}
    <button type="button" className={styles.secondaryButton} onClick={() => setExperience(rows => [...rows, { title: "", company: "", location: "" }])}>Lägg till anställning</button>
    <h3>Utbildning</h3>
    <p>Lägg till din utbildning med de uppgifter du själv kan bekräfta.</p>
    {education.map((row, index) => <fieldset key={index} className={styles.profileFieldset}>
      <legend>Utbildning {index + 1}</legend>
      <div className={styles.profileGrid}>
        {([['institution', 'Skola / lärosäte'], ['degree', 'Examen / program'], ['field', 'Inriktning']] as const).map(([key, label]) => <label key={key} className={styles.profileField}>{label}<input required value={row[key]} onChange={event => updateEducation(index, key, event.target.value)} /></label>)}
        {([['startYear', 'Startår'], ['endYear', 'Slutår']] as const).map(([key, label]) => <label key={key} className={styles.profileField}>{label} (valfritt)<input type="number" step="1" value={row[key] ?? ""} onChange={event => updateEducation(index, key, event.target.value)} /></label>)}
      </div>
      <button type="button" className={styles.secondaryButton} onClick={() => setEducation(rows => rows.filter((_, i) => i !== index))}>Ta bort utbildning {index + 1}</button>
    </fieldset>)}
    <button type="button" className={styles.secondaryButton} onClick={() => setEducation(rows => [...rows, { degree: "", field: "", institution: "" }])}>Lägg till utbildning</button>
    <h3>Projekt</h3>
    <p>Lägg till projekt du vill lyfta fram - till exempel ett GitHub-projekt, ett portfolioarbete, ett skolprojekt eller en volontärinsats. Lämna tomt om du inte har några projekt att visa.</p>
    {projects.map((row, index) => <fieldset key={index} className={styles.profileFieldset}>
      <legend>Projekt {index + 1}</legend>
      <div className={styles.profileGrid}>
        <label className={styles.profileField}>Titel<input required value={row.title} onChange={event => updateProject(index, "title", event.target.value)} /></label>
        <label className={styles.profileField}>Länk (valfritt)<input value={row.url} placeholder="https://github.com/..." onChange={event => updateProject(index, "url", event.target.value)} /></label>
        <label className={styles.profileField}>Teknologier, kommaseparerat (valfritt)<input value={row.technologies} placeholder="TypeScript, SQL" onChange={event => updateProject(index, "technologies", event.target.value)} /></label>
        <label className={`${styles.profileField} ${styles.profileFieldWide}`}>Beskrivning (valfritt)<textarea rows={3} value={row.description} onChange={event => updateProject(index, "description", event.target.value)} /></label>
      </div>
      <button type="button" className={styles.secondaryButton} onClick={() => setProjects(rows => rows.filter((_, i) => i !== index))}>Ta bort projekt {index + 1}</button>
    </fieldset>)}
    <button type="button" className={styles.secondaryButton} onClick={() => setProjects(rows => [...rows, { title: "", description: "", technologies: "", url: "" }])}>Lägg till projekt</button>
  </section>;
}
