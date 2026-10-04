import { queryDesktopFontFamilies } from './window-lifecycle';
import { normalizeFontFamilies } from '../platform/local-fonts';

export const localFonts = {
  supported: () => true,
  hasPermission: async () => true,
  query: async () => normalizeFontFamilies(await queryDesktopFontFamilies())
};
