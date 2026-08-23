import { createSettingsStore, normalizeBoolean } from './persistent-store';

export const TROUBADOUR_SETTINGS_STORAGE_KEY = 'izci.troubadour-settings';
export const TROUBADOUR_SETTINGS_CHANNEL = 'izci.troubadour-settings';

export const TROUBADOUR_METADATA_FIELDS = [
  'title',
  'artist',
  'albumArtist',
  'album',
  'date',
  'trackNumber',
  'trackTotal',
  'discNumber',
  'discTotal',
  'genre',
  'composer',
  'comment',
  'lyrics',
  'isrc',
  'bpm',
  'grouping',
  'copyright',
  'titleSort',
  'artistSort',
  'albumSort',
  'albumArtistSort'
] as const;

export type TroubadourMetadataField = typeof TROUBADOUR_METADATA_FIELDS[number];
export type TroubadourInitialLoad = 'current-track' | 'current-selection' | 'nothing';
export type TroubadourAutoGroupFallback = 'folder' | 'none';
export type TroubadourDateDisplay = 'verbatim' | 'year' | 'localized';
export type TroubadourRawTagVisibility = 'hidden' | 'advanced' | 'always';
export type TroubadourValidationSeverity = 'errors' | 'warnings' | 'all';
export type TroubadourArtworkKind = 'front' | 'back' | 'other';
export type TroubadourMultipleImageBehavior = 'preserve' | 'replace-kind' | 'reject';
export type TroubadourAlbumArtworkDefault = 'selected' | 'album' | 'ask';
export type TroubadourArtworkPreviewFit = 'contain' | 'cover' | 'actual';
export type TroubadourUnicodeNormalization = 'preserve' | 'nfc' | 'ascii';
export type TroubadourExtensionCase = 'preserve' | 'lower' | 'upper';
export type TroubadourMissingTokenPolicy = 'stop' | 'empty' | 'skip';
export type TroubadourCollisionPolicy = 'stop' | 'skip' | 'counter';
export type TroubadourCopyVerification = 'size' | 'metadata' | 'hash';
export type TroubadourBackupPolicy = 'none' | 'sibling' | 'backup-folder';
export type TroubadourPostWriteVerification = 'managed-fields' | 'full-metadata';
export type TroubadourExternalChangeBehavior = 'stop' | 'reload-unchanged';
export type TroubadourBatchErrorBehavior = 'continue' | 'stop';

export interface TroubadourSettings {
  initialLoad: TroubadourInitialLoad;
  folderScanDepth: number;
  metadataReadConcurrency: number;
  autoGroupOnLoad: boolean;
  autoGroupFallback: TroubadourAutoGroupFallback;
  confirmDirtyRemoval: boolean;

  visibleMetadataFields: TroubadourMetadataField[];
  dateDisplay: TroubadourDateDisplay;
  rawTagVisibility: TroubadourRawTagVisibility;
  validationSeverity: TroubadourValidationSeverity;

  defaultArtworkKind: TroubadourArtworkKind;
  artworkSizeWarningMb: number;
  artworkDimensionWarningPx: number;
  multipleImageBehavior: TroubadourMultipleImageBehavior;
  albumArtworkDefault: TroubadourAlbumArtworkDefault;
  artworkPreviewFit: TroubadourArtworkPreviewFit;

  renameTemplate: string;
  illegalCharacterReplacement: string;
  normalizeWhitespace: boolean;
  unicodeNormalization: TroubadourUnicodeNormalization;
  extensionCase: TroubadourExtensionCase;
  missingTokenPolicy: TroubadourMissingTokenPolicy;
  collisionPolicy: TroubadourCollisionPolicy;
  copyVerification: TroubadourCopyVerification;

  backupPolicy: TroubadourBackupPolicy;
  postWriteVerification: TroubadourPostWriteVerification;
  externalChangeBehavior: TroubadourExternalChangeBehavior;
  batchErrorBehavior: TroubadourBatchErrorBehavior;
  destructiveClearConfirmationThreshold: number;

  diagnosticJobReporting: boolean;
}

