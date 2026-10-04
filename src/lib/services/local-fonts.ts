import { localFonts } from '$platform';
export const supportsLocalFontAccess = localFonts.supported;
export const hasLocalFontAccessPermission = localFonts.hasPermission;
export const queryLocalFontFamilies = localFonts.query;
