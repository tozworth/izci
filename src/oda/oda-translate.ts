import { translate as i18nTranslate } from '$lib/i18n';

export type OdaTranslateValues = Record<string, string | number | boolean | Date | null | undefined>;

export type OdaTranslate = (
  key: string,
  fallback: string,
  values?: OdaTranslateValues
) => string;

export function createOdaTranslate(): OdaTranslate {
  return (key, fallback, values) => i18nTranslate(key, { default: fallback, values });
}
