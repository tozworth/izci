<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { t } from 'svelte-i18n';
  import HoverTooltip from '$lib/components/HoverTooltip.svelte';
  import MenuSurface from '$lib/components/MenuSurface.svelte';
  import TabStrip from '$lib/components/TabStrip.svelte';
  import { MODULE_EXTENSIONS, STREAM_EXTENSIONS } from '$lib/types';
  import { loadTrackLyrics } from '$lib/services/lyrics';
  import { listenForCurrentToolTrack } from '$lib/services/tool-track-context';
  import { RAF_EFFECT_DEFINITIONS, RAF_EFFECT_REGISTRY } from '$lib/services/raf-effect-registry';
  import { loadEmbeddedStreamArtwork, loadTrackMetadata } from '$lib/services/stream-artwork';
  import { inferArtistTitleFromFileName, inferExtension, stripFileExtension } from '$lib/utils/files';
  import ClipTagMenuBar from './ClipTagMenuBar.svelte';
  import ClipEffectDialog from './ClipEffectDialog.svelte';
  import ClipExportDialog from './ClipExportDialog.svelte';
  import LyricsEditor from './LyricsEditor.svelte';
  import WaveformEditor from './WaveformEditor.svelte';
  import {
    clipDuration,
    createInitialClipState,
    cutSelection,
    keepSelection,
    loadAudioFile,
    materializeClip,
    replaceAudioBufferRange,
    replaceSelectionRanges,
    saveBlob,
    sliceAudioBuffer,
    sliceClipRanges,
    updateSelection,
    type AudioLoadProgress,
    type ClipEditState
  } from './clip-audio';
  import { EMPTY_TAGS, parseId3, tagMp3, type EditableTags } from './tag-writer';
  import { remapLyricsToClip } from './lyrics-editor';
  import {
    ClipExportUnavailableError,
    DEFAULT_CLIP_EXPORT_OPTIONS,
    type ClipExportFormat,
    type ClipExportOptions
  } from './clip-export-options';
  import { blendRenderedEdges, renderRafEffect } from './clip-effects';
  import { MAX_WAVEFORM_ZOOM, zoomWaveformViewport } from './waveform-viewport';
  import type { MenuActionItem, RafEffectSettings, RafEffectType } from '$lib/types';

  type ToolTab = 'edit' | 'tags' | 'lyrics';
  type TagField = Exclude<keyof EditableTags, 'lyrics'>;
  interface EditSnapshot {
    state: ClipEditState;
    buffer: AudioBuffer;
  }
  interface AudioClipboard {
    buffer: AudioBuffer;
    ranges: ClipEditState['ranges'];
  }
  const MAX_EDIT_HISTORY = 12;
  const ACCEPTED_EXTENSIONS = [...STREAM_EXTENSIONS, ...MODULE_EXTENSIONS];
  const FILE_ACCEPT = ACCEPTED_EXTENSIONS.map((extension) => `.${extension}`).join(',');
  const OPEN_FILE_PICKER_OPTIONS: OpenFilePickerOptions = {
    multiple: false,
    types: [{
      description: 'Audio files',
      accept: { 'audio/*': ACCEPTED_EXTENSIONS.map((extension) => `.${extension}`) }
    }]
  };
  const TAG_FIELDS: Array<{ key: TagField; wide?: boolean }> = [
    { key: 'title', wide: true },
    { key: 'artist' },
    { key: 'albumArtist' },
    { key: 'album', wide: true },
    { key: 'composer' },
    { key: 'genre' },
    { key: 'year' },
    { key: 'trackNumber' },
    { key: 'discNumber' }
  ];

  let activeTab: ToolTab = 'edit';
  let fileInput: HTMLInputElement;
  let artworkInput: HTMLInputElement;
  let exportDialog: ClipExportDialog;
  let effectDialog: ClipEffectDialog;
  let sourceFile: File | null = null;
  let sourceFileHandle: FileSystemFileHandle | null = null;
  let sourceBuffer: AudioBuffer | null = null;
  let waveformBuffer: AudioBuffer | null = null;
  let editState: ClipEditState = createInitialClipState(0);
  let undoStack: EditSnapshot[] = [];
  let redoStack: EditSnapshot[] = [];
  let audioClipboard: AudioClipboard | null = null;
  let loading = false;
  let loadProgress: AudioLoadProgress | null = null;
  let errorMessage = '';
  let noticeMessage = '';
  let renderedModule = false;
  let renderedFromCache = false;
  let tags: EditableTags = { ...EMPTY_TAGS };
  let artwork: Blob | null = null;
  let artworkUrl = '';
  let artworkDragActive = false;
  let previewContext: AudioContext | null = null;
  let previewSource: AudioBufferSourceNode | null = null;
  let previewStartedAt = 0;
  let previewOffset = 0;
  let previewEnd = 0;
  let previewMode: 'clip' | 'lyrics' = 'clip';
  let previewPlaying = false;
  let playhead = 0;
  let previewFrame = 0;
  let exporting = false;
  let exportingFormat: ClipExportFormat = 'wav';
  let savingTags = false;
  let processingEffect = false;
  let waveformZoom = 1;
  let waveformScrollStart = 0;
  let contextMenuKind: 'waveform' | 'artwork' | null = null;
  let contextMenuX = 0;
  let contextMenuY = 0;

  $: duration = clipDuration(editState);
  $: selectionDuration = Math.max(0, editState.selectionEnd - editState.selectionStart);
  $: hasSelection = selectionDuration > 0.001;
  $: canUndo = activeTab === 'edit' && undoStack.length > 0;
  $: canRedo = activeTab === 'edit' && redoStack.length > 0;
  $: canEdit = Boolean(sourceBuffer && waveformBuffer && !loading && !exporting && !savingTags && !processingEffect);
  $: canPaste = Boolean(canEdit && audioClipboard && activeTab === 'edit');
  $: canSaveTags = Boolean(sourceFile && sourceBuffer && !loading && !exporting && !savingTags);
  $: canSaveInPlace = Boolean(
    canSaveTags
    && sourceFileHandle?.createWritable
    && sourceFile
    && (STREAM_EXTENSIONS as readonly string[]).includes(inferExtension(sourceFile.name))
  );
  $: statusText = errorMessage || (processingEffect
    ? $t('clipTag.effects.rendering', { default: 'Rendering selection...' })
    : exporting
    ? $t('clipTag.encoding', { default: 'Encoding {format}...', values: { format: exportingFormat.toUpperCase() } })
    : savingTags
      ? $t('clipTag.savingTags', { default: 'Writing tagged copy...' })
      : noticeMessage) || (loadProgress
    ? loadProgress.detail
    : sourceFile
      ? `${formatTime(duration)} · ${waveformBuffer?.sampleRate.toLocaleString() ?? 0} Hz · ${waveformBuffer?.numberOfChannels ?? 0} ch`
      : $t('clipTag.emptyHint', { default: 'Open or drop an audio file to begin.' }));
  $: contextMenuItems = contextMenuKind === 'waveform'
    ? buildWaveformContextMenu()
    : contextMenuKind === 'artwork'
      ? buildArtworkContextMenu()
      : [];

  function formatTime(value: number): string {
    if (!Number.isFinite(value)) return '0:00.000';
    const minutes = Math.floor(value / 60);
    const seconds = value - minutes * 60;
    return `${minutes}:${seconds.toFixed(3).padStart(6, '0')}`;
  }

  function formatWaveformZoom(value: number): string {
    return `${Number(value.toFixed(value < 10 ? 1 : 0))}\u00d7`;
  }

  function setWaveformZoom(nextZoom: number): void {
    const next = zoomWaveformViewport(
      waveformScrollStart,
      waveformBuffer?.duration ?? 0,
      waveformZoom,
      nextZoom
    );
    waveformZoom = next.zoom;
    waveformScrollStart = next.start;
  }

  function resetWaveformViewport(): void {
    waveformZoom = 1;
    waveformScrollStart = 0;
  }

  function buildWaveformContextMenu(): MenuActionItem[] {
    return [
      {
        id: 'undo',
        label: $t('clipTag.menu.undo', { default: 'Undo' }),
        icon: 'undo',
        shortcut: 'Ctrl+Z',
        disabled: !canUndo
      },
      {
        id: 'redo',
        label: $t('clipTag.menu.redo', { default: 'Redo' }),
        icon: 'redo',
        shortcut: 'Ctrl+Y',
        disabled: !canRedo
      },
      {
        id: 'cut',
        label: $t('clipTag.edit.cut', { default: 'Cut' }),
        icon: 'content_cut',
        shortcut: 'Ctrl+X',
        disabled: !canEdit || !hasSelection,
        separatorBefore: true
      },
      {
        id: 'copy',
        label: $t('clipTag.edit.copy', { default: 'Copy' }),
        icon: 'content_copy',
        shortcut: 'Ctrl+C',
        disabled: !canEdit || !hasSelection
      },
      {
        id: 'paste',
        label: $t('clipTag.edit.paste', { default: 'Paste' }),
        icon: 'content_paste',
        shortcut: 'Ctrl+V',
        disabled: !canPaste
      },
      {
        id: 'delete',
        label: $t('clipTag.edit.delete', { default: 'Delete' }),
        icon: 'delete',
        shortcut: 'Del',
        disabled: !canEdit || !hasSelection
      },
      {
        id: 'trim',
        label: $t('clipTag.edit.trim', { default: 'Trim to selection' }),
        icon: 'crop',
        disabled: !canEdit || !hasSelection,
        separatorBefore: true
      },
      {
        id: 'selectAll',
        label: $t('clipTag.menu.selectAll', { default: 'Select all' }),
        icon: 'select_all',
        shortcut: 'Ctrl+A',
        disabled: !canEdit
      },
      {
        id: 'effects',
        label: $t('clipTag.effects.button', { default: 'Effects...' }),
        icon: 'auto_fix_high',
        disabled: !canEdit || !hasSelection,
        separatorBefore: true,
        children: RAF_EFFECT_DEFINITIONS.map((definition) => ({
          id: `effect:${definition.type}`,
          label: definition.name,
          icon: definition.icon
        }))
      },
      {
        id: 'play',
        label: previewPlaying && previewMode === 'clip'
          ? $t('audioCompare.stop', { default: 'Stop' })
          : $t('clipTag.edit.play', { default: 'Play from cursor' }),
        icon: previewPlaying && previewMode === 'clip' ? 'stop' : 'play_arrow',
        shortcut: 'Space',
        disabled: !canEdit,
        separatorBefore: true
      },
      {
        id: 'playSelection',
        label: $t('clipTag.edit.playSelection', { default: 'Play selection' }),
        icon: 'play_circle',
        disabled: !canEdit || !hasSelection
      },
      {
        id: 'zoom',
        label: $t('clipTag.edit.zoom', { default: 'Zoom' }),
        icon: 'zoom_in',
        children: [
          { id: 'zoomIn', label: $t('clipTag.clip.zoomIn', { default: 'Zoom in' }), icon: 'zoom_in', disabled: !canEdit || waveformZoom >= MAX_WAVEFORM_ZOOM },
          { id: 'zoomOut', label: $t('clipTag.clip.zoomOut', { default: 'Zoom out' }), icon: 'zoom_out', disabled: !canEdit || waveformZoom <= 1 },
          { id: 'fit', label: $t('clipTag.clip.fitWaveform', { default: 'Fit waveform (Ctrl+wheel to zoom)' }), icon: 'fit_screen', disabled: !canEdit || waveformZoom <= 1, separatorBefore: true },
          { id: 'zoomSelection', label: $t('clipTag.edit.zoomSelection', { default: 'Zoom to selection' }), icon: 'zoom_in_map', disabled: !canEdit || !hasSelection }
        ]
      },
      {
        id: 'export',
        label: $t('clipTag.clip.exportOpen', { default: 'Export...' }),
        icon: 'save',
        shortcut: 'Ctrl+S',
        disabled: !canEdit,
        separatorBefore: true
      }
    ];
  }

  function buildArtworkContextMenu(): MenuActionItem[] {
    return [
      {
        id: 'browseArtwork',
        label: $t('clipTag.tags.browse', { default: 'Browse...' }),
        icon: 'folder_open',
        disabled: !sourceFile
      },
      {
        id: 'removeArtwork',
        label: $t('clipTag.tags.removeArtwork', { default: 'Remove artwork' }),
        icon: 'delete',
        disabled: !artwork
      },
      {
        id: 'saveInPlace',
        label: $t('clipTag.menu.saveInPlace', { default: 'Save' }),
        icon: 'save',
        shortcut: 'Ctrl+S',
        disabled: !canSaveInPlace,
        separatorBefore: true
      },
      {
        id: 'saveAs',
        label: $t('clipTag.menu.saveAs', { default: 'Save as...' }),
        icon: 'save_as',
        shortcut: 'Ctrl+Shift+S',
        disabled: !canSaveTags
      }
    ];
  }

  function openContextMenu(event: MouseEvent, kind: 'waveform' | 'artwork'): void {
    contextMenuKind = kind;
    contextMenuX = event.clientX;
    contextMenuY = event.clientY;
  }

  function runContextMenuAction(action: string): void {
    contextMenuKind = null;
    if (action === 'undo') undo();
    else if (action === 'redo') redo();
    else if (action === 'cut') deleteSelection(true);
    else if (action === 'copy') copySelection();
    else if (action === 'paste') pasteAudio();
    else if (action === 'delete') deleteSelection();
    else if (action === 'trim') trimToSelection();
    else if (action === 'selectAll') selectAll();
    else if (action === 'play') toggleEditorPreview(false);
    else if (action === 'playSelection') toggleEditorPreview(true);
    else if (action === 'zoomIn') setWaveformZoom(waveformZoom * 2);
    else if (action === 'zoomOut') setWaveformZoom(waveformZoom / 2);
    else if (action === 'fit') resetWaveformViewport();
    else if (action === 'zoomSelection') zoomToSelection();
    else if (action === 'export') openExportDialog();
    else if (action === 'browseArtwork') artworkInput.click();
    else if (action === 'removeArtwork') replaceArtwork(null);
    else if (action === 'saveInPlace') void saveTaggedInPlace();
    else if (action === 'saveAs') void saveTaggedCopy();
    else if (action.startsWith('effect:')) openEffectDialog(action.slice(7) as RafEffectType);
  }

  function tagFieldLabel(key: TagField): string {
    switch (key) {
      case 'title': return $t('clipTag.tags.title', { default: 'Title' });
      case 'artist': return $t('clipTag.tags.artist', { default: 'Artist' });
      case 'album': return $t('clipTag.tags.album', { default: 'Album' });
      case 'albumArtist': return $t('clipTag.tags.albumArtist', { default: 'Album artist' });
      case 'composer': return $t('clipTag.tags.composer', { default: 'Composer' });
      case 'genre': return $t('clipTag.tags.genre', { default: 'Genre' });
      case 'year': return $t('clipTag.tags.year', { default: 'Year' });
      case 'trackNumber': return $t('clipTag.tags.track', { default: 'Track' });
      case 'discNumber': return $t('clipTag.tags.disc', { default: 'Disc' });
    }
  }

  function setActiveTab(tab: ToolTab): void {
    if (activeTab === tab) return;
    stopPreview();
    activeTab = tab;
    playhead = Math.min(playhead, tab === 'lyrics' ? sourceBuffer?.duration ?? 0 : duration);
  }

  function snapshot(): EditSnapshot | null {
    return waveformBuffer ? { state: editState, buffer: waveformBuffer } : null;
  }

  function commitEdit(nextState: ClipEditState, nextBuffer: AudioBuffer, notice = ''): void {
    const previous = snapshot();
    if (!previous) return;
    stopPreview();
    undoStack = [...undoStack, previous].slice(-MAX_EDIT_HISTORY);
    redoStack = [];
    editState = nextState;
    waveformBuffer = nextBuffer;
    playhead = Math.min(nextState.selectionStart, nextBuffer.duration);
    noticeMessage = notice;
  }

  function undo(): void {
    const previous = undoStack.at(-1);
    const current = snapshot();
    if (!previous || !current) return;
    stopPreview();
    redoStack = [current, ...redoStack].slice(0, MAX_EDIT_HISTORY);
    undoStack = undoStack.slice(0, -1);
    editState = previous.state;
    waveformBuffer = previous.buffer;
    playhead = Math.min(editState.selectionStart, waveformBuffer.duration);
    noticeMessage = $t('clipTag.edit.undoNotice', { default: 'Edit undone.' });
  }

  function redo(): void {
    const next = redoStack[0];
    const current = snapshot();
    if (!next || !current) return;
    stopPreview();
    undoStack = [...undoStack, current].slice(-MAX_EDIT_HISTORY);
    redoStack = redoStack.slice(1);
    editState = next.state;
    waveformBuffer = next.buffer;
    playhead = Math.min(editState.selectionStart, waveformBuffer.duration);
    noticeMessage = $t('clipTag.edit.redoNotice', { default: 'Edit restored.' });
  }

  function selectAll(): void {
    editState = updateSelection(editState, 0, duration);
  }

  function copySelection(): boolean {
    if (!waveformBuffer || !hasSelection) return false;
    audioClipboard = {
      buffer: sliceAudioBuffer(waveformBuffer, editState.selectionStart, editState.selectionEnd),
      ranges: sliceClipRanges(editState.ranges, editState.selectionStart, editState.selectionEnd)
    };
    noticeMessage = $t('clipTag.edit.copied', {
      default: 'Copied {duration} of audio.',
      values: { duration: formatTime(selectionDuration) }
    });
    return true;
  }

  function deleteSelection(copyFirst = false): void {
    if (!waveformBuffer || !hasSelection || (copyFirst && !copySelection())) return;
    const nextState = cutSelection(editState);
    const nextBuffer = replaceAudioBufferRange(
      waveformBuffer,
      editState.selectionStart,
      editState.selectionEnd,
      null
    );
    commitEdit(
      nextState,
      nextBuffer,
      copyFirst
        ? $t('clipTag.edit.cutNotice', { default: 'Selection cut.' })
        : $t('clipTag.edit.deletedNotice', { default: 'Selection deleted.' })
    );
  }

  function pasteAudio(): void {
    if (!waveformBuffer || !audioClipboard) return;
    const nextBuffer = replaceAudioBufferRange(
      waveformBuffer,
      editState.selectionStart,
      editState.selectionEnd,
      audioClipboard.buffer
    );
    const nextState = replaceSelectionRanges(editState, audioClipboard.ranges);
    commitEdit(nextState, nextBuffer, $t('clipTag.edit.pastedNotice', { default: 'Audio pasted.' }));
  }

  function trimToSelection(): void {
    if (!waveformBuffer || !hasSelection) return;
    commitEdit(
      keepSelection(editState),
      sliceAudioBuffer(waveformBuffer, editState.selectionStart, editState.selectionEnd),
      $t('clipTag.edit.trimmedNotice', { default: 'Trimmed to selection.' })
    );
    resetWaveformViewport();
  }

  function replaceArtwork(next: Blob | null): void {
    if (artworkUrl) URL.revokeObjectURL(artworkUrl);
    artwork = next;
    artworkUrl = next ? URL.createObjectURL(next) : '';
  }

  async function openFile(file: File, fileHandle: FileSystemFileHandle | null = null): Promise<void> {
    const extension = inferExtension(file.name);
    if (!ACCEPTED_EXTENSIONS.includes(extension as (typeof ACCEPTED_EXTENSIONS)[number])) {
      errorMessage = $t('clipTag.unsupported', { default: 'This file type is not supported by Edit and Tag.' });
      return;
    }

    stopPreview();
    resetWaveformViewport();
    loading = true;
    loadProgress = null;
    errorMessage = '';
    noticeMessage = '';
    sourceFile = file;
    sourceFileHandle = fileHandle;
    sourceBuffer = null;
    waveformBuffer = null;
    undoStack = [];
    redoStack = [];
    audioClipboard = null;
    tags = { ...EMPTY_TAGS };
    replaceArtwork(null);

    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const parsed = extension === 'mp3' ? parseId3(bytes) : { tags: { ...EMPTY_TAGS }, artwork: null };
      if ((STREAM_EXTENSIONS as readonly string[]).includes(extension)) {
        const track = {
          id: `clip-tag:${file.name}:${file.size}:${file.lastModified}`,
          file,
          name: file.name,
          extension,
          kind: 'stream' as const,
          size: file.size,
          lastModified: file.lastModified
        };
        const [metadata, embeddedArtwork, embeddedLyrics] = await Promise.all([
          loadTrackMetadata(track),
          loadEmbeddedStreamArtwork(track),
          loadTrackLyrics(track).catch(() => null)
        ]);
        if (metadata) {
          for (const { key } of TAG_FIELDS) {
            parsed.tags[key] = metadata[key] ?? parsed.tags[key];
          }
        }
        if (embeddedArtwork) parsed.artwork = embeddedArtwork.blob;
        if (embeddedLyrics) parsed.tags.lyrics = embeddedLyrics.raw;
      }
      const inferred = inferArtistTitleFromFileName(file.name);
      tags = {
        ...parsed.tags,
        title: parsed.tags.title || inferred?.title || stripFileExtension(file.name),
        artist: parsed.tags.artist || inferred?.artist || ''
      };
      replaceArtwork(parsed.artwork);
      const loaded = await loadAudioFile(file, (progress) => {
        loadProgress = progress;
      });
      sourceBuffer = loaded.buffer;
      playhead = 0;
      renderedModule = loaded.renderedModule;
      renderedFromCache = loaded.fromCache;
      editState = createInitialClipState(loaded.buffer.duration);
      waveformBuffer = materializeClip(loaded.buffer, editState);
      noticeMessage = loaded.renderedModule
        ? loaded.fromCache
          ? $t('clipTag.moduleCached', { default: 'Loaded cached module render.' })
          : $t('clipTag.moduleRendered', { default: 'Module render cached for this session.' })
        : '';
    } catch (error) {
      sourceFile = null;
      sourceFileHandle = null;
      errorMessage = error instanceof Error ? error.message : $t('clipTag.loadFailed', { default: 'The audio file could not be opened.' });
    } finally {
      loading = false;
      loadProgress = null;
    }
  }

  async function chooseAudioFile(): Promise<void> {
    const pickerWindow = window as Window & {
      showOpenFilePicker?: (options?: OpenFilePickerOptions) => Promise<FileSystemFileHandle[]>;
    };
    if (!pickerWindow.showOpenFilePicker) {
      fileInput.click();
      return;
    }
    try {
      const [handle] = await pickerWindow.showOpenFilePicker(OPEN_FILE_PICKER_OPTIONS);
      if (handle) await openFile(await handle.getFile(), handle);
    } catch (error) {
      if ((error as DOMException)?.name !== 'AbortError') {
        errorMessage = error instanceof Error ? error.message : $t('clipTag.loadFailed', { default: 'The audio file could not be opened.' });
      }
    }
  }

  function handleFileInput(event: Event): void {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (file) void openFile(file);
  }

  function handleArtworkInput(event: Event): void {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (file?.type.startsWith('image/')) replaceArtwork(file);
  }

  async function handleWindowDrop(event: DragEvent): Promise<void> {
    event.preventDefault();
    let droppedHandle: FileSystemHandle | null | undefined;
    try {
      droppedHandle = await event.dataTransfer?.items[0]?.getAsFileSystemHandle?.();
    } catch {
      droppedHandle = null;
    }
    if (droppedHandle?.kind === 'file') {
      await openFile(await (droppedHandle as FileSystemFileHandle).getFile(), droppedHandle as FileSystemFileHandle);
      return;
    }
    const file = event.dataTransfer?.files[0];
    if (file) await openFile(file);
  }

  function handleArtworkDrop(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    artworkDragActive = false;
    const file = event.dataTransfer?.files[0];
    if (file?.type.startsWith('image/')) replaceArtwork(file);
  }

  function tickPreview(): void {
    if (!previewPlaying) return;
    playhead = Math.min(previewOffset + (performance.now() - previewStartedAt) / 1000, previewEnd);
    previewFrame = requestAnimationFrame(tickPreview);
  }

  function getPreviewPosition(): number {
    if (!previewPlaying) return playhead;
    return Math.min(previewOffset + (performance.now() - previewStartedAt) / 1000, previewEnd);
  }

  function stopPreview(): void {
    if (previewPlaying) playhead = getPreviewPosition();
    previewSource?.stop();
    previewSource?.disconnect();
    previewSource = null;
    previewPlaying = false;
    cancelAnimationFrame(previewFrame);
  }

  async function startBufferPreview(buffer: AudioBuffer, start: number, end: number, mode: 'clip' | 'lyrics'): Promise<void> {
    stopPreview();
    previewContext ??= new AudioContext();
    await previewContext.resume();
    const source = previewContext.createBufferSource();
    source.buffer = buffer;
    source.connect(previewContext.destination);
    source.onended = () => {
      if (previewSource !== source) return;
      previewSource = null;
      previewPlaying = false;
      playhead = end;
      cancelAnimationFrame(previewFrame);
    };
    previewSource = source;
    previewOffset = start;
    previewEnd = end;
    previewMode = mode;
    previewStartedAt = performance.now();
    previewPlaying = true;
    playhead = start;
    source.start(0, start, Math.max(0.001, end - start));
    previewFrame = requestAnimationFrame(tickPreview);
  }

  async function startPreview(selectionOnly: boolean): Promise<void> {
    if (!waveformBuffer) return;
    const start = selectionOnly && hasSelection
      ? editState.selectionStart
      : playhead >= waveformBuffer.duration - 0.001 ? 0 : Math.max(0, playhead);
    const end = selectionOnly && hasSelection ? editState.selectionEnd : waveformBuffer.duration;
    await startBufferPreview(waveformBuffer, start, end, 'clip');
  }

  function toggleEditorPreview(selectionOnly = false): void {
    if (previewPlaying && previewMode === 'clip') stopPreview();
    else void startPreview(selectionOnly);
  }

  function seekEditor(position: number): void {
    stopPreview();
    playhead = Math.max(0, Math.min(position, duration));
  }

  function zoomToSelection(): void {
    if (!hasSelection || selectionDuration <= 0) return;
    waveformZoom = Math.min(MAX_WAVEFORM_ZOOM, Math.max(1, duration / selectionDuration));
    waveformScrollStart = editState.selectionStart;
  }

  function openEffectDialog(type?: RafEffectType): void {
    if (!canEdit || !hasSelection) return;
    errorMessage = '';
    effectDialog.show(type);
  }

  async function processEffect(
    settings: RafEffectSettings,
    edgeBlendMs: number
  ): Promise<AudioBuffer | null> {
    if (!waveformBuffer || !hasSelection || processingEffect) return null;
    const currentBuffer = waveformBuffer;
    const start = editState.selectionStart;
    const end = editState.selectionEnd;
    processingEffect = true;
    errorMessage = '';
    noticeMessage = '';
    stopPreview();
    try {
      const original = sliceAudioBuffer(currentBuffer, start, end);
      const processed = await renderRafEffect(original, settings);
      return blendRenderedEdges(
        original,
        processed,
        edgeBlendMs,
        start > 0.0005,
        end < currentBuffer.duration - 0.0005
      );
    } catch (error) {
      errorMessage = error instanceof Error
        ? error.message
        : $t('clipTag.effects.failed', { default: 'The effect could not be rendered.' });
      return null;
    } finally {
      processingEffect = false;
    }
  }

  async function previewEffect(settings: RafEffectSettings, edgeBlendMs: number): Promise<void> {
    if (previewPlaying && previewMode === 'clip') {
      stopPreview();
      return;
    }
    const processed = await processEffect(settings, edgeBlendMs);
    if (processed) await startBufferPreview(processed, 0, processed.duration, 'clip');
  }

  async function applyEffect(settings: RafEffectSettings, edgeBlendMs: number): Promise<void> {
    if (!waveformBuffer) return;
    const currentBuffer = waveformBuffer;
    const start = editState.selectionStart;
    const end = editState.selectionEnd;
    const processed = await processEffect(settings, edgeBlendMs);
    if (!processed || waveformBuffer !== currentBuffer) return;
    const nextBuffer = replaceAudioBufferRange(currentBuffer, start, end, processed);
    commitEdit(
      editState,
      nextBuffer,
      $t('clipTag.effects.applied', {
        default: '{effect} applied to selection.',
        values: { effect: settings.displayName || RAF_EFFECT_REGISTRY[settings.type].name }
      })
    );
    effectDialog.close();
  }

  async function startLyricsPreview(): Promise<void> {
    if (!sourceBuffer) return;
    const start = playhead >= sourceBuffer.duration - 0.001 ? 0 : Math.max(0, Math.min(playhead, sourceBuffer.duration));
    await startBufferPreview(sourceBuffer, start, sourceBuffer.duration, 'lyrics');
  }

  function toggleLyricsPreview(): void {
    if (previewPlaying && previewMode === 'lyrics') stopPreview();
    else void startLyricsPreview();
  }

  function seekLyrics(position: number): void {
    const resume = previewPlaying && previewMode === 'lyrics';
    stopPreview();
    playhead = Math.max(0, Math.min(position, sourceBuffer?.duration ?? 0));
    if (resume) void startLyricsPreview();
  }

  function openExportDialog(): void {
    if (!canEdit) return;
    errorMessage = '';
    exportDialog.show();
  }

  async function exportClip(options: ClipExportOptions): Promise<void> {
    if (!waveformBuffer || !sourceFile || exporting) return;
    exporting = true;
    exportingFormat = options.format;
    errorMessage = '';
    noticeMessage = '';
    try {
      const { encodeAudioExport } = await import('./clip-export');
      const exportTags = { ...tags, lyrics: remapLyricsToClip(tags.lyrics, editState.ranges) };
      const blob = await encodeAudioExport(waveformBuffer, options, exportTags, artwork);
      await saveBlob(blob, `${stripFileExtension(sourceFile.name)}-clip.${options.format}`);
      noticeMessage = $t('clipTag.clipSaved', { default: 'Audio exported.' });
      exportDialog.close();
    } catch (error) {
      if ((error as DOMException)?.name !== 'AbortError') {
        errorMessage = error instanceof ClipExportUnavailableError
          ? $t('clipTag.encoderUnavailable', {
              default: '{format} encoding is not available in this browser.',
              values: { format: error.format.toUpperCase() }
            })
          : $t('clipTag.saveFailed', { default: 'The file could not be saved.' });
      }
    } finally {
      exporting = false;
    }
  }

  async function createTaggedOutput(): Promise<{ blob: Blob; suggestedName: string }> {
    if (!sourceFile || !sourceBuffer) throw new Error('No source file is loaded.');
    const extension = inferExtension(sourceFile.name);
    if (extension === 'mp3') {
      return {
        blob: await tagMp3(sourceFile, tags, artwork),
        suggestedName: `${stripFileExtension(sourceFile.name)}-tagged.mp3`
      };
    }
    if (extension === 'wav' || extension === 'flac' || extension === 'ogg' || extension === 'opus') {
      const { tagContainerAudio } = await import('./tag-container-audio');
      return {
        blob: await tagContainerAudio(sourceFile, extension, tags, artwork),
        suggestedName: `${stripFileExtension(sourceFile.name)}-tagged.${extension}`
      };
    }
    const { encodeAudioExport } = await import('./clip-export');
    return {
      blob: await encodeAudioExport(sourceBuffer, DEFAULT_CLIP_EXPORT_OPTIONS, tags, artwork),
      suggestedName: `${stripFileExtension(sourceFile.name)}-tagged.wav`
    };
  }

  async function saveTaggedCopy(): Promise<void> {
    if (!sourceFile || !sourceBuffer || savingTags) return;
    savingTags = true;
    errorMessage = '';
    noticeMessage = '';
    try {
      const output = await createTaggedOutput();
      await saveBlob(output.blob, output.suggestedName);
      noticeMessage = $t('clipTag.tagsSaved', { default: 'Tagged copy saved.' });
    } catch (error) {
      if ((error as DOMException)?.name !== 'AbortError') errorMessage = $t('clipTag.saveFailed', { default: 'The file could not be saved.' });
    } finally {
      savingTags = false;
    }
  }

  async function saveTaggedInPlace(): Promise<void> {
    if (!canSaveInPlace || !sourceFileHandle?.createWritable || savingTags) return;
    savingTags = true;
    errorMessage = '';
    noticeMessage = '';
    try {
      const output = await createTaggedOutput();
      const writable = await sourceFileHandle.createWritable();
      await writable.write(output.blob);
      await writable.close();
      sourceFile = await sourceFileHandle.getFile();
      noticeMessage = $t('clipTag.tagsSavedInPlace', { default: 'Changes saved to the source file.' });
    } catch (error) {
      if ((error as DOMException)?.name !== 'AbortError') errorMessage = $t('clipTag.saveFailed', { default: 'The file could not be saved.' });
    } finally {
      savingTags = false;
    }
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (exportDialog?.isOpen() || effectDialog?.isOpen()) return;
    const target = event.target;
    const editingText = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;
    const key = event.key.toLowerCase();
    if (!editingText && activeTab === 'edit' && key === ' ' && !event.ctrlKey && !event.metaKey) {
      event.preventDefault();
      toggleEditorPreview(false);
      return;
    }
    if (!editingText && activeTab === 'edit' && (key === 'delete' || key === 'backspace')) {
      event.preventDefault();
      deleteSelection();
      return;
    }
    if (!event.ctrlKey && !event.metaKey) return;
    if (key === 'o') { event.preventDefault(); void chooseAudioFile(); }
    else if (key === 'p') { event.preventDefault(); windowManagerOpenOptions(); }
    else if (key === 'w') { event.preventDefault(); window.close(); }
    else if (key === 's' && event.shiftKey && activeTab !== 'edit') { event.preventDefault(); void saveTaggedCopy(); }
    else if (key === 's') { event.preventDefault(); activeTab === 'edit' ? openExportDialog() : canSaveInPlace ? void saveTaggedInPlace() : void saveTaggedCopy(); }
    else if (!editingText && key === 'z' && event.shiftKey && activeTab === 'edit') { event.preventDefault(); redo(); }
    else if (!editingText && key === 'z' && activeTab === 'edit') { event.preventDefault(); undo(); }
    else if (!editingText && key === 'y' && activeTab === 'edit') { event.preventDefault(); redo(); }
    else if (!editingText && key === 'a' && activeTab === 'edit') { event.preventDefault(); selectAll(); }
    else if (!editingText && key === 'x' && activeTab === 'edit') { event.preventDefault(); deleteSelection(true); }
    else if (!editingText && key === 'c' && activeTab === 'edit') { event.preventDefault(); copySelection(); }
    else if (!editingText && key === 'v' && activeTab === 'edit') { event.preventDefault(); pasteAudio(); }
  }

  function windowManagerOpenOptions(): void {
    if (window.opener && !window.opener.closed) {
      window.opener.postMessage({ type: 'izci:open-options' }, window.location.origin);
      return;
    }
    import('$lib/services/window-manager').then(({ windowManager }) => windowManager.openOptions());
  }

  onMount(() => {
    const wasOpenedByMain = window.opener !== null;
    const stopListeningForTrack = listenForCurrentToolTrack((track) => {
      if (
        track.kind !== 'video'
        && ACCEPTED_EXTENSIONS.includes(inferExtension(track.file.name) as (typeof ACCEPTED_EXTENSIONS)[number])
      ) {
        void openFile(track.file, track.fileHandle ?? null);
      }
    });
    const closeIfOrphaned = () => {
      if (wasOpenedByMain && (!window.opener || window.opener.closed)) window.close();
    };
    const interval = window.setInterval(closeIfOrphaned, 1000);
    window.addEventListener('keydown', handleKeydown);
    window.addEventListener('dragover', (event) => event.preventDefault());
    window.addEventListener('drop', handleWindowDrop);
    window.addEventListener('focus', closeIfOrphaned);
    return () => {
      stopListeningForTrack();
      window.clearInterval(interval);
      window.removeEventListener('keydown', handleKeydown);
      window.removeEventListener('drop', handleWindowDrop);
      window.removeEventListener('focus', closeIfOrphaned);
    };
  });

  onDestroy(() => {
    stopPreview();
    if (artworkUrl) URL.revokeObjectURL(artworkUrl);
    void previewContext?.close();
  });
