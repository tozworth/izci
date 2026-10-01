<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { t } from 'svelte-i18n';
  import HoverTooltip from '$lib/components/HoverTooltip.svelte';
  import MenuSurface from '$lib/components/MenuSurface.svelte';
  import { MODULE_EXTENSIONS, STREAM_EXTENSIONS } from '$lib/types';
  import { listenForCurrentToolTrack } from '$lib/services/tool-track-context';
  import { RAF_EFFECT_DEFINITIONS, RAF_EFFECT_REGISTRY } from '$lib/services/raf-effect-registry';
  import { inferExtension, stripFileExtension } from '$lib/utils/files';
  import EditorMenuBar from './EditorMenuBar.svelte';
  import ClipEffectDialog from './ClipEffectDialog.svelte';
  import ClipExportDialog from './ClipExportDialog.svelte';
  import WaveformEditor from './WaveformEditor.svelte';
  import {
    createInitialClipState,
    cutSelection,
    keepSelection,
    loadAudioFile,
    replaceSelectionRanges,
    saveBlob,
    sliceClipRanges,
    updateSelection,
    type AudioLoadProgress,
    type ClipEditState
  } from './clip-audio';
  import { EMPTY_TAGS, type EditableTags } from './tag-writer';
  import { createEditorFileLoadCoordinator } from './editor-file-load';
  import { remapLyricsToClip } from './lyrics-editor';
  import {
    ClipExportUnavailableError,
    type ClipExportFormat,
    type ClipExportOptions
  } from './clip-export-options';
  import { blendRenderedEdges, isClipSpeedEffect, renderClipEffect, type ClipEffectSettings } from './clip-effects';
  import { MAX_WAVEFORM_ZOOM, zoomWaveformViewport } from './waveform-viewport';
  import type { MenuActionItem, RafEffectType } from '$lib/types';

  import {
    createAudioDocument, documentFrameAt, sliceAudioDocument, replaceAudioDocumentRange, materializeAudioDocument,
    type AudioDocument
  } from './audio-document';
  import { createEditorPreview } from './editor-preview';
  import { loadEditorMetadata } from './editor-metadata';
  import { retainEditorHistory } from './editor-history';
  interface EditSnapshot {
    state: ClipEditState;
    audio: AudioDocument;
  }
  interface AudioClipboard {
    audio: AudioDocument;
    ranges: ClipEditState['ranges'];
  }
  const ACCEPTED_EXTENSIONS = [...STREAM_EXTENSIONS, ...MODULE_EXTENSIONS];
  const FILE_ACCEPT = ACCEPTED_EXTENSIONS.map((extension) => `.${extension}`).join(',');
  const OPEN_FILE_PICKER_OPTIONS: OpenFilePickerOptions = {
    multiple: false,
    types: [{
      description: 'Audio files',
      accept: { 'audio/*': ACCEPTED_EXTENSIONS.map((extension) => `.${extension}`) }
    }]
  };


  let fileInput: HTMLInputElement;
  let exportDialog: ClipExportDialog;
  let effectDialog: ClipEffectDialog;
  let sourceFile: File | null = null;
  let audio: AudioDocument | null = null;
  let editState: ClipEditState = createInitialClipState(0);
  let undoStack: EditSnapshot[] = [];
  let redoStack: EditSnapshot[] = [];
  let audioClipboard: AudioClipboard | null = null;
  let loading = false;
  let loadProgress: AudioLoadProgress | null = null;
  let errorMessage = '';
  let noticeMessage = '';
  let tags: EditableTags = { ...EMPTY_TAGS };
  let artwork: Blob | null = null;
  let previewPlaying = false;
  let playhead = 0;
  let exporting = false;
  let exportingFormat: ClipExportFormat = 'wav';
  let processingEffect = false;
  let waveformZoom = 1;
  let waveformScrollStart = 0;
  let twoChannelView = false;
  let contextMenuOpen = false;
  let contextMenuX = 0;
  let contextMenuY = 0;
  let metadataTask: Promise<void> = Promise.resolve();
  let operation: AbortController | null = null;
  const preview = createEditorPreview({
    position: (position) => { playhead = position; },
    playing: (playing) => { previewPlaying = playing; }
  });
  const fileLoads = createEditorFileLoadCoordinator();

  $: duration = audio?.duration ?? 0;
  $: selectionDuration = Math.max(0, editState.selectionEnd - editState.selectionStart);
  $: hasSelection = selectionDuration > 0.001;
  $: canUndo = undoStack.length > 0;
  $: canRedo = redoStack.length > 0;
  $: canEdit = Boolean(audio && !loading && !exporting && !processingEffect);
  $: canPaste = Boolean(canEdit && audioClipboard);
  $: statusText = errorMessage || (processingEffect
    ? $t('editor.effects.rendering', { default: 'Rendering selection...' })
    : exporting
    ? $t('editor.encoding', { default: 'Encoding {format}...', values: { format: exportingFormat.toUpperCase() } })
    : noticeMessage) || (loadProgress
    ? loadProgress.detail
    : sourceFile
      ? `${formatTime(duration)} · ${audio?.sampleRate.toLocaleString() ?? 0} Hz · ${audio?.numberOfChannels ?? 0} ch`
      : $t('editor.emptyHint', { default: 'Open or drop an audio file to begin.' }));
  $: contextMenuItems = contextMenuOpen ? buildWaveformContextMenu() : [];

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
      audio?.duration ?? 0,
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
        label: $t('editor.menu.undo', { default: 'Undo' }),
        icon: 'undo',
        shortcut: 'Ctrl+Z',
        disabled: !canEdit || !canUndo
      },
      {
        id: 'redo',
        label: $t('editor.menu.redo', { default: 'Redo' }),
        icon: 'redo',
        shortcut: 'Ctrl+Y',
        disabled: !canEdit || !canRedo
      },
      {
        id: 'cut',
        label: $t('editor.edit.cut', { default: 'Cut' }),
        icon: 'content_cut',
        shortcut: 'Ctrl+X',
        disabled: !canEdit || !hasSelection,
        separatorBefore: true
      },
      {
        id: 'copy',
        label: $t('editor.edit.copy', { default: 'Copy' }),
        icon: 'content_copy',
        shortcut: 'Ctrl+C',
        disabled: !canEdit || !hasSelection
      },
      {
        id: 'paste',
        label: $t('editor.edit.paste', { default: 'Paste' }),
        icon: 'content_paste',
        shortcut: 'Ctrl+V',
        disabled: !canPaste
      },
      {
        id: 'delete',
        label: $t('editor.edit.delete', { default: 'Delete' }),
        icon: 'delete',
        shortcut: 'Del',
        disabled: !canEdit || !hasSelection
      },
      {
        id: 'trim',
        label: $t('editor.edit.trim', { default: 'Trim to selection' }),
        icon: 'crop',
        disabled: !canEdit || !hasSelection,
        separatorBefore: true
      },
      {
        id: 'selectAll',
        label: $t('editor.menu.selectAll', { default: 'Select all' }),
        icon: 'select_all',
        shortcut: 'Ctrl+A',
        disabled: !canEdit
      },
      {
        id: 'effects',
        label: $t('editor.effects.button', { default: 'Effects...' }),
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
        label: previewPlaying
          ? $t('audioCompare.stop', { default: 'Stop' })
          : $t('editor.edit.play', { default: 'Play' }),
        icon: previewPlaying ? 'stop' : 'play_arrow',
        shortcut: 'Space',
        disabled: !canEdit,
        separatorBefore: true
      },
      {
        id: 'playFromCursor',
        label: $t('editor.edit.playFromCursor', { default: 'Play from cursor' }),
        icon: 'play_arrow',
        shortcut: 'Shift+Space',
        disabled: !canEdit
      },
      {
        id: 'zoom',
        label: $t('editor.edit.zoom', { default: 'Zoom' }),
        icon: 'zoom_in',
        children: [
          { id: 'zoomIn', label: $t('editor.clip.zoomIn', { default: 'Zoom in' }), icon: 'zoom_in', disabled: !canEdit || waveformZoom >= MAX_WAVEFORM_ZOOM },
          { id: 'zoomOut', label: $t('editor.clip.zoomOut', { default: 'Zoom out' }), icon: 'zoom_out', disabled: !canEdit || waveformZoom <= 1 },
          { id: 'fit', label: $t('editor.clip.fitWaveform', { default: 'Fit waveform (Ctrl+wheel to zoom)' }), icon: 'fit_screen', disabled: !canEdit || waveformZoom <= 1, separatorBefore: true },
          { id: 'zoomSelection', label: $t('editor.edit.zoomSelection', { default: 'Zoom to selection' }), icon: 'zoom_in_map', disabled: !canEdit || !hasSelection }
        ]
      },
      {
        id: 'export',
        label: $t('editor.clip.exportOpen', { default: 'Export...' }),
        icon: 'save',
        shortcut: 'Ctrl+S',
        disabled: !canEdit,
        separatorBefore: true
      }
    ];
  }

  function openContextMenu(event: MouseEvent): void {
    contextMenuOpen = true;
    contextMenuX = event.clientX;
    contextMenuY = event.clientY;
  }

  function runContextMenuAction(action: string): void {
    contextMenuOpen = false;
    if (action === 'undo') undo();
    else if (action === 'redo') redo();
    else if (action === 'cut') deleteSelection(true);
    else if (action === 'copy') copySelection();
    else if (action === 'paste') pasteAudio();
    else if (action === 'delete') deleteSelection();
    else if (action === 'trim') trimToSelection();
    else if (action === 'selectAll') selectAll();
    else if (action === 'play') toggleEditorPreview();
    else if (action === 'playFromCursor') toggleEditorPreview(false);
    else if (action === 'zoomIn') setWaveformZoom(waveformZoom * 2);
    else if (action === 'zoomOut') setWaveformZoom(waveformZoom / 2);
    else if (action === 'fit') resetWaveformViewport();
    else if (action === 'zoomSelection') zoomToSelection();
    else if (action === 'export') openExportDialog();
    else if (action.startsWith('effect:')) openEffectDialog(action.slice(7) as RafEffectType | 'speed');
  }

  function snapshot(): EditSnapshot | null {
    return audio ? { state: editState, audio } : null;
  }

  function commitEdit(nextState: ClipEditState, nextAudio: AudioDocument, notice = ''): void {
    const previous = snapshot();
    if (!previous) return;
    stopPreview();
    undoStack = retainEditorHistory([...undoStack, previous], nextAudio);
    redoStack = [];
    editState = nextState;
    audio = nextAudio;
    playhead = Math.min(nextState.selectionStart, nextAudio.duration);
    noticeMessage = notice;
  }

  function undo(): void {
    if (!canEdit) return;
    const previous = undoStack.at(-1);
    const current = snapshot();
    if (!previous || !current) return;
    stopPreview();
    redoStack = retainEditorHistory([current, ...redoStack], previous.audio, true);
    undoStack = undoStack.slice(0, -1);
    editState = previous.state;
    audio = previous.audio;
    playhead = Math.min(editState.selectionStart, audio.duration);
    noticeMessage = $t('editor.edit.undoNotice', { default: 'Edit undone.' });
  }

  function redo(): void {
    if (!canEdit) return;
    const next = redoStack[0];
    const current = snapshot();
    if (!next || !current) return;
    stopPreview();
    undoStack = retainEditorHistory([...undoStack, current], next.audio);
    redoStack = redoStack.slice(1);
    editState = next.state;
    audio = next.audio;
    playhead = Math.min(editState.selectionStart, audio.duration);
    noticeMessage = $t('editor.edit.redoNotice', { default: 'Edit restored.' });
  }

  function selectAll(): void {
    if (canEdit) setSelection(0, duration);
  }

  function setSelection(start: number, end: number): void {
    if (!canEdit || !audio) return;
    editState = updateSelection(editState,
      documentFrameAt(audio, start) / audio.sampleRate, documentFrameAt(audio, end) / audio.sampleRate);
  }

  function copySelection(): boolean {
    if (!canEdit || !audio || !hasSelection) return false;
    audioClipboard = {
      audio: sliceAudioDocument(audio, editState.selectionStart, editState.selectionEnd),
      ranges: sliceClipRanges(editState.ranges, editState.selectionStart, editState.selectionEnd)
    };
    noticeMessage = $t('editor.edit.copied', {
      default: 'Copied {duration} of audio.',
      values: { duration: formatTime(selectionDuration) }
    });
    return true;
  }

  function deleteSelection(copyFirst = false): void {
    if (!canEdit || !audio || !hasSelection || (copyFirst && !copySelection())) return;
    const nextState = cutSelection(editState);
    const nextAudio = replaceAudioDocumentRange(
      audio,
      editState.selectionStart,
      editState.selectionEnd,
      null
    );
    commitEdit(
      nextState,
      nextAudio,
      copyFirst
        ? $t('editor.edit.cutNotice', { default: 'Selection cut.' })
        : $t('editor.edit.deletedNotice', { default: 'Selection deleted.' })
    );
  }

  function pasteAudio(): void {
    if (!canEdit || !audio || !audioClipboard) return;
    const nextAudio = replaceAudioDocumentRange(
      audio,
      editState.selectionStart,
      editState.selectionEnd,
      audioClipboard.audio
    );
    const nextState = replaceSelectionRanges(editState, audioClipboard.ranges);
    commitEdit(nextState, nextAudio, $t('editor.edit.pastedNotice', { default: 'Audio pasted.' }));
  }

  function trimToSelection(): void {
    if (!canEdit || !audio || !hasSelection) return;
    commitEdit(
      keepSelection(editState),
      sliceAudioDocument(audio, editState.selectionStart, editState.selectionEnd),
      $t('editor.edit.trimmedNotice', { default: 'Trimmed to selection.' })
    );
    resetWaveformViewport();
  }

  async function openFile(file: File): Promise<void> {
    const extension = inferExtension(file.name);
    if (!ACCEPTED_EXTENSIONS.includes(extension as (typeof ACCEPTED_EXTENSIONS)[number])) {
      errorMessage = $t('editor.unsupported', { default: 'This file type is not supported by Editor.' });
      return;
    }

    const load = fileLoads.begin();
    operation?.abort();
    operation = null;
    processingEffect = false;
    exporting = false;

    stopPreview();
    resetWaveformViewport();
    loading = true;
    loadProgress = null;
    errorMessage = '';
    noticeMessage = '';
    sourceFile = file;
    audio = null;
    undoStack = [];
    redoStack = [];
    audioClipboard = null;
    tags = { ...EMPTY_TAGS };
    artwork = null;
    editState = createInitialClipState(0);
    playhead = 0;

    metadataTask = loadEditorMetadata(file, load.signal).then((metadata) => {
      if (!load.isCurrent()) return;
      tags = metadata.tags;
      artwork = metadata.artwork;
    }).catch(() => undefined);
    try {
      const loaded = await loadAudioFile(file, (progress) => {
        if (load.isCurrent()) loadProgress = progress;
      }, load.signal);
      if (!load.isCurrent()) return;
      playhead = 0;
      editState = createInitialClipState(loaded.buffer.duration);
      audio = createAudioDocument(loaded.buffer);
      noticeMessage = loaded.renderedModule
        ? loaded.fromCache
          ? $t('editor.moduleCached', { default: 'Loaded cached module render.' })
          : $t('editor.moduleRendered', { default: 'Module rendered for editing.' })
        : '';
    } catch (error) {
      if (!load.isCurrent()) return;
      sourceFile = null;
      errorMessage = error instanceof Error ? error.message : $t('editor.loadFailed', { default: 'The audio file could not be opened.' });
    } finally {
      if (load.isCurrent()) {
        loading = false;
        loadProgress = null;
        // The waveform can be used while tags finish in the background. Export waits
        // for this task; a new file still invalidates its metadata callback.
        await metadataTask;
        load.finish();
      }
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
      if (handle) await openFile(await handle.getFile());
    } catch (error) {
      if ((error as DOMException)?.name !== 'AbortError') {
        errorMessage = error instanceof Error ? error.message : $t('editor.loadFailed', { default: 'The audio file could not be opened.' });
      }
    }
  }

  function handleFileInput(event: Event): void {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (file) void openFile(file);
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
      await openFile(await (droppedHandle as FileSystemFileHandle).getFile());
      return;
    }
    const file = event.dataTransfer?.files[0];
    if (file) await openFile(file);
  }

  function stopPreview(): void {
    preview.stop();
  }

  async function startPreview(selectionOnly: boolean): Promise<void> {
    if (!canEdit || !audio) return;
    const start = selectionOnly && hasSelection
      ? editState.selectionStart
      : playhead >= audio.duration - 0.001 ? 0 : Math.max(0, playhead);
    const end = selectionOnly && hasSelection ? editState.selectionEnd : audio.duration;
    await preview.start(audio, start, end);
  }

  function toggleEditorPreview(selectionOnly = true): void {
    if (previewPlaying) stopPreview();
    else void startPreview(selectionOnly).catch((error) => {
      errorMessage = error instanceof Error ? error.message : $t('editor.loadFailed', { default: 'The audio file could not be opened.' });
    });
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

  function openEffectDialog(type?: RafEffectType | 'speed'): void {
    if (!canEdit || !hasSelection) return;
    errorMessage = '';
    effectDialog.show(type);
  }

  async function processEffect(
    settings: ClipEffectSettings,
    edgeBlendMs: number
  ): Promise<AudioBuffer | null> {
    if (!canEdit || !audio || !hasSelection || processingEffect) return null;
    const currentAudio = audio;
    const start = editState.selectionStart;
    const end = editState.selectionEnd;
    const job = new AbortController();
    operation?.abort();
    operation = job;
    processingEffect = true;
    errorMessage = '';
    noticeMessage = '';
    stopPreview();
    try {
      const original = await materializeAudioDocument(sliceAudioDocument(currentAudio, start, end), job.signal);
      const processed = await renderClipEffect(original, settings, job.signal);
      job.signal.throwIfAborted();
      return isClipSpeedEffect(settings) ? processed : blendRenderedEdges(
        original,
        processed,
        edgeBlendMs,
        start > 0.0005,
        end < currentAudio.duration - 0.0005
      );
    } catch (error) {
      if (job.signal.aborted) return null;
      errorMessage = error instanceof Error
        ? error.message
        : $t('editor.effects.failed', { default: 'The effect could not be rendered.' });
      return null;
    } finally {
      if (operation === job) { operation = null; processingEffect = false; }
    }
  }

  async function previewEffect(settings: ClipEffectSettings, edgeBlendMs: number): Promise<void> {
    if (previewPlaying) {
      stopPreview();
      return;
    }
    const currentAudio = audio;
    const processed = await processEffect(settings, edgeBlendMs);
    if (processed && audio === currentAudio) await preview.start(createAudioDocument(processed), 0, processed.duration);

  }

  async function applyEffect(settings: ClipEffectSettings, edgeBlendMs: number): Promise<void> {
    if (!audio) return;
    const currentAudio = audio;
    const currentState = editState;
    const start = editState.selectionStart;
    const end = editState.selectionEnd;
    const processed = await processEffect(settings, edgeBlendMs);
    if (!processed || audio !== currentAudio) return;
    const nextAudio = replaceAudioDocumentRange(currentAudio, start, end, createAudioDocument(processed));
    const nextState = isClipSpeedEffect(settings)
      ? replaceSelectionRanges(currentState, [{ start, end: start + processed.duration }])
      : currentState;
    commitEdit(
      nextState,
      nextAudio,
      $t('editor.effects.applied', {
        default: '{effect} applied to selection.',
        values: { effect: settings.displayName || (isClipSpeedEffect(settings) ? 'Speed' : RAF_EFFECT_REGISTRY[settings.type].name) }
      })
    );
    effectDialog.close();
  }

  function openExportDialog(): void {
    if (!canEdit) return;
    errorMessage = '';
    exportDialog.show();
  }

  async function exportClip(options: ClipExportOptions): Promise<void> {
    if (!canEdit || !audio || !sourceFile || exporting) return;
    const currentAudio = audio;
    const currentFile = sourceFile;
    const ranges = editState.ranges;
    const job = new AbortController();
    operation?.abort();
    operation = job;
    exporting = true;
    exportingFormat = options.format;
    errorMessage = '';
    noticeMessage = '';
    try {
      await metadataTask;
      job.signal.throwIfAborted();
      const { encodeAudioExport } = await import('./clip-export');
      const exportTags = { ...tags, lyrics: remapLyricsToClip(tags.lyrics, ranges) };
      const blob = await encodeAudioExport(currentAudio, options, exportTags, artwork, job.signal);
      job.signal.throwIfAborted();
      await saveBlob(blob, `${stripFileExtension(currentFile.name)}-clip.${options.format}`);
      if (job.signal.aborted) return;
      noticeMessage = $t('editor.clipSaved', { default: 'Audio exported.' });
      exportDialog.close();
    } catch (error) {
      if (!job.signal.aborted && (error as DOMException)?.name !== 'AbortError') {
        errorMessage = error instanceof ClipExportUnavailableError
          ? $t('editor.encoderUnavailable', {
              default: '{format} encoding is not available in this browser.',
              values: { format: error.format.toUpperCase() }
            })
          : $t('editor.saveFailed', { default: 'The file could not be saved.' });
      }
    } finally {
      if (operation === job) { operation = null; exporting = false; }
    }
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (exportDialog?.isOpen() || effectDialog?.isOpen()) return;
    const target = event.target;
    const editingText = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;
    const key = event.key.toLowerCase();
    if (!editingText && key === ' ' && !event.ctrlKey && !event.metaKey) {
      event.preventDefault();
      toggleEditorPreview(!event.shiftKey);
      return;
    }
    if (!editingText && (key === 'delete' || key === 'backspace')) {
      event.preventDefault();
      deleteSelection();
      return;
    }
    if (!event.ctrlKey && !event.metaKey) return;
    if (key === 'o') { event.preventDefault(); void chooseAudioFile(); }
    else if (key === 'p') { event.preventDefault(); windowManagerOpenOptions(); }
    else if (key === 'w') { event.preventDefault(); window.close(); }
    else if (key === 's') { event.preventDefault(); openExportDialog(); }
    else if (!editingText && key === 'z' && event.shiftKey) { event.preventDefault(); redo(); }
    else if (!editingText && key === 'z') { event.preventDefault(); undo(); }
    else if (!editingText && key === 'y') { event.preventDefault(); redo(); }
    else if (!editingText && key === 'a') { event.preventDefault(); selectAll(); }
    else if (!editingText && key === 'x') { event.preventDefault(); deleteSelection(true); }
    else if (!editingText && key === 'c') { event.preventDefault(); copySelection(); }
    else if (!editingText && key === 'v') { event.preventDefault(); pasteAudio(); }
  }

  function windowManagerOpenOptions(): void {
    import('$lib/services/window-manager').then(({ requestOptionsFromTool }) => requestOptionsFromTool());
  }

  onMount(() => {
    const wasOpenedByMain = window.opener !== null;
    const stopListeningForTrack = listenForCurrentToolTrack((track) => {
      if (
        track.kind !== 'video'
        && ACCEPTED_EXTENSIONS.includes(inferExtension(track.file.name) as (typeof ACCEPTED_EXTENSIONS)[number])
      ) {
        void openFile(track.file);
      }
    });
    const closeIfOrphaned = () => {
      if (wasOpenedByMain && (!window.opener || window.opener.closed)) window.close();
    };
    const interval = window.setInterval(closeIfOrphaned, 1000);
    window.addEventListener('keydown', handleKeydown);
    const preventDragover = (event: DragEvent) => event.preventDefault();
    window.addEventListener('dragover', preventDragover);
    window.addEventListener('drop', handleWindowDrop);
    window.addEventListener('focus', closeIfOrphaned);
    return () => {
      stopListeningForTrack();
      window.clearInterval(interval);
      window.removeEventListener('keydown', handleKeydown);
      window.removeEventListener('dragover', preventDragover);
      window.removeEventListener('drop', handleWindowDrop);
      window.removeEventListener('focus', closeIfOrphaned);
    };
  });

  onDestroy(() => {
    fileLoads.cancel();
    stopPreview();
    operation?.abort();
    preview.destroy();
  });
</script>

<svelte:head><title>{sourceFile ? `${sourceFile.name} — Editor` : 'izci Editor'}</title></svelte:head>

<div class="tool-shell editor-shell">
  <div class="window-frame-safe-strip" aria-hidden="true"></div>
  <input bind:this={fileInput} class="sr-only" type="file" accept={FILE_ACCEPT} on:change={handleFileInput} />

  <EditorMenuBar
    fileName={sourceFile?.name ?? ''}
    canSaveClip={canEdit}
    canUndo={canEdit && canUndo}
    canRedo={canEdit && canRedo}
    canCut={canEdit && hasSelection}
    {canPaste}
    {twoChannelView}
    {previewPlaying}
    on:play={() => toggleEditorPreview()}
    on:playFromCursor={() => toggleEditorPreview(false)}
    on:open={() => void chooseAudioFile()}
    on:saveClip={openExportDialog}
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
    on:toggleTwoChannelView={() => (twoChannelView = !twoChannelView)}
  />

  <main class="clip-workbench" aria-label={$t('editor.tabs.edit', { default: 'Edit' })}>
        <div class="tool-row tool-toolbar clip-toolbar" role="toolbar" aria-label={$t('editor.edit.toolbar', { default: 'Audio editing tools' })}>
          <div class="toolbar-group" aria-label={$t('editor.edit.history', { default: 'History' })}>
            <button class="icon-button hover-tooltip-anchor" type="button" disabled={!canEdit || !canUndo} aria-label={$t('editor.menu.undo', { default: 'Undo' })} on:click={undo}><span class="material-symbols-outlined" aria-hidden="true">undo</span><HoverTooltip>{$t('editor.menu.undo', { default: 'Undo' })}</HoverTooltip></button>
            <button class="icon-button hover-tooltip-anchor" type="button" disabled={!canEdit || !canRedo} aria-label={$t('editor.menu.redo', { default: 'Redo' })} on:click={redo}><span class="material-symbols-outlined" aria-hidden="true">redo</span><HoverTooltip>{$t('editor.menu.redo', { default: 'Redo' })}</HoverTooltip></button>
          </div>
          <span class="toolbar-separator" aria-hidden="true"></span>
          <div class="toolbar-group" aria-label={$t('editor.edit.clipboard', { default: 'Clipboard' })}>
            <button class="icon-button hover-tooltip-anchor" type="button" disabled={!canEdit || !hasSelection} aria-label={$t('editor.edit.cut', { default: 'Cut' })} on:click={() => deleteSelection(true)}><span class="material-symbols-outlined" aria-hidden="true">content_cut</span><HoverTooltip>{$t('editor.edit.cutShortcut', { default: 'Cut · Ctrl+X' })}</HoverTooltip></button>
            <button class="icon-button hover-tooltip-anchor" type="button" disabled={!canEdit || !hasSelection} aria-label={$t('editor.edit.copy', { default: 'Copy' })} on:click={() => copySelection()}><span class="material-symbols-outlined" aria-hidden="true">content_copy</span><HoverTooltip>{$t('editor.edit.copyShortcut', { default: 'Copy · Ctrl+C' })}</HoverTooltip></button>
            <button class="icon-button hover-tooltip-anchor" type="button" disabled={!canPaste} aria-label={$t('editor.edit.paste', { default: 'Paste' })} on:click={pasteAudio}><span class="material-symbols-outlined" aria-hidden="true">content_paste</span><HoverTooltip>{$t('editor.edit.pasteShortcut', { default: 'Paste · Ctrl+V' })}</HoverTooltip></button>
            <button class="icon-button hover-tooltip-anchor" type="button" disabled={!canEdit || !hasSelection} aria-label={$t('editor.edit.delete', { default: 'Delete' })} on:click={() => deleteSelection()}><span class="material-symbols-outlined" aria-hidden="true">delete</span><HoverTooltip>{$t('editor.edit.deleteShortcut', { default: 'Delete selection · Del' })}</HoverTooltip></button>
            <button class="icon-button hover-tooltip-anchor" type="button" disabled={!canEdit || !hasSelection} aria-label={$t('editor.edit.trim', { default: 'Trim to selection' })} on:click={trimToSelection}><span class="material-symbols-outlined" aria-hidden="true">content_cut</span><HoverTooltip>{$t('editor.edit.trim', { default: 'Trim to selection' })}</HoverTooltip></button>
          </div>
          <div class="toolbar-spacer"></div>
          <span class="toolbar-separator" aria-hidden="true"></span>
          <button class="text-button primary export-button" type="button" disabled={!canEdit} on:click={openExportDialog}><span class="material-symbols-outlined" aria-hidden="true">save</span>{$t('editor.clip.exportOpen', { default: 'Export...' })}</button>
        </div>

        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
          class="waveform-frame"
          class:is-loading={loading}
          on:contextmenu|preventDefault={openContextMenu}
        >
          <WaveformEditor
            {audio}
            selectionStart={editState.selectionStart}
            selectionEnd={editState.selectionEnd}
            {playhead}
            playbackPosition={previewPlaying ? preview.position : null}
            disabled={!canEdit}
            {twoChannelView}
            bind:zoom={waveformZoom}
            bind:scrollStart={waveformScrollStart}
            on:selection={(event) => setSelection(event.detail.start, event.detail.end)}
            on:seek={(event) => seekEditor(event.detail)}
            on:error={() => (errorMessage = $t('editor.clip.waveformFailed', { default: 'The waveform could not be prepared.' }))}
          />
          {#if !sourceFile && !loading}
            <button class="tool-empty-state empty-drop-target" type="button" on:click={() => void chooseAudioFile()}>
              <span class="material-symbols-outlined" aria-hidden="true">audio_file</span>
              <strong>{$t('editor.openPrompt', { default: 'Open audio' })}</strong>
              <span>{$t('editor.dropPrompt', { default: 'or drop a file here' })}</span>
            </button>
          {:else if loading}
            <div class="render-overlay" role="status">
              <span class="material-symbols-outlined spinning" aria-hidden="true">progress_activity</span>
              <strong>{loadProgress?.phase === 'rendering' ? $t('editor.rendering', { default: 'Rendering module to audio...' }) : $t('editor.decoding', { default: 'Decoding audio...' })}</strong>
              {#if loadProgress?.progress !== null && loadProgress?.progress !== undefined}
                <progress max="1" value={loadProgress.progress}></progress>
              {/if}
              <span>{loadProgress?.detail ?? ''}</span>
            </div>
          {/if}
        </div>

        <div class="tool-row tool-toolbar clip-toolbar preview-toolbar" role="toolbar" aria-label={$t('editor.edit.transport', { default: 'Navigation and preview' })}>
          <div class="toolbar-group transport-group" aria-label={$t('editor.edit.transport', { default: 'Navigation and preview' })}>
            <button class="icon-button hover-tooltip-anchor" type="button" disabled={!canEdit} aria-label={$t('editor.edit.selectionStart', { default: 'Go to selection start' })} on:click={() => seekEditor(hasSelection ? editState.selectionStart : 0)}><span class="material-symbols-outlined" aria-hidden="true">skip_previous</span><HoverTooltip>{$t('editor.edit.selectionStart', { default: 'Go to selection start' })}</HoverTooltip></button>
            <button class="icon-button transport-play hover-tooltip-anchor" class:is-active={previewPlaying} type="button" disabled={!canEdit} aria-label={previewPlaying ? $t('audioCompare.stop', { default: 'Stop' }) : $t('editor.edit.play', { default: 'Play' })} on:click={() => toggleEditorPreview()}><span class="material-symbols-outlined" aria-hidden="true">{previewPlaying ? 'stop' : 'play_arrow'}</span><HoverTooltip>{previewPlaying ? $t('editor.edit.stopShortcut', { default: 'Stop · Space' }) : $t('editor.edit.playShortcut', { default: 'Play · Space' })}</HoverTooltip></button>
            <button class="icon-button hover-tooltip-anchor" type="button" disabled={!canEdit} aria-label={$t('editor.edit.selectionEnd', { default: 'Go to selection end' })} on:click={() => seekEditor(hasSelection ? editState.selectionEnd : duration)}><span class="material-symbols-outlined" aria-hidden="true">skip_next</span><HoverTooltip>{$t('editor.edit.selectionEnd', { default: 'Go to selection end' })}</HoverTooltip></button>
            <span class="transport-time">{formatTime(playhead)} / {formatTime(duration)}</span>
          </div>
          <div class="toolbar-spacer"></div>
          <div class="toolbar-group zoom-group" aria-label={$t('editor.edit.zoom', { default: 'Zoom' })}>
            <button class="icon-button hover-tooltip-anchor" type="button" disabled={!canEdit || waveformZoom <= 1} aria-label={$t('editor.clip.zoomOut', { default: 'Zoom out' })} on:click={() => setWaveformZoom(waveformZoom / 2)}><span class="material-symbols-outlined" aria-hidden="true">zoom_out</span><HoverTooltip>{$t('editor.clip.zoomOut', { default: 'Zoom out' })}</HoverTooltip></button>
            <button class="text-button zoom-level-button hover-tooltip-anchor" type="button" disabled={!canEdit || waveformZoom <= 1} aria-label={$t('editor.clip.fitWaveform', { default: 'Fit waveform (Ctrl+wheel to zoom)' })} on:click={resetWaveformViewport}>{formatWaveformZoom(waveformZoom)}<HoverTooltip>{$t('editor.clip.fitWaveform', { default: 'Fit waveform (Ctrl+wheel to zoom)' })}</HoverTooltip></button>
            <button class="icon-button hover-tooltip-anchor" type="button" disabled={!canEdit || waveformZoom >= MAX_WAVEFORM_ZOOM} aria-label={$t('editor.clip.zoomIn', { default: 'Zoom in' })} on:click={() => setWaveformZoom(waveformZoom * 2)}><span class="material-symbols-outlined" aria-hidden="true">zoom_in</span><HoverTooltip>{$t('editor.clip.zoomIn', { default: 'Zoom in' })}</HoverTooltip></button>
            <button class="icon-button hover-tooltip-anchor" type="button" disabled={!canEdit || !hasSelection} aria-label={$t('editor.edit.zoomSelection', { default: 'Zoom to selection' })} on:click={zoomToSelection}><span class="material-symbols-outlined" aria-hidden="true">zoom_in_map</span><HoverTooltip>{$t('editor.edit.zoomSelection', { default: 'Zoom to selection' })}</HoverTooltip></button>
          </div>
        </div>

  </main>

  {#if contextMenuOpen}
    <MenuSurface
      items={contextMenuItems}
      x={contextMenuX}
      y={contextMenuY}
      ariaLabel={$t('editor.clip.waveform', { default: 'Editable audio waveform and selection' })}
      enableOverflowSubmenuFallback
      on:action={(event) => runContextMenuAction(event.detail)}
      on:dismiss={() => (contextMenuOpen = false)}
    />
  {/if}

  <ClipEffectDialog
    bind:this={effectDialog}
    busy={processingEffect}
    previewing={previewPlaying}
    {selectionDuration}
    on:preview={(event) => void previewEffect(event.detail.settings, event.detail.edgeBlendMs)}
    on:apply={(event) => void applyEffect(event.detail.settings, event.detail.edgeBlendMs)}
    on:close={stopPreview}
  />

  <ClipExportDialog
    bind:this={exportDialog}
    busy={exporting}
    {errorMessage}
    sourceSampleRate={audio?.sampleRate ?? 0}
    sourceChannels={audio?.numberOfChannels ?? 0}
    on:export={(event) => void exportClip(event.detail)}
    on:close={() => { if (!exporting) errorMessage = ''; }}
  />

  <footer class="tool-status-bar" class:error={Boolean(errorMessage)}>
    <span class="material-symbols-outlined" aria-hidden="true">{errorMessage ? 'error' : loading ? 'progress_activity' : 'info'}</span>
    <span>{statusText}</span>
  </footer>
</div>
