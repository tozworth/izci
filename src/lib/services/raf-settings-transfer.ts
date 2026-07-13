import { normalizeRafSettings, rafSettings } from '$lib/stores/raf-settings';
import type { RafRackSettings } from '$lib/types';

export const RAF_SETTINGS_FILE_NAME = 'izci-raf-settings.json';

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function parseRafSettingsJson(text: string): RafRackSettings {
  let value: unknown;

  try {
    value = JSON.parse(text);
  } catch {
    throw new Error('The selected content is not valid JSON.');
  }

  if (!isRecord(value) || typeof value.enabled !== 'boolean' || !Array.isArray(value.effects)) {
    throw new Error('The JSON does not contain valid Raf rack settings.');
  }

  const normalized = normalizeRafSettings(value);
  if (normalized.effects.length !== value.effects.length) {
    throw new Error('The Raf rack contains an unsupported or malformed effect.');
  }

  return normalized;
}

export function serializeRafSettings(settings: RafRackSettings): string {
  return `${JSON.stringify(normalizeRafSettings(settings), null, 2)}\n`;
}

export function importRafSettingsJson(text: string): RafRackSettings {
  return rafSettings.replace(parseRafSettingsJson(text));
}

export async function importRafSettingsFile(file: File): Promise<RafRackSettings> {
  return importRafSettingsJson(await file.text());
}

export async function importRafSettingsClipboard(target: Pick<Clipboard, 'readText'> = navigator.clipboard): Promise<RafRackSettings> {
  if (!target?.readText) throw new Error('Clipboard access is unavailable.');
  return importRafSettingsJson(await target.readText());
}

export async function exportRafSettingsClipboard(target: Pick<Clipboard, 'writeText'> = navigator.clipboard): Promise<void> {
  if (!target?.writeText) throw new Error('Clipboard access is unavailable.');
  await target.writeText(serializeRafSettings(rafSettings.getSnapshot()));
}

export function exportRafSettingsFile(
  targetDocument: Document = document,
  targetUrl: Pick<typeof URL, 'createObjectURL' | 'revokeObjectURL'> = URL
): void {
  const url = targetUrl.createObjectURL(new Blob(
    [serializeRafSettings(rafSettings.getSnapshot())],
    { type: 'application/json' }
  ));
  const link = targetDocument.createElement('a');
  link.href = url;
  link.download = RAF_SETTINGS_FILE_NAME;
  link.click();
  targetUrl.revokeObjectURL(url);
}
