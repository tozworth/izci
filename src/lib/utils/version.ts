export function formatDisplayVersion(version: string): string {
  const parts = version.split('.');

  if (parts.length === 3 && parts[2] === '0') {
    return parts.slice(0, 2).join('.');
  }

  return version;
}