</script>

<svelte:head><title>{sourceFile ? `${sourceFile.name} — Edit and Tag` : 'izci Edit and Tag'}</title></svelte:head>

<div class="tool-shell clip-tag-shell">
  <div class="window-frame-safe-strip" aria-hidden="true"></div>
  <input bind:this={fileInput} class="sr-only" type="file" accept={FILE_ACCEPT} on:change={handleFileInput} />
  <input bind:this={artworkInput} class="sr-only" type="file" accept="image/*" on:change={handleArtworkInput} />

  <ClipTagMenuBar
    fileName={sourceFile?.name ?? ''}
    activeTool={activeTab}
    canSaveClip={canEdit}
    {canSaveTags}
    {canSaveInPlace}
    {canUndo}
    {canRedo}
    canCut={activeTab === 'edit' && canEdit && hasSelection}
    {canPaste}
    on:open={() => void chooseAudioFile()}
    on:saveClip={openExportDialog}
    on:saveInPlace={() => void saveTaggedInPlace()}
    on:saveAs={() => void saveTaggedCopy()}
    on:close={() => window.close()}
    on:undo={undo}
    on:redo={redo}
    on:selectAll={selectAll}
    on:cut={() => deleteSelection(true)}
    on:copy={() => copySelection()}
    on:paste={pasteAudio}
    on:delete={() => deleteSelection()}
    on:trim={trimToSelection}
    on:effect={(event) => openEffectDialog(event.detail)}
  />

  <main class="tool-workspace">
    <TabStrip ariaLabel={$t('clipTag.tabs.label', { default: 'Edit and Tag tools' })} className="tool-tabs" flushStart>
      <button class="tab-strip-tab" class:active={activeTab === 'edit'} type="button" role="tab" aria-selected={activeTab === 'edit'} on:click={() => setActiveTab('edit')}>
        <span class="material-symbols-outlined" aria-hidden="true">edit_audio</span>
        {$t('clipTag.tabs.edit', { default: 'Edit' })}
      </button>
      <button class="tab-strip-tab" class:active={activeTab === 'tags'} type="button" role="tab" aria-selected={activeTab === 'tags'} on:click={() => setActiveTab('tags')}>
        <span class="material-symbols-outlined" aria-hidden="true">new_label</span>
        {$t('clipTag.tabs.tags', { default: 'Tags' })}
      </button>
      <button class="tab-strip-tab" class:active={activeTab === 'lyrics'} type="button" role="tab" aria-selected={activeTab === 'lyrics'} on:click={() => setActiveTab('lyrics')}>
        <span class="material-symbols-outlined" aria-hidden="true">lyrics</span>
        {$t('clipTag.tabs.lyrics', { default: 'Lyrics' })}
      </button>
    </TabStrip>

    {#if activeTab === 'edit'}
      <section class="clip-workbench" aria-label={$t('clipTag.tabs.edit', { default: 'Edit' })}>
        <div class="tool-row tool-toolbar clip-toolbar" role="toolbar" aria-label={$t('clipTag.edit.toolbar', { default: 'Audio editing tools' })}>
          <div class="toolbar-group" aria-label={$t('clipTag.edit.history', { default: 'History' })}>
            <button class="icon-button hover-tooltip-anchor" type="button" disabled={!canUndo} aria-label={$t('clipTag.menu.undo', { default: 'Undo' })} on:click={undo}><span class="material-symbols-outlined" aria-hidden="true">undo</span><HoverTooltip>{$t('clipTag.menu.undo', { default: 'Undo' })}</HoverTooltip></button>
            <button class="icon-button hover-tooltip-anchor" type="button" disabled={!canRedo} aria-label={$t('clipTag.menu.redo', { default: 'Redo' })} on:click={redo}><span class="material-symbols-outlined" aria-hidden="true">redo</span><HoverTooltip>{$t('clipTag.menu.redo', { default: 'Redo' })}</HoverTooltip></button>
          </div>
          <span class="toolbar-separator" aria-hidden="true"></span>
          <div class="toolbar-group" aria-label={$t('clipTag.edit.clipboard', { default: 'Clipboard' })}>
            <button class="icon-button hover-tooltip-anchor" type="button" disabled={!canEdit || !hasSelection} aria-label={$t('clipTag.edit.cut', { default: 'Cut' })} on:click={() => deleteSelection(true)}><span class="material-symbols-outlined" aria-hidden="true">content_cut</span><HoverTooltip>{$t('clipTag.edit.cutShortcut', { default: 'Cut · Ctrl+X' })}</HoverTooltip></button>
            <button class="icon-button hover-tooltip-anchor" type="button" disabled={!canEdit || !hasSelection} aria-label={$t('clipTag.edit.copy', { default: 'Copy' })} on:click={() => copySelection()}><span class="material-symbols-outlined" aria-hidden="true">content_copy</span><HoverTooltip>{$t('clipTag.edit.copyShortcut', { default: 'Copy · Ctrl+C' })}</HoverTooltip></button>
            <button class="icon-button hover-tooltip-anchor" type="button" disabled={!canPaste} aria-label={$t('clipTag.edit.paste', { default: 'Paste' })} on:click={pasteAudio}><span class="material-symbols-outlined" aria-hidden="true">content_paste</span><HoverTooltip>{$t('clipTag.edit.pasteShortcut', { default: 'Paste · Ctrl+V' })}</HoverTooltip></button>
            <button class="icon-button hover-tooltip-anchor" type="button" disabled={!canEdit || !hasSelection} aria-label={$t('clipTag.edit.delete', { default: 'Delete' })} on:click={() => deleteSelection()}><span class="material-symbols-outlined" aria-hidden="true">delete</span><HoverTooltip>{$t('clipTag.edit.deleteShortcut', { default: 'Delete selection · Del' })}</HoverTooltip></button>
            <button class="icon-button hover-tooltip-anchor" type="button" disabled={!canEdit || !hasSelection} aria-label={$t('clipTag.edit.trim', { default: 'Trim to selection' })} on:click={trimToSelection}><span class="material-symbols-outlined" aria-hidden="true">content_cut</span><HoverTooltip>{$t('clipTag.edit.trim', { default: 'Trim to selection' })}</HoverTooltip></button>
          </div>
          <span class="toolbar-separator" aria-hidden="true"></span>
          <button class="text-button effects-button" type="button" disabled={!canEdit || !hasSelection} on:click={() => openEffectDialog()}><span class="material-symbols-outlined" aria-hidden="true">auto_fix_high</span>{$t('clipTag.effects.button', { default: 'Effects...' })}</button>
          <span class="toolbar-separator" aria-hidden="true"></span>
          <div class="toolbar-group transport-group" aria-label={$t('clipTag.edit.transport', { default: 'Navigation and preview' })}>
            <button class="icon-button hover-tooltip-anchor" type="button" disabled={!canEdit} aria-label={$t('clipTag.edit.selectionStart', { default: 'Go to selection start' })} on:click={() => seekEditor(hasSelection ? editState.selectionStart : 0)}><span class="material-symbols-outlined" aria-hidden="true">skip_previous</span><HoverTooltip>{$t('clipTag.edit.selectionStart', { default: 'Go to selection start' })}</HoverTooltip></button>
            <button class="icon-button transport-play hover-tooltip-anchor" class:is-active={previewPlaying && previewMode === 'clip'} type="button" disabled={!canEdit} aria-label={$t('clipTag.edit.play', { default: 'Play from cursor' })} on:click={() => toggleEditorPreview(false)}><span class="material-symbols-outlined" aria-hidden="true">{previewPlaying && previewMode === 'clip' ? 'stop' : 'play_arrow'}</span><HoverTooltip>{$t('clipTag.edit.playShortcut', { default: 'Play from cursor · Space' })}</HoverTooltip></button>
            <button class="icon-button hover-tooltip-anchor" type="button" disabled={!canEdit || !hasSelection} aria-label={$t('clipTag.edit.playSelection', { default: 'Play selection' })} on:click={() => toggleEditorPreview(true)}><span class="material-symbols-outlined" aria-hidden="true">play_circle</span><HoverTooltip>{$t('clipTag.edit.playSelection', { default: 'Play selection' })}</HoverTooltip></button>
            <button class="icon-button hover-tooltip-anchor" type="button" disabled={!canEdit} aria-label={$t('clipTag.edit.selectionEnd', { default: 'Go to selection end' })} on:click={() => seekEditor(hasSelection ? editState.selectionEnd : duration)}><span class="material-symbols-outlined" aria-hidden="true">skip_next</span><HoverTooltip>{$t('clipTag.edit.selectionEnd', { default: 'Go to selection end' })}</HoverTooltip></button>
            <span class="transport-time">{formatTime(playhead)} / {formatTime(duration)}</span>
          </div>
          <div class="toolbar-spacer"></div>
          <div class="toolbar-group zoom-group" aria-label={$t('clipTag.edit.zoom', { default: 'Zoom' })}>
            <button class="icon-button hover-tooltip-anchor" type="button" disabled={!canEdit || waveformZoom <= 1} aria-label={$t('clipTag.clip.zoomOut', { default: 'Zoom out' })} on:click={() => setWaveformZoom(waveformZoom / 2)}><span class="material-symbols-outlined" aria-hidden="true">zoom_out</span><HoverTooltip>{$t('clipTag.clip.zoomOut', { default: 'Zoom out' })}</HoverTooltip></button>
            <button class="text-button zoom-level-button hover-tooltip-anchor" type="button" disabled={!canEdit || waveformZoom <= 1} aria-label={$t('clipTag.clip.fitWaveform', { default: 'Fit waveform (Ctrl+wheel to zoom)' })} on:click={resetWaveformViewport}>{formatWaveformZoom(waveformZoom)}<HoverTooltip>{$t('clipTag.clip.fitWaveform', { default: 'Fit waveform (Ctrl+wheel to zoom)' })}</HoverTooltip></button>
            <button class="icon-button hover-tooltip-anchor" type="button" disabled={!canEdit || waveformZoom >= MAX_WAVEFORM_ZOOM} aria-label={$t('clipTag.clip.zoomIn', { default: 'Zoom in' })} on:click={() => setWaveformZoom(waveformZoom * 2)}><span class="material-symbols-outlined" aria-hidden="true">zoom_in</span><HoverTooltip>{$t('clipTag.clip.zoomIn', { default: 'Zoom in' })}</HoverTooltip></button>
            <button class="icon-button hover-tooltip-anchor" type="button" disabled={!canEdit || !hasSelection} aria-label={$t('clipTag.edit.zoomSelection', { default: 'Zoom to selection' })} on:click={zoomToSelection}><span class="material-symbols-outlined" aria-hidden="true">zoom_in_map</span><HoverTooltip>{$t('clipTag.edit.zoomSelection', { default: 'Zoom to selection' })}</HoverTooltip></button>
          </div>
          <span class="toolbar-separator" aria-hidden="true"></span>
          <button class="text-button primary export-button" type="button" disabled={!canEdit} on:click={openExportDialog}><span class="material-symbols-outlined" aria-hidden="true">save</span>{$t('clipTag.clip.exportOpen', { default: 'Export...' })}</button>
        </div>

        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
          class="waveform-frame"
          class:is-loading={loading}
          on:contextmenu|preventDefault={(event) => openContextMenu(event, 'waveform')}
        >
          <WaveformEditor
            buffer={waveformBuffer}
            selectionStart={editState.selectionStart}
            selectionEnd={editState.selectionEnd}
            {playhead}
            disabled={!canEdit}
            bind:zoom={waveformZoom}
            bind:scrollStart={waveformScrollStart}
            on:selection={(event) => (editState = updateSelection(editState, event.detail.start, event.detail.end))}
            on:seek={(event) => seekEditor(event.detail)}
          />
          {#if !sourceFile && !loading}
            <button class="tool-empty-state empty-drop-target" type="button" on:click={() => void chooseAudioFile()}>
              <span class="material-symbols-outlined" aria-hidden="true">audio_file</span>
              <strong>{$t('clipTag.openPrompt', { default: 'Open audio' })}</strong>
              <span>{$t('clipTag.dropPrompt', { default: 'or drop a file here' })}</span>
            </button>
          {:else if loading}
            <div class="render-overlay" role="status">
              <span class="material-symbols-outlined spinning" aria-hidden="true">progress_activity</span>
              <strong>{loadProgress?.phase === 'rendering' ? $t('clipTag.rendering', { default: 'Rendering module to audio...' }) : $t('clipTag.decoding', { default: 'Decoding audio...' })}</strong>
              {#if loadProgress?.progress !== null && loadProgress?.progress !== undefined}
                <progress max="1" value={loadProgress.progress}></progress>
              {/if}
              <span>{loadProgress?.detail ?? ''}</span>
            </div>
          {/if}
        </div>

        <div class="selection-readout">
          <label>{$t('clipTag.clip.start', { default: 'Start' })}<input type="number" min="0" max={duration} step="0.001" value={editState.selectionStart.toFixed(3)} disabled={!canEdit} on:change={(event) => (editState = updateSelection(editState, Number(event.currentTarget.value), editState.selectionEnd))} /></label>
          <label>{$t('clipTag.clip.end', { default: 'End' })}<input type="number" min="0" max={duration} step="0.001" value={editState.selectionEnd.toFixed(3)} disabled={!canEdit} on:change={(event) => (editState = updateSelection(editState, editState.selectionStart, Number(event.currentTarget.value)))} /></label>
          <span>{$t('clipTag.clip.selection', { default: 'Selection' })}: <strong>{formatTime(selectionDuration)}</strong></span>
          <span>{$t('clipTag.clip.output', { default: 'Output' })}: <strong>{formatTime(duration)}</strong></span>
          {#if renderedModule}<span class="render-badge"><span class="material-symbols-outlined" aria-hidden="true">memory</span>{renderedFromCache ? $t('clipTag.cached', { default: 'Cached render' }) : $t('clipTag.rendered', { default: 'Rendered module' })}</span>{/if}
        </div>
      </section>
    {:else if activeTab === 'tags'}
      <section class="tags-workbench" aria-label={$t('clipTag.tabs.tags', { default: 'Tags' })}>
        <div class="tag-form">
          {#each TAG_FIELDS as field}
            <label class:wide={field.wide}>
              <span>{tagFieldLabel(field.key)}</span>
              <input type="text" value={tags[field.key]} disabled={!sourceFile} on:input={(event) => (tags = { ...tags, [field.key]: event.currentTarget.value })} />
            </label>
          {/each}
        </div>
        <aside class="artwork-editor">
          <h2>{$t('clipTag.tags.artwork', { default: 'Artwork' })}</h2>
          <div
            class="artwork-drop"
            class:is-dragging={artworkDragActive}
            role="region"
            aria-label={$t('clipTag.tags.artworkDropZone', { default: 'Artwork drop zone' })}
            on:contextmenu|preventDefault={(event) => openContextMenu(event, 'artwork')}
            on:dragenter={(event) => { event.preventDefault(); artworkDragActive = true; }}
            on:dragover={(event) => event.preventDefault()}
            on:dragleave={() => (artworkDragActive = false)}
            on:drop={handleArtworkDrop}
          >
            {#if artworkUrl}
              <img src={artworkUrl} alt={$t('clipTag.tags.artworkPreview', { default: 'Artwork preview' })} />
            {:else}
              <span class="material-symbols-outlined" aria-hidden="true">image</span>
              <span>{$t('clipTag.tags.dropArtwork', { default: 'Drop artwork here' })}</span>
            {/if}
          </div>
          <div class="artwork-actions">
            <button class="text-button" type="button" disabled={!sourceFile} on:click={() => artworkInput.click()}><span class="material-symbols-outlined" aria-hidden="true">folder_open</span>{$t('clipTag.tags.browse', { default: 'Browse...' })}</button>
            <button class="icon-button hover-tooltip-anchor" type="button" disabled={!artwork} aria-label={$t('clipTag.tags.removeArtwork', { default: 'Remove artwork' })} on:click={() => replaceArtwork(null)}><span class="material-symbols-outlined" aria-hidden="true">delete</span><HoverTooltip>{$t('clipTag.tags.removeArtwork', { default: 'Remove artwork' })}</HoverTooltip></button>
          </div>
          <p>
            {#if sourceFile && ['wav', 'mp3', 'flac', 'ogg', 'opus'].includes(inferExtension(sourceFile.name))}
              {$t('clipTag.tags.copyNote', { default: 'A new {format} copy is written without changing the source file.', values: { format: inferExtension(sourceFile.name).toUpperCase() } })}
            {:else}
              {$t('clipTag.tags.renderedCopyNote', { default: 'Modules are rendered to a tagged WAV copy; the source file is never changed.' })}
            {/if}
          </p>
          <div class="tag-save-actions">
            <button class="icon-button hover-tooltip-anchor" type="button" disabled={!canSaveInPlace} aria-label={$t('clipTag.menu.saveInPlace', { default: 'Save' })} on:click={() => void saveTaggedInPlace()}><span class="material-symbols-outlined" aria-hidden="true">save</span><HoverTooltip>{$t('clipTag.menu.saveInPlace', { default: 'Save' })}</HoverTooltip></button>
            <button class="icon-button hover-tooltip-anchor" type="button" disabled={!canSaveTags} aria-label={$t('clipTag.menu.saveAs', { default: 'Save as...' })} on:click={() => void saveTaggedCopy()}><span class="material-symbols-outlined" aria-hidden="true">save_as</span><HoverTooltip>{$t('clipTag.menu.saveAs', { default: 'Save as...' })}</HoverTooltip></button>
          </div>
        </aside>
      </section>
    {:else}
      <LyricsEditor
        value={tags.lyrics}
        currentTime={playhead}
        duration={sourceBuffer?.duration ?? 0}
        disabled={!canSaveTags}
        playing={previewPlaying && previewMode === 'lyrics'}
        trackTitle={sourceFile?.name ?? ''}
        {canSaveInPlace}
        getCurrentTime={getPreviewPosition}
        on:change={(event) => (tags = { ...tags, lyrics: event.detail })}
        on:togglePlayback={toggleLyricsPreview}
        on:seek={(event) => seekLyrics(event.detail)}
        on:saveInPlace={() => void saveTaggedInPlace()}
        on:saveAs={() => void saveTaggedCopy()}
      />
    {/if}
  </main>

  {#if contextMenuKind}
    <MenuSurface
      items={contextMenuItems}
      x={contextMenuX}
      y={contextMenuY}
      ariaLabel={contextMenuKind === 'waveform'
        ? $t('clipTag.clip.waveform', { default: 'Editable audio waveform and selection' })
        : $t('clipTag.tags.artwork', { default: 'Artwork' })}
      enableOverflowSubmenuFallback
      on:action={(event) => runContextMenuAction(event.detail)}
      on:dismiss={() => (contextMenuKind = null)}
    />
  {/if}

  <ClipEffectDialog
    bind:this={effectDialog}
    busy={processingEffect}
    previewing={previewPlaying && previewMode === 'clip'}
    {selectionDuration}
    on:preview={(event) => void previewEffect(event.detail.settings, event.detail.edgeBlendMs)}
    on:apply={(event) => void applyEffect(event.detail.settings, event.detail.edgeBlendMs)}
    on:close={stopPreview}
  />

  <ClipExportDialog
    bind:this={exportDialog}
    busy={exporting}
    {errorMessage}
    sourceSampleRate={waveformBuffer?.sampleRate ?? 0}
    sourceChannels={waveformBuffer?.numberOfChannels ?? 0}
    on:export={(event) => void exportClip(event.detail)}
    on:close={() => { if (!exporting) errorMessage = ''; }}
  />

  <footer class="tool-status-bar" class:error={Boolean(errorMessage)}>
    <span class="material-symbols-outlined" aria-hidden="true">{errorMessage ? 'error' : loading ? 'progress_activity' : 'info'}</span>
    <span>{statusText}</span>
  </footer>
</div>
