/** A location override replaces its section; a blank builtin section inherits primary maintenance routing. */
export function reminderRecipientIds(options: {
  sectionIds: string[]; locationIds?: string[]; useLocationRecipients?: boolean; fallbackIds?: string[];
}): string[] {
  const selected = options.useLocationRecipients ? options.locationIds ?? [] :
    options.sectionIds.length ? options.sectionIds : options.fallbackIds ?? [];
  return [...new Set(selected.map((id) => id.trim()).filter(Boolean))];
}
