import { isDesktop, queryDesktopFontFamilies } from '$platform';

interface LocalFontData {
  family: string;
}

interface LocalFontAccessWindow extends Window {
  queryLocalFonts?: () => Promise<LocalFontData[]>;
}

export function supportsLocalFontAccess(): boolean {
  return isDesktop || (typeof window !== 'undefined' && typeof (window as LocalFontAccessWindow).queryLocalFonts === 'function');
}

export async function hasLocalFontAccessPermission(): Promise<boolean> {
  if (isDesktop) return true;
  if (!supportsLocalFontAccess() || !navigator.permissions) {
    return false;
  }

  try {
    const status = await navigator.permissions.query(
      { name: 'local-fonts' } as unknown as PermissionDescriptor
    );
    return status.state === 'granted';
  } catch {
    return false;
  }
}

export async function queryLocalFontFamilies(): Promise<string[]> {
  if (isDesktop) return normalizeFontFamilies(await queryDesktopFontFamilies());
  const queryLocalFonts = (window as LocalFontAccessWindow).queryLocalFonts;

  if (!queryLocalFonts) {
    return [];
  }

  const fonts = await queryLocalFonts.call(window);
  return normalizeFontFamilies(fonts.map((font) => font.family));
}

function normalizeFontFamilies(families: string[]): string[] {
  return [...new Set(families.map((family) => family.trim()).filter(Boolean))].sort((left, right) =>
    left.localeCompare(right, undefined, { sensitivity: 'base' })
  );
}