export const DEFAULT_TROUBADOUR_SETTINGS: TroubadourSettings = {
  initialLoad: 'current-selection',
  folderScanDepth: 12,
  metadataReadConcurrency: 4,
  autoGroupOnLoad: true,
  autoGroupFallback: 'folder',
  confirmDirtyRemoval: true,

  visibleMetadataFields: [...TROUBADOUR_METADATA_FIELDS],
  dateDisplay: 'verbatim',
  rawTagVisibility: 'advanced',
  validationSeverity: 'warnings',

  defaultArtworkKind: 'front',
  artworkSizeWarningMb: 8,
  artworkDimensionWarningPx: 4000,
  multipleImageBehavior: 'preserve',
  albumArtworkDefault: 'ask',
  artworkPreviewFit: 'contain',

  renameTemplate: '{track:02} - {title}',
  illegalCharacterReplacement: '_',
  normalizeWhitespace: true,
  unicodeNormalization: 'preserve',
  extensionCase: 'preserve',
  missingTokenPolicy: 'stop',
  collisionPolicy: 'stop',
  copyVerification: 'metadata',

  backupPolicy: 'none',
  postWriteVerification: 'managed-fields',
  externalChangeBehavior: 'stop',
  batchErrorBehavior: 'continue',
  destructiveClearConfirmationThreshold: 5,

  diagnosticJobReporting: false
};

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function enumValue<T extends string>(value: unknown, values: readonly T[], fallback: T): T {
  return typeof value === 'string' && values.includes(value as T) ? value as T : fallback;
}

export function normalizeTroubadourInteger(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number
): number {
  const number = typeof value === 'number'
    ? value
    : typeof value === 'string' && value.trim() !== ''
      ? Number(value)
      : NaN;
  return Number.isFinite(number)
    ? Math.min(maximum, Math.max(minimum, Math.round(number)))
    : fallback;
}

export function normalizeTroubadourMetadataFields(value: unknown): TroubadourMetadataField[] {
  if (!Array.isArray(value)) return [...DEFAULT_TROUBADOUR_SETTINGS.visibleMetadataFields];

  const supported = new Set<string>(TROUBADOUR_METADATA_FIELDS);
  const result: TroubadourMetadataField[] = [];
  for (const field of value) {
    if (typeof field === 'string' && supported.has(field) && !result.includes(field as TroubadourMetadataField)) {
      result.push(field as TroubadourMetadataField);
    }
  }
  return result.length > 0 ? result : [...DEFAULT_TROUBADOUR_SETTINGS.visibleMetadataFields];
}

function normalizeReplacement(value: unknown): string {
  if (typeof value !== 'string') return DEFAULT_TROUBADOUR_SETTINGS.illegalCharacterReplacement;
  return Array.from(value)[0] ?? '';
}

