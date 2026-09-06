"use client";

import { useRouter } from "next/navigation";
import type { DocumentTemplateDefinition } from "@/lib/document-presentation";

export default function TemplateSelector({
  selectedTemplate,
}: {
  selectedTemplate: DocumentTemplateDefinition;
}) {
  const router = useRouter();

  return (
    <label style={{ display: "grid", gap: 6, maxWidth: 240 }}>
      Dokumentdesign
      <select
        aria-label="Dokumentdesign"
        defaultValue={selectedTemplate.id}
        onChange={(event) => {
          const params = new URLSearchParams(window.location.search);
          params.set("template", event.target.value);
          router.push(`${window.location.pathname}?${params.toString()}`);
        }}
      >
        <option value="modern">Modern</option>
        <option value="classic">Klassisk</option>
        <option value="minimal">Minimal</option>
      </select>
    </label>
  );
}
