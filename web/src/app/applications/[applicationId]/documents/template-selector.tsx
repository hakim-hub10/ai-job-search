"use client";

import { useRouter } from "next/navigation";
import { DOCUMENT_TEMPLATES, templateQueryHref, type DocumentTemplateDefinition } from "@/lib/document-presentation";

function Miniature({ id }: { id: DocumentTemplateDefinition["id"] }) {
  return (
    <span className={`templateMiniature templateMiniature-${id}`} aria-hidden="true">
      <span className="templateMiniatureTop" />
      <span className="templateMiniatureBody"><i /><i /><i /><i /></span>
    </span>
  );
}

export default function TemplateSelector({
  selectedTemplate,
}: {
  selectedTemplate: DocumentTemplateDefinition;
}) {
  const router = useRouter();

  return (
    <fieldset className="templatePicker">
      <legend>Dokumentdesign</legend>
      <div className="templatePickerOptions">
        {DOCUMENT_TEMPLATES.map((template) => (
          <button
            className={`templateOption${selectedTemplate.id === template.id ? " templateOptionSelected" : ""}`}
            key={template.id}
            type="button"
            aria-pressed={selectedTemplate.id === template.id}
            onClick={() => router.push(templateQueryHref(window.location.pathname, window.location.search, template.id))}
          >
            <Miniature id={template.id} />
            <span className="templateOptionLabel">{template.label}</span>
            <span className="templateOptionDescription">{template.description}</span>
          </button>
        ))}
      </div>
    </fieldset>
  );
}