export function normalizeTroubadourSettings(value: unknown): TroubadourSettings {
  const source = isObject(value) ? value : {};
  return {
    initialLoad: enumValue(source.initialLoad, ['current-track', 'current-selection', 'nothing'], DEFAULT_TROUBADOUR_SETTINGS.initialLoad),
    folderScanDepth: normalizeTroubadourInteger(source.folderScanDepth, DEFAULT_TROUBADOUR_SETTINGS.folderScanDepth, 0, 64),
    metadataReadConcurrency: normalizeTroubadourInteger(source.metadataReadConcurrency, DEFAULT_TROUBADOUR_SETTINGS.metadataReadConcurrency, 1, 12),
    autoGroupOnLoad: normalizeBoolean(source.autoGroupOnLoad, DEFAULT_TROUBADOUR_SETTINGS.autoGroupOnLoad),
    autoGroupFallback: enumValue(source.autoGroupFallback, ['folder', 'none'], DEFAULT_TROUBADOUR_SETTINGS.autoGroupFallback),
    confirmDirtyRemoval: normalizeBoolean(source.confirmDirtyRemoval, DEFAULT_TROUBADOUR_SETTINGS.confirmDirtyRemoval),

    visibleMetadataFields: normalizeTroubadourMetadataFields(source.visibleMetadataFields),
    dateDisplay: enumValue(source.dateDisplay, ['verbatim', 'year', 'localized'], DEFAULT_TROUBADOUR_SETTINGS.dateDisplay),
    rawTagVisibility: enumValue(source.rawTagVisibility, ['hidden', 'advanced', 'always'], DEFAULT_TROUBADOUR_SETTINGS.rawTagVisibility),
    validationSeverity: enumValue(source.validationSeverity, ['errors', 'warnings', 'all'], DEFAULT_TROUBADOUR_SETTINGS.validationSeverity),

    defaultArtworkKind: enumValue(source.defaultArtworkKind, ['front', 'back', 'other'], DEFAULT_TROUBADOUR_SETTINGS.defaultArtworkKind),
    artworkSizeWarningMb: normalizeTroubadourInteger(source.artworkSizeWarningMb, DEFAULT_TROUBADOUR_SETTINGS.artworkSizeWarningMb, 1, 256),
    artworkDimensionWarningPx: normalizeTroubadourInteger(source.artworkDimensionWarningPx, DEFAULT_TROUBADOUR_SETTINGS.artworkDimensionWarningPx, 256, 32768),
    multipleImageBehavior: enumValue(source.multipleImageBehavior, ['preserve', 'replace-kind', 'reject'], DEFAULT_TROUBADOUR_SETTINGS.multipleImageBehavior),
    albumArtworkDefault: enumValue(source.albumArtworkDefault, ['selected', 'album', 'ask'], DEFAULT_TROUBADOUR_SETTINGS.albumArtworkDefault),
    artworkPreviewFit: enumValue(source.artworkPreviewFit, ['contain', 'cover', 'actual'], DEFAULT_TROUBADOUR_SETTINGS.artworkPreviewFit),

    renameTemplate: typeof source.renameTemplate === 'string' && source.renameTemplate.trim() !== '' ? source.renameTemplate : DEFAULT_TROUBADOUR_SETTINGS.renameTemplate,
    illegalCharacterReplacement: normalizeReplacement(source.illegalCharacterReplacement),
    normalizeWhitespace: normalizeBoolean(source.normalizeWhitespace, DEFAULT_TROUBADOUR_SETTINGS.normalizeWhitespace),
    unicodeNormalization: enumValue(source.unicodeNormalization, ['preserve', 'nfc', 'ascii'], DEFAULT_TROUBADOUR_SETTINGS.unicodeNormalization),
    extensionCase: enumValue(source.extensionCase, ['preserve', 'lower', 'upper'], DEFAULT_TROUBADOUR_SETTINGS.extensionCase),
    missingTokenPolicy: enumValue(source.missingTokenPolicy, ['stop', 'empty', 'skip'], DEFAULT_TROUBADOUR_SETTINGS.missingTokenPolicy),
    collisionPolicy: enumValue(source.collisionPolicy, ['stop', 'skip', 'counter'], DEFAULT_TROUBADOUR_SETTINGS.collisionPolicy),
    copyVerification: enumValue(source.copyVerification, ['size', 'metadata', 'hash'], DEFAULT_TROUBADOUR_SETTINGS.copyVerification),

    backupPolicy: enumValue(source.backupPolicy, ['none', 'sibling', 'backup-folder'], DEFAULT_TROUBADOUR_SETTINGS.backupPolicy),
    postWriteVerification: enumValue(source.postWriteVerification, ['managed-fields', 'full-metadata'], DEFAULT_TROUBADOUR_SETTINGS.postWriteVerification),
    externalChangeBehavior: enumValue(source.externalChangeBehavior, ['stop', 'reload-unchanged'], DEFAULT_TROUBADOUR_SETTINGS.externalChangeBehavior),
    batchErrorBehavior: enumValue(source.batchErrorBehavior, ['continue', 'stop'], DEFAULT_TROUBADOUR_SETTINGS.batchErrorBehavior),
    destructiveClearConfirmationThreshold: normalizeTroubadourInteger(source.destructiveClearConfirmationThreshold, DEFAULT_TROUBADOUR_SETTINGS.destructiveClearConfirmationThreshold, 1, 1000),

    diagnosticJobReporting: normalizeBoolean(source.diagnosticJobReporting, DEFAULT_TROUBADOUR_SETTINGS.diagnosticJobReporting)
  };
}

export const troubadourSettings = createSettingsStore({
  storageKey: TROUBADOUR_SETTINGS_STORAGE_KEY,
  channelName: TROUBADOUR_SETTINGS_CHANNEL,
  defaultValue: DEFAULT_TROUBADOUR_SETTINGS,
  normalize: normalizeTroubadourSettings
});
