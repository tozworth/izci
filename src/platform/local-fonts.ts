export function normalizeFontFamilies(families: string[]): string[] {
  return [...new Set(families.map(family => family.trim()).filter(Boolean))].sort(
    (a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' })
  );
}
