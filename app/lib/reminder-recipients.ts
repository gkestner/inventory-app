/** Location overrides replace defaults unless the category is explicitly included everywhere. */
export function reminderRecipientIds(options: {
  sectionIds: string[]; locationIds?: string[]; useLocationRecipients?: boolean; includeCategoryRecipients?: boolean; fallbackIds?: string[];
}): string[] {
  const selected = options.useLocationRecipients ? [...(options.includeCategoryRecipients ? options.sectionIds : []), ...(options.locationIds ?? [])] :
    options.sectionIds.length ? options.sectionIds : options.fallbackIds ?? [];
  return [...new Set(selected.map((id) => id.trim()).filter(Boolean))];
}

export function sameRecipientIds(before: string[], after: string[]): boolean {
  const previous = new Set(before);
  return previous.size === after.length && after.every((id) => previous.has(id));
}
export const REMINDER_EMAIL_LIMIT = 50;
export const REMINDER_EMAIL_INPUT_LIMIT = 13_000;
