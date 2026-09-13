export function documentLanguage(formData: FormData): "sv" | "en" | undefined {
  const value = formData.get("documentLanguage");
  if (value === "sv" || value === "en") return value;
  if (value && value !== "auto") throw new Error("Dokumentspråket kunde inte användas.");
  return undefined;
}
