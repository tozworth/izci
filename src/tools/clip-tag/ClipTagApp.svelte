<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { t } from 'svelte-i18n';
  import HoverTooltip from '$lib/components/HoverTooltip.svelte';
  import TabStrip from '$lib/components/TabStrip.svelte';
  import { MODULE_EXTENSIONS, STREAM_EXTENSIONS } from '$lib/types';
  import { loadTrackLyrics } from '$lib/services/lyrics';
  import { loadEmbeddedStreamArtwork, loadTrackMetadata } from '$lib/services/stream-artwork';
  import { inferArtistTitleFromFileName, inferExtension, stripFileExtension } from '$lib/utils/files';
  import ClipTagMenuBar from './ClipTagMenuBar.svelte';
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
    saveBlob,
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
  import { MAX_WAVEFORM_ZOOM, zoomWaveformViewport } from './waveform-viewport';

  type ToolTab = 'clip' | 'tags' | 'lyrics';
  type TagField = Exclude<keyof EditableTags, 'lyrics'>;
  const ACCEPTED_EXTENSIONS = [...STREAM_EXTENSIONS, ...MODULE_EXTENSIONS];
  const FILE_ACCEPT = ACCEPTED_EXTENSIONS.map((extension) => `.${extension}`).join(',');
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

  let activeTab: ToolTab = 'clip';
  let fileInput: HTMLInputElement;
  let artworkInput: HTMLInputElement;
  let exportDialog: ClipExportDialog;
  let sourceFile: File | null = null;
  let sourceBuffer: AudioBuffer | null = null;
  let waveformBuffer: AudioBuffer | null = null;
  let editState: ClipEditState = createInitialClipState(0);
  let undoStack: ClipEditState[] = [];
  let redoStack: ClipEditState[] = [];
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
  let waveformZoom = 1;
  let waveformScrollStart = 0;

  $: duration = clipDuration(editState);
  $: selectionDuration = Math.max(0, editState.selectionEnd - editState.selectionStart);
  $: hasSelection = selectionDuration > 0.001;
  $: canUndo = activeTab === 'clip' && undoStack.length > 0;
  $: canRedo = activeTab === 'clip' && redoStack.length > 0;
  $: canEdit = Boolean(sourceBuffer && waveformBuffer && !loading && !exporting && !savingTags);
  $: canSaveTags = Boolean(sourceFile && sourceBuffer && !loading && !exporting && !savingTags);
  $: statusText = errorMessage || (exporting
    ? $t('clipTag.encoding', { default: 'Encoding {format}...', values: { format: exportingFormat.toUpperCase() } })
    : savingTags
      ? $t('clipTag.savingTags', { default: 'Writing tagged copy...' })
      : noticeMessage) || (loadProgress
    ? loadProgress.detail
    : sourceFile
      ? `${formatTime(duration)} · ${waveformBuffer?.sampleRate.toLocaleString() ?? 0} Hz · ${waveformBuffer?.numberOfChannels ?? 0} ch`
      : $t('clipTag.emptyHint', { default: 'Open or drop an audio file to begin.' }));

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

  function refreshWaveform(): void {
    waveformBuffer = sourceBuffer ? materializeClip(sourceBuffer, editState) : null;
  }

  function commitEdit(next: ClipEditState): void {
    stopPreview();
    undoStack = [...undoStack, editState];
    redoStack = [];
    editState = next;
    refreshWaveform();
  }

  function undo(): void {
    const previous = undoStack.at(-1);
    if (!previous) return;
    stopPreview();
    redoStack = [editState, ...redoStack];
    undoStack = undoStack.slice(0, -1);
    editState = previous;
    refreshWaveform();
  }

  function redo(): void {
    const next = redoStack[0];
    if (!next) return;
    stopPreview();
    undoStack = [...undoStack, editState];
    redoStack = redoStack.slice(1);
    editState = next;
    refreshWaveform();
  }

  function selectAll(): void {
    editState = updateSelection(editState, 0, duration);
  }

  function replaceArtwork(next: Blob | null): void {
    if (artworkUrl) URL.revokeObjectURL(artworkUrl);
    artwork = next;
    artworkUrl = next ? URL.createObjectURL(next) : '';
  }

  async function openFile(file: File): Promise<void> {
    const extension = inferExtension(file.name);
    if (!ACCEPTED_EXTENSIONS.includes(extension as (typeof ACCEPTED_EXTENSIONS)[number])) {
      errorMessage = $t('clipTag.unsupported', { default: 'This file type is not supported by Clip and Tag.' });
      return;
    }

    stopPreview();
    resetWaveformViewport();
    loading = true;
    loadProgress = null;
    errorMessage = '';
    noticeMessage = '';
    sourceFile = file;
    sourceBuffer = null;
    waveformBuffer = null;
    undoStack = [];
    redoStack = [];
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
      refreshWaveform();
      noticeMessage = loaded.renderedModule
        ? loaded.fromCache
          ? $t('clipTag.moduleCached', { default: 'Loaded cached module render.' })
          : $t('clipTag.moduleRendered', { default: 'Module render cached for this session.' })
        : '';
    } catch (error) {
      sourceFile = null;
      errorMessage = error instanceof Error ? error.message : $t('clipTag.loadFailed', { default: 'The audio file could not be opened.' });
    } finally {
      loading = false;
      loadProgress = null;
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

  function handleWindowDrop(event: DragEvent): void {
    event.preventDefault();
    const file = event.dataTransfer?.files[0];
    if (file) void openFile(file);
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
    const start = selectionOnly && hasSelection ? editState.selectionStart : 0;
    const end = selectionOnly && hasSelection ? editState.selectionEnd : waveformBuffer.duration;
    await startBufferPreview(waveformBuffer, start, end, 'clip');
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
      noticeMessage = $t('clipTag.clipSaved', { default: 'Clip exported.' });
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

  async function saveTaggedCopy(): Promise<void> {
    if (!sourceFile || !sourceBuffer || savingTags) return;
    savingTags = true;
    errorMessage = '';
    noticeMessage = '';
    try {
      const extension = inferExtension(sourceFile.name);
      if (extension === 'mp3') {
        await saveBlob(await tagMp3(sourceFile, tags, artwork), `${stripFileExtension(sourceFile.name)}-tagged.mp3`);
      } else if (extension === 'wav' || extension === 'flac' || extension === 'ogg' || extension === 'opus') {
        const { tagContainerAudio } = await import('./tag-container-audio');
        await saveBlob(
          await tagContainerAudio(sourceFile, extension, tags, artwork),
          `${stripFileExtension(sourceFile.name)}-tagged.${extension}`
        );
      } else {
        const { encodeAudioExport } = await import('./clip-export');
        await saveBlob(
          await encodeAudioExport(sourceBuffer, DEFAULT_CLIP_EXPORT_OPTIONS, tags, artwork),
          `${stripFileExtension(sourceFile.name)}-tagged.wav`
        );
      }
      noticeMessage = $t('clipTag.tagsSaved', { default: 'Tagged copy saved.' });
    } catch (error) {
      if ((error as DOMException)?.name !== 'AbortError') errorMessage = $t('clipTag.saveFailed', { default: 'The file could not be saved.' });
    } finally {
      savingTags = false;
    }
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (!event.ctrlKey && !event.metaKey) return;
    if (exportDialog?.isOpen()) return;
    const target = event.target;
    const editingText = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;
    const key = event.key.toLowerCase();
    if (key === 'o') { event.preventDefault(); fileInput.click(); }
    else if (key === 'p') { event.preventDefault(); windowManagerOpenOptions(); }
    else if (key === 'w') { event.preventDefault(); window.close(); }
    else if (key === 's') { event.preventDefault(); activeTab === 'clip' ? openExportDialog() : void saveTaggedCopy(); }
    else if (!editingText && key === 'z' && activeTab === 'clip') { event.preventDefault(); undo(); }
    else if (!editingText && key === 'y' && activeTab === 'clip') { event.preventDefault(); redo(); }
    else if (!editingText && key === 'a' && activeTab === 'clip') { event.preventDefault(); selectAll(); }
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
    const closeIfOrphaned = () => {
      if (wasOpenedByMain && (!window.opener || window.opener.closed)) window.close();
    };
    const interval = window.setInterval(closeIfOrphaned, 1000);
    window.addEventListener('keydown', handleKeydown);
    window.addEventListener('dragover', (event) => event.preventDefault());
    window.addEventListener('drop', handleWindowDrop);
    window.addEventListener('focus', closeIfOrphaned);
    return () => {
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

<svelte:head><title>{sourceFile ? `${sourceFile.name} — Clip and Tag` : 'izci Clip and Tag'}</title></svelte:head>

<div class="clip-tag-shell">
  <div class="window-frame-safe-strip" aria-hidden="true"></div>
  <input bind:this={fileInput} class="sr-only" type="file" accept={FILE_ACCEPT} on:change={handleFileInput} />
  <input bind:this={artworkInput} class="sr-only" type="file" accept="image/*" on:change={handleArtworkInput} />

  <ClipTagMenuBar
    fileName={sourceFile?.name ?? ''}
    canSaveClip={canEdit}
    {canSaveTags}
    {canUndo}
    {canRedo}
    on:open={() => fileInput.click()}
    on:saveClip={openExportDialog}
    on:saveTags={() => void saveTaggedCopy()}
    on:close={() => window.close()}
    on:undo={undo}
    on:redo={redo}
    on:selectAll={selectAll}
  />

  <main class="tool-workspace">
    <TabStrip ariaLabel={$t('clipTag.tabs.label', { default: 'Clip and Tag tools' })} className="tool-tabs" flushStart>
      <button class="tab-strip-tab" class:active={activeTab === 'clip'} type="button" role="tab" aria-selected={activeTab === 'clip'} on:click={() => setActiveTab('clip')}>
        <span class="material-symbols-outlined" aria-hidden="true">content_cut</span>
        {$t('clipTag.tabs.clip', { default: 'Clip' })}
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

    {#if activeTab === 'clip'}
      <section class="clip-workbench" aria-label={$t('clipTag.tabs.clip', { default: 'Clip' })}>
        <div class="tool-row clip-toolbar" role="toolbar" aria-label={$t('clipTag.clip.toolbar', { default: 'Clip tools' })}>
          <button class="icon-button hover-tooltip-anchor" type="button" disabled={!canEdit || !hasSelection} aria-label={$t('clipTag.clip.cut', { default: 'Cut selection' })} on:click={() => commitEdit(cutSelection(editState))}>
            <span class="material-symbols-outlined" aria-hidden="true">content_cut</span><HoverTooltip>{$t('clipTag.clip.cut', { default: 'Cut selection' })}</HoverTooltip>
          </button>
          <button class="icon-button hover-tooltip-anchor" type="button" disabled={!canEdit || !hasSelection} aria-label={$t('clipTag.clip.keep', { default: 'Keep selection' })} on:click={() => commitEdit(keepSelection(editState))}>
            <span class="material-symbols-outlined" aria-hidden="true">content_paste</span><HoverTooltip>{$t('clipTag.clip.keep', { default: 'Keep selection' })}</HoverTooltip>
          </button>
          <span class="toolbar-separator" aria-hidden="true"></span>
          <button class="icon-button hover-tooltip-anchor" type="button" disabled={!canUndo} aria-label={$t('clipTag.menu.undo', { default: 'Undo' })} on:click={undo}>
            <span class="material-symbols-outlined" aria-hidden="true">undo</span><HoverTooltip>{$t('clipTag.menu.undo', { default: 'Undo' })}</HoverTooltip>
          </button>
          <button class="icon-button hover-tooltip-anchor" type="button" disabled={!canRedo} aria-label={$t('clipTag.menu.redo', { default: 'Redo' })} on:click={redo}>
            <span class="material-symbols-outlined" aria-hidden="true">redo</span><HoverTooltip>{$t('clipTag.menu.redo', { default: 'Redo' })}</HoverTooltip>
          </button>
          <span class="toolbar-separator" aria-hidden="true"></span>
          <button class="icon-button hover-tooltip-anchor" class:is-active={previewPlaying} type="button" disabled={!canEdit} aria-label={$t('clipTag.clip.previewSelection', { default: 'Preview selection' })} on:click={() => previewPlaying ? stopPreview() : void startPreview(true)}>
            <span class="material-symbols-outlined" aria-hidden="true">{previewPlaying ? 'stop' : 'play_arrow'}</span><HoverTooltip>{$t('clipTag.clip.previewSelection', { default: 'Preview selection' })}</HoverTooltip>
          </button>
          <button class="icon-button hover-tooltip-anchor" type="button" disabled={!canEdit} aria-label={$t('clipTag.clip.previewAll', { default: 'Preview full clip' })} on:click={() => void startPreview(false)}>
            <span class="material-symbols-outlined" aria-hidden="true">play_circle</span><HoverTooltip>{$t('clipTag.clip.previewAll', { default: 'Preview full clip' })}</HoverTooltip>
          </button>
          <div class="toolbar-spacer"></div>
          <button class="icon-button hover-tooltip-anchor" type="button" disabled={!canEdit || waveformZoom <= 1} aria-label={$t('clipTag.clip.zoomOut', { default: 'Zoom out' })} on:click={() => setWaveformZoom(waveformZoom / 2)}>
            <span class="material-symbols-outlined" aria-hidden="true">zoom_out</span><HoverTooltip>{$t('clipTag.clip.zoomOut', { default: 'Zoom out' })}</HoverTooltip>
          </button>
          <button class="text-button zoom-level-button hover-tooltip-anchor" type="button" disabled={!canEdit || waveformZoom <= 1} aria-label={$t('clipTag.clip.fitWaveform', { default: 'Fit waveform (Ctrl+wheel to zoom)' })} on:click={resetWaveformViewport}>
            {formatWaveformZoom(waveformZoom)}<HoverTooltip>{$t('clipTag.clip.fitWaveform', { default: 'Fit waveform (Ctrl+wheel to zoom)' })}</HoverTooltip>
          </button>
          <button class="icon-button hover-tooltip-anchor" type="button" disabled={!canEdit || waveformZoom >= MAX_WAVEFORM_ZOOM} aria-label={$t('clipTag.clip.zoomIn', { default: 'Zoom in' })} on:click={() => setWaveformZoom(waveformZoom * 2)}>
            <span class="material-symbols-outlined" aria-hidden="true">zoom_in</span><HoverTooltip>{$t('clipTag.clip.zoomIn', { default: 'Zoom in' })}</HoverTooltip>
          </button>
          <span class="toolbar-separator" aria-hidden="true"></span>
          <button class="text-button primary" type="button" disabled={!canEdit} on:click={openExportDialog}>
            <span class="material-symbols-outlined" aria-hidden="true">save</span>{$t('clipTag.clip.exportOpen', { default: 'Export...' })}
          </button>
        </div>

        <div class="waveform-frame" class:is-loading={loading}>
          <WaveformEditor
            buffer={waveformBuffer}
            selectionStart={editState.selectionStart}
            selectionEnd={editState.selectionEnd}
            {playhead}
            disabled={!canEdit}
            bind:zoom={waveformZoom}
            bind:scrollStart={waveformScrollStart}
            on:selection={(event) => (editState = updateSelection(editState, event.detail.start, event.detail.end))}
            on:seek={(event) => (playhead = event.detail)}
          />
          {#if !sourceFile && !loading}
            <button class="empty-drop-target" type="button" on:click={() => fileInput.click()}>
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
          <button class="text-button primary save-tags-button" type="button" disabled={!canSaveTags} on:click={() => void saveTaggedCopy()}><span class="material-symbols-outlined" aria-hidden="true">new_label</span>{$t('clipTag.menu.saveTags', { default: 'Save tagged copy...' })}</button>
        </aside>
      </section>
    {:else}
      <LyricsEditor
        value={tags.lyrics}
        currentTime={playhead}
        duration={sourceBuffer?.duration ?? 0}
        disabled={!canSaveTags}
        playing={previewPlaying && previewMode === 'lyrics'}
        getCurrentTime={getPreviewPosition}
        on:change={(event) => (tags = { ...tags, lyrics: event.detail })}
        on:togglePlayback={toggleLyricsPreview}
        on:seek={(event) => seekLyrics(event.detail)}
        on:save={() => void saveTaggedCopy()}
      />
    {/if}
  </main>

  <ClipExportDialog
    bind:this={exportDialog}
    busy={exporting}
    {errorMessage}
    sourceSampleRate={waveformBuffer?.sampleRate ?? 0}
    sourceChannels={waveformBuffer?.numberOfChannels ?? 0}
    on:export={(event) => void exportClip(event.detail)}
    on:close={() => { if (!exporting) errorMessage = ''; }}
  />

  <footer class:error={Boolean(errorMessage)}>
    <span class="material-symbols-outlined" aria-hidden="true">{errorMessage ? 'error' : loading ? 'progress_activity' : 'info'}</span>
    <span>{statusText}</span>
  </footer>
</div>
