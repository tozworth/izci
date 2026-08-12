<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { t } from 'svelte-i18n';
  import HoverTooltip from '$lib/components/HoverTooltip.svelte';
  import MenuSurface from '$lib/components/MenuSurface.svelte';
  import TabStrip from '$lib/components/TabStrip.svelte';
  import {
    AudioComparisonEngine,
    calculateLoudnessMatchGains,
    chooseAbxSource,
    getComparisonDuration,
    normalizeComparisonRange,
    type ComparisonAuditionMode,
    type ComparisonSourceId
  } from '$lib/services/audio-comparison';
  import { listenForCurrentToolTrack } from '$lib/services/tool-track-context';
  import { windowManager } from '$lib/services/window-manager';
  import { MODULE_EXTENSIONS, STREAM_EXTENSIONS } from '$lib/contracts/media-format';
  import { type MenuActionItem } from '$lib/contracts/window-menu';
  import { inferMediaExtension } from '$lib/media/format-policy';
  import { createMediaOpenFilePickerOptions, mediaFileInputAccept } from '$lib/media/format-policy';
  import { loadAudioFile, type AudioLoadProgress } from '../editor/clip-audio';
  import { MAX_WAVEFORM_ZOOM } from '../editor/waveform-viewport';
  import { analyzeAudioBufferLoudness } from '../troubadour/loudness-analyzer';
  import AudioCompareMenuBar from './AudioCompareMenuBar.svelte';
  import AudioCompareSourcePanel from './AudioCompareSourcePanel.svelte';

  type CompareTab = 'compare' | 'abx';
  type AbxAudition = ComparisonSourceId | 'x';

  interface CompareSource {
    file: File | null;
    buffer: AudioBuffer | null;
    loudness: number | null;
    inverted: boolean;
    channelsSwapped: boolean;
    loading: boolean;
    progress: AudioLoadProgress | null;
    renderedModule: boolean;
    error: string;
  }

  interface AbxResult {
    trial: number;
    target: ComparisonSourceId;
    guess: ComparisonSourceId;
    correct: boolean;
  }

  const ACCEPTED_EXTENSIONS = [...STREAM_EXTENSIONS, ...MODULE_EXTENSIONS];
  const FILE_ACCEPT = mediaFileInputAccept(['stream', 'module']);
  const OPEN_FILE_PICKER_OPTIONS = createMediaOpenFilePickerOptions({
    description: 'Audio files',
    multiple: false,
    kinds: ['stream', 'module'],
    grouping: 'wildcard'
  });

  function emptySource(): CompareSource {
    return {
      file: null,
      buffer: null,
      loudness: null,
      inverted: false,
      channelsSwapped: false,
      loading: false,
      progress: null,
      renderedModule: false,
      error: ''
    };
  }

  let sourceA = emptySource();
  let sourceB = emptySource();
  let fileInputA: HTMLInputElement;
  let fileInputB: HTMLInputElement;
  let activeSource: ComparisonSourceId = 'a';
  let activeTab: CompareTab = 'compare';
  let comparisonMode: ComparisonAuditionMode = 'a';
  let playing = false;
  let playhead = 0;
  let selectionStart = 0;
  let selectionEnd = 0;
  let loopEnabled = false;
  let gainMatchEnabled = true;
  let crossfadeMs = 15;
  let zoomA = 1;
  let zoomB = 1;
  let scrollA = 0;
  let scrollB = 0;
  let noticeMessage = '';
  let animationFrame = 0;
  let loadTokens: Record<ComparisonSourceId, number> = { a: 0, b: 0 };
  let contextMenuSource: ComparisonSourceId | null = null;
  let abxContextMenuOpen = false;
  let contextMenuX = 0;
  let contextMenuY = 0;

  let abxTrialCount = 10;
  let abxTarget: ComparisonSourceId | null = null;
  let abxAudition: AbxAudition = 'x';
  let abxResults: AbxResult[] = [];
  let abxComplete = false;

  const engine = new AudioComparisonEngine((position) => {
    playing = false;
    playhead = position;
    cancelAnimationFrame(animationFrame);
  });

  $: comparisonDuration = getComparisonDuration(sourceA.buffer, sourceB.buffer);
  $: canPlay = comparisonDuration > 0 && Boolean(sourceA.buffer || sourceB.buffer);
  $: canCompare = Boolean(sourceA.buffer && sourceB.buffer);
  $: matchGains = gainMatchEnabled
    ? calculateLoudnessMatchGains(sourceA.loudness, sourceB.loudness)
    : { aDb: 0, bDb: 0 };
  $: errorMessage = sourceA.error || sourceB.error;
  $: loadingSource = sourceA.loading ? sourceA : sourceB.loading ? sourceB : null;
  $: statusMessage = errorMessage
    || loadingSource?.progress?.detail
    || noticeMessage
    || (canCompare
      ? $t('audioCompare.ready', { default: 'Ready to compare. Playback is limited to the overlapping duration.' })
      : $t('audioCompare.emptyHint', { default: 'Open two audio files for synchronized comparison.' }));
  $: fileSummary = [sourceA.file?.name, sourceB.file?.name].filter(Boolean).join('  ↔  ');
  $: score = abxResults.filter((result) => result.correct).length;
  $: contextMenuItems = contextMenuSource ? buildSourceContextMenu(contextMenuSource) : [];
  $: abxContextMenuItems = buildAbxContextMenu(
    abxTrialCount,
    abxAudition,
    Boolean(abxTarget),
    playing,
    loopEnabled,
    gainMatchEnabled,
    abxResults.length,
    abxComplete,
    canCompare,
    canPlay
  );

  function getSource(id: ComparisonSourceId): CompareSource {
    return id === 'a' ? sourceA : sourceB;
  }

  function buildSourceContextMenu(id: ComparisonSourceId): MenuActionItem[] {
    const source = getSource(id);
    const sourceLabel = id.toUpperCase();
    const sourceZoom = id === 'a' ? zoomA : zoomB;
    return [
      {
        id: 'open',
        label: $t('audioCompare.replaceSource', {
          default: 'Open or replace source {source}',
          values: { source: sourceLabel }
        }),
        icon: 'file_open'
      },
      {
        id: 'audition',
        label: id === 'a'
          ? $t('audioCompare.auditionA', { default: 'Listen to A' })
          : $t('audioCompare.auditionB', { default: 'Listen to B' }),
        icon: comparisonMode === id ? 'check' : id === 'a' ? 'looks_one' : 'looks_two',
        disabled: !source.buffer,
        separatorBefore: true
      },
      {
        id: 'playPause',
        label: playing
          ? $t('audioCompare.pause', { default: 'Pause' })
          : $t('audioCompare.play', { default: 'Play' }),
        icon: playing ? 'pause' : 'play_arrow',
        shortcut: 'Space',
        disabled: !canPlay
      },
      {
        id: 'stop',
        label: $t('audioCompare.stop', { default: 'Stop' }),
        icon: 'stop',
        disabled: !canPlay
      },
      {
        id: 'selectAll',
        label: $t('editor.menu.selectAll', { default: 'Select all' }),
        icon: 'select_all',
        shortcut: 'Ctrl+A',
        disabled: !canPlay,
        separatorBefore: true
      },
      {
        id: 'zoom',
        label: $t('editor.edit.zoom', { default: 'Zoom' }),
        icon: 'zoom_in',
        disabled: !source.buffer,
        children: [
          {
            id: 'zoomIn',
            label: $t('editor.clip.zoomIn', { default: 'Zoom in' }),
            icon: 'zoom_in',
            disabled: sourceZoom >= MAX_WAVEFORM_ZOOM
          },
          {
            id: 'zoomOut',
            label: $t('editor.clip.zoomOut', { default: 'Zoom out' }),
            icon: 'zoom_out',
            disabled: sourceZoom <= 1
          },
          {
            id: 'fit',
            label: $t('editor.clip.fitWaveform', { default: 'Fit waveform (Ctrl+wheel to zoom)' }),
            icon: 'fit_screen',
            disabled: sourceZoom <= 1,
            separatorBefore: true
          }
        ]
      },
      {
        id: 'invert',
        label: $t('audioCompare.invertPolarity', { default: 'Invert polarity' }),
        icon: 'swap_vert',
        checked: source.inverted,
        disabled: !source.buffer,
        separatorBefore: true
      },
      {
        id: 'swap',
        label: $t('audioCompare.swapChannels', { default: 'Swap L/R' }),
        icon: 'swap_horiz',
        checked: source.channelsSwapped,
        disabled: !source.buffer || source.buffer.numberOfChannels !== 2
      },
      {
        id: 'loop',
        label: $t('audioCompare.loopSelection', { default: 'Loop selection' }),
        icon: loopEnabled ? 'repeat_on' : 'repeat',
        checked: loopEnabled,
        disabled: !canPlay,
        separatorBefore: true
      },
      {
        id: 'gainMatch',
        label: $t('audioCompare.loudnessMatch', { default: 'Loudness match' }),
        icon: 'balance',
        checked: gainMatchEnabled,
        disabled: !canCompare
      },
      {
        id: 'crossfade',
        label: $t('audioCompare.crossfade', { default: 'Switch fade' }),
        icon: 'linear_scale',
        children: [0, 25, 50, 100, 250].map((milliseconds) => ({
          id: `crossfade:${milliseconds}`,
          label: `${milliseconds} ms`,
          icon: crossfadeMs === milliseconds ? 'radio_button_checked' : 'radio_button_unchecked'
        }))
      }
    ];
  }

  function openSourceContextMenu(event: MouseEvent, id: ComparisonSourceId): void {
    activeSource = id;
    abxContextMenuOpen = false;
    contextMenuSource = id;
    contextMenuX = event.clientX;
    contextMenuY = event.clientY;
  }

  function setSourceZoom(id: ComparisonSourceId, value: number): void {
    const nextZoom = Math.max(1, Math.min(MAX_WAVEFORM_ZOOM, value));
    if (id === 'a') {
      zoomA = nextZoom;
      if (nextZoom === 1) scrollA = 0;
    } else {
      zoomB = nextZoom;
      if (nextZoom === 1) scrollB = 0;
    }
  }

  function runSourceContextAction(action: string): void {
    const id = contextMenuSource;
    contextMenuSource = null;
    if (!id) return;
    if (action === 'open') void chooseSource(id);
    else if (action === 'audition') setComparisonMode(id);
    else if (action === 'playPause') void togglePlayback();
    else if (action === 'stop') stopPlayback();
    else if (action === 'selectAll') updateSelection(0, comparisonDuration);
    else if (action === 'invert') toggleTransform(id, 'inverted');
    else if (action === 'swap') toggleTransform(id, 'channelsSwapped');
    else if (action === 'loop') toggleLoop();
    else if (action === 'gainMatch') toggleGainMatch();
    else if (action === 'zoomIn') setSourceZoom(id, (id === 'a' ? zoomA : zoomB) * 2);
    else if (action === 'zoomOut') setSourceZoom(id, (id === 'a' ? zoomA : zoomB) / 2);
    else if (action === 'fit') setSourceZoom(id, 1);
    else if (action.startsWith('crossfade:')) updateCrossfade(Number(action.slice(10)));
  }

  function buildAbxContextMenu(
    trialCount: number,
    audition: AbxAudition,
    sessionRunning: boolean,
    isPlaying: boolean,
    loops: boolean,
    matchesGain: boolean,
    resultCount: number,
    sessionComplete: boolean,
    sourcesReady: boolean,
    playable: boolean
  ): MenuActionItem[] {
    return [
      {
        id: 'startSession',
        label: sessionRunning || resultCount > 0 || sessionComplete
          ? $t('audioCompare.abx.restart', { default: 'Restart session' })
          : $t('audioCompare.abx.start', { default: 'Start session' }),
        icon: 'quiz',
        disabled: !sourcesReady
      },
      {
        id: 'auditionA',
        label: $t('audioCompare.auditionA', { default: 'Listen to A' }),
        icon: audition === 'a' ? 'radio_button_checked' : 'looks_one',
        disabled: !sourcesReady,
        separatorBefore: true
      },
      {
        id: 'auditionB',
        label: $t('audioCompare.auditionB', { default: 'Listen to B' }),
        icon: audition === 'b' ? 'radio_button_checked' : 'looks_two',
        disabled: !sourcesReady
      },
      {
        id: 'auditionX',
        label: $t('audioCompare.abx.unknown', { default: 'Unknown' }),
        icon: audition === 'x' ? 'radio_button_checked' : 'question_mark',
        disabled: !sessionRunning
      },
      {
        id: 'playPause',
        label: isPlaying
          ? $t('audioCompare.pause', { default: 'Pause' })
          : $t('audioCompare.play', { default: 'Play' }),
        icon: isPlaying ? 'pause' : 'play_arrow',
        shortcut: 'Space',
        disabled: !playable,
        separatorBefore: true
      },
      {
        id: 'stop',
        label: $t('audioCompare.stop', { default: 'Stop' }),
        icon: 'stop',
        disabled: !playable
      },
      {
        id: 'trials',
        label: $t('audioCompare.abx.trials', { default: 'Trials' }),
        icon: 'format_list_numbered',
        disabled: sessionRunning,
        separatorBefore: true,
        children: [5, 10, 20].map((count) => ({
          id: `trials:${count}`,
          label: String(count),
          icon: trialCount === count ? 'radio_button_checked' : 'radio_button_unchecked'
        }))
      },
      {
        id: 'loop',
        label: $t('audioCompare.loopSelection', { default: 'Loop selection' }),
        icon: loops ? 'repeat_on' : 'repeat',
        checked: loops,
        disabled: !playable,
        separatorBefore: true
      },
      {
        id: 'gainMatch',
        label: $t('audioCompare.loudnessMatch', { default: 'Loudness match' }),
        icon: 'balance',
        checked: matchesGain,
        disabled: !sourcesReady
      }
    ];
  }

  function openAbxContextMenu(event: MouseEvent): void {
    contextMenuSource = null;
    abxContextMenuOpen = true;
    contextMenuX = event.clientX;
    contextMenuY = event.clientY;
  }

  function runAbxContextAction(action: string): void {
    abxContextMenuOpen = false;
    if (action === 'startSession') startAbxSession();
    else if (action === 'auditionA') setAbxAudition('a');
    else if (action === 'auditionB') setAbxAudition('b');
    else if (action === 'auditionX') setAbxAudition('x');
    else if (action === 'playPause') void togglePlayback();
    else if (action === 'stop') stopPlayback();
    else if (action === 'loop') toggleLoop();
    else if (action === 'gainMatch') toggleGainMatch();
    else if (action.startsWith('trials:')) abxTrialCount = Number(action.slice(7));
  }

  function setSource(id: ComparisonSourceId, source: CompareSource): void {
    if (id === 'a') sourceA = source;
    else sourceB = source;
  }

  function updateSource(id: ComparisonSourceId, patch: Partial<CompareSource>): void {
    setSource(id, { ...getSource(id), ...patch });
  }

  function formatTime(value: number): string {
    if (!Number.isFinite(value)) return '0:00.000';
    const minutes = Math.floor(value / 60);
    const seconds = value - minutes * 60;
    return `${minutes}:${seconds.toFixed(3).padStart(6, '0')}`;
  }

  function formatCrossfade(value: number): string {
    return `${Math.round(value)} ms`;
  }

  function refreshRange(previousDuration: number): void {
    const nextDuration = getComparisonDuration(sourceA.buffer, sourceB.buffer);
    const wasFullRange = previousDuration <= 0 || (selectionStart <= 0.001 && Math.abs(selectionEnd - previousDuration) <= 0.001);
    const next = normalizeComparisonRange(
      wasFullRange ? { start: 0, end: nextDuration } : { start: selectionStart, end: selectionEnd },
      nextDuration
    );
    selectionStart = next.start;
    selectionEnd = next.end;
    playhead = Math.min(playhead, nextDuration);
    engine.setRange(next);
  }

  function applyPlaybackSettings(): void {
    const gains = gainMatchEnabled
      ? calculateLoudnessMatchGains(sourceA.loudness, sourceB.loudness)
      : { aDb: 0, bDb: 0 };
    engine.setCrossfadeMs(crossfadeMs);
    engine.setLoop(loopEnabled);
    engine.setSourceSettings('a', {
      gainDb: gains.aDb,
      inverted: sourceA.inverted,
      channelsSwapped: sourceA.channelsSwapped
    });
    engine.setSourceSettings('b', {
      gainDb: gains.bDb,
      inverted: sourceB.inverted,
      channelsSwapped: sourceB.channelsSwapped
    });
  }

  async function openSource(id: ComparisonSourceId, file: File): Promise<void> {
    const extension = inferMediaExtension(file.name);
    if (!ACCEPTED_EXTENSIONS.includes(extension as (typeof ACCEPTED_EXTENSIONS)[number])) {
      updateSource(id, { error: $t('audioCompare.unsupported', { default: 'This file type is not supported by Audio Compare.' }) });
      return;
    }

    const token = ++loadTokens[id];
    const previousDuration = getComparisonDuration(sourceA.buffer, sourceB.buffer);
    activeSource = id;
    engine.pause();
    playing = false;
    cancelAnimationFrame(animationFrame);
    updateSource(id, {
      file,
      buffer: null,
      loudness: null,
      loading: true,
      progress: null,
      renderedModule: false,
      error: ''
    });
    engine.setBuffer(id, null);
    refreshRange(previousDuration);
    noticeMessage = '';

    try {
      const loaded = await loadAudioFile(file, (progress) => {
        if (loadTokens[id] === token) updateSource(id, { progress });
      });
      if (loadTokens[id] !== token) return;
      updateSource(id, {
        progress: { phase: 'decoding', progress: null, detail: $t('audioCompare.measuringLoudness', { default: 'Measuring integrated loudness' }) }
      });
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      const loudness = analyzeAudioBufferLoudness(loaded.buffer).integratedLufs;
      if (loadTokens[id] !== token) return;
      updateSource(id, {
        buffer: loaded.buffer,
        loudness: Number.isFinite(loudness) ? loudness : null,
        loading: false,
        progress: null,
        renderedModule: loaded.renderedModule
      });
      engine.setBuffer(id, loaded.buffer);
      refreshRange(previousDuration);
      applyPlaybackSettings();
      if (id === 'a' && !sourceB.buffer) comparisonMode = 'a';
      else if (id === 'b' && !sourceA.buffer) comparisonMode = 'b';
      resetAbxSession();
      engine.setAuditionMode(currentEngineMode());
      noticeMessage = loaded.renderedModule
        ? loaded.fromCache
          ? $t('audioCompare.moduleCached', { default: 'Loaded cached module render.' })
          : $t('audioCompare.moduleRendered', { default: 'Module render cached for this session.' })
        : '';
    } catch (error) {
      if (loadTokens[id] !== token) return;
      updateSource(id, {
        file: null,
        buffer: null,
        loudness: null,
        loading: false,
        progress: null,
        error: error instanceof Error ? error.message : $t('audioCompare.loadFailed', { default: 'The audio file could not be opened.' })
      });
      engine.setBuffer(id, null);
      refreshRange(previousDuration);
    }
  }

  async function chooseSource(id: ComparisonSourceId): Promise<void> {
    activeSource = id;
    const pickerWindow = window as Window & {
      showOpenFilePicker?: (options?: OpenFilePickerOptions) => Promise<FileSystemFileHandle[]>;
    };
    if (!pickerWindow.showOpenFilePicker) {
      (id === 'a' ? fileInputA : fileInputB).click();
      return;
    }
    try {
      const [handle] = await pickerWindow.showOpenFilePicker(OPEN_FILE_PICKER_OPTIONS);
      if (handle) await openSource(id, await handle.getFile());
    } catch (error) {
      if ((error as DOMException)?.name !== 'AbortError') {
        updateSource(id, { error: error instanceof Error ? error.message : $t('audioCompare.loadFailed', { default: 'The audio file could not be opened.' }) });
      }
    }
  }

  function handleFileInput(id: ComparisonSourceId, event: Event): void {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (file) void openSource(id, file);
  }

  function updateSelection(start: number, end: number): void {
    const next = normalizeComparisonRange({ start, end }, comparisonDuration);
    selectionStart = next.start;
    selectionEnd = next.end;
    engine.setRange(next);
  }

  function seek(position: number): void {
    playhead = Math.min(Math.max(position, 0), comparisonDuration);
    engine.seek(playhead);
  }

  function tick(): void {
    if (!playing) return;
    playhead = engine.getPosition();
    animationFrame = requestAnimationFrame(tick);
  }

  function currentEngineMode(): ComparisonAuditionMode {
    if (activeTab === 'compare') return comparisonMode;
    if (abxAudition === 'x') return abxTarget ?? 'a';
    return abxAudition;
  }

  async function togglePlayback(): Promise<void> {
    if (!canPlay) return;
    if (playing) {
      engine.pause();
      playing = false;
      playhead = engine.getPosition();
      cancelAnimationFrame(animationFrame);
      return;
    }
    applyPlaybackSettings();
    engine.setAuditionMode(currentEngineMode());
    await engine.play(playhead >= comparisonDuration - 0.001 ? (loopEnabled ? selectionStart : 0) : playhead);
    playing = engine.isPlaying;
    if (playing) animationFrame = requestAnimationFrame(tick);
  }

  function stopPlayback(): void {
    engine.stop();
    playing = false;
    playhead = loopEnabled ? selectionStart : 0;
    cancelAnimationFrame(animationFrame);
  }

  function setComparisonMode(mode: ComparisonAuditionMode): void {
    if ((mode === 'a' && !sourceA.buffer) || (mode === 'b' && !sourceB.buffer) || (mode === 'difference' && !canCompare)) return;
    comparisonMode = mode;
    if (activeTab === 'compare') engine.setAuditionMode(mode);
  }

  function setAbxAudition(mode: AbxAudition): void {
    if (!canCompare || (mode === 'x' && !abxTarget)) return;
    abxAudition = mode;
    engine.setAuditionMode(mode === 'x' ? abxTarget! : mode);
  }

  function setActiveTab(tab: CompareTab): void {
    activeTab = tab;
    engine.setAuditionMode(currentEngineMode());
  }

  function toggleLoop(): void {
    loopEnabled = !loopEnabled;
    applyPlaybackSettings();
  }

  function toggleGainMatch(): void {
    gainMatchEnabled = !gainMatchEnabled;
    applyPlaybackSettings();
  }

  function updateCrossfade(value: number): void {
    crossfadeMs = Math.min(500, Math.max(0, value));
    engine.setCrossfadeMs(crossfadeMs);
  }

  function toggleTransform(id: ComparisonSourceId, key: 'inverted' | 'channelsSwapped'): void {
    const source = getSource(id);
    updateSource(id, { [key]: !source[key] });
    applyPlaybackSettings();
  }

  function randomUnit(): number {
    const values = new Uint32Array(1);
    crypto.getRandomValues(values);
    return values[0] / 0x1_0000_0000;
  }

  function nextAbxTarget(): void {
    abxTarget = chooseAbxSource(randomUnit());
    abxAudition = 'x';
    engine.setAuditionMode(abxTarget);
  }

  function startAbxSession(): void {
    if (!canCompare) return;
    abxResults = [];
    abxComplete = false;
    nextAbxTarget();
    playhead = selectionStart;
    engine.seek(playhead);
  }

  function resetAbxSession(): void {
    abxTarget = null;
    abxAudition = 'x';
    abxResults = [];
    abxComplete = false;
  }

  function submitGuess(guess: ComparisonSourceId): void {
    if (!abxTarget || abxComplete) return;
    const result: AbxResult = {
      trial: abxResults.length + 1,
      target: abxTarget,
      guess,
      correct: guess === abxTarget
    };
    abxResults = [...abxResults, result];
    if (abxResults.length >= abxTrialCount) {
      abxComplete = true;
      abxTarget = null;
      return;
    }
    nextAbxTarget();
  }

  function handleWindowDrop(event: DragEvent): void {
    event.preventDefault();
    const target = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-source]')?.dataset.source : null;
    const id = target === 'a' || target === 'b' ? target : activeSource;
    const file = event.dataTransfer?.files[0];
    if (file) void openSource(id, file);
  }

  function handleWindowDragOver(event: DragEvent): void {
    event.preventDefault();
  }

  function handleKeydown(event: KeyboardEvent): void {
    const target = event.target;
    const editing = target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement;
    const key = event.key.toLowerCase();
    if (!editing && key === ' ' && !event.ctrlKey && !event.metaKey) {
      event.preventDefault();
      void togglePlayback();
      return;
    }
    if (!editing && !event.ctrlKey && !event.metaKey && (key === '1' || key === '2' || key === '3')) {
      event.preventDefault();
      if (activeTab === 'compare') setComparisonMode(key === '1' ? 'a' : key === '2' ? 'b' : 'difference');
      else if (key !== '3') setAbxAudition(key === '1' ? 'a' : 'b');
      else setAbxAudition('x');
      return;
    }
    if (!event.ctrlKey && !event.metaKey) return;
    if (key === '1') { event.preventDefault(); void chooseSource('a'); }
    else if (key === '2') { event.preventDefault(); void chooseSource('b'); }
    else if (key === 'o') { event.preventDefault(); void chooseSource(activeSource); }
    else if (key === 'p') { event.preventDefault(); windowManager.openOptions(); }
    else if (key === 'w') { event.preventDefault(); window.close(); }
  }

  onMount(() => {
    const stopListeningForTrack = listenForCurrentToolTrack((track) => {
      if (track.kind === 'video') return;
      const existing = [sourceA.file, sourceB.file].find((file) => file
        && file.name === track.file.name
        && file.size === track.file.size
        && file.lastModified === track.file.lastModified);
      if (existing) return;
      const destination: ComparisonSourceId = !sourceA.file ? 'a' : !sourceB.file ? 'b' : activeSource;
      void openSource(destination, track.file);
    });
    window.addEventListener('keydown', handleKeydown);
    window.addEventListener('dragover', handleWindowDragOver);
    window.addEventListener('drop', handleWindowDrop);
    return () => {
      stopListeningForTrack();
      window.removeEventListener('keydown', handleKeydown);
      window.removeEventListener('dragover', handleWindowDragOver);
      window.removeEventListener('drop', handleWindowDrop);
    };
  });

  onDestroy(() => {
    cancelAnimationFrame(animationFrame);
    void engine.close();
  });
</script>

<svelte:head><title>{fileSummary ? `${fileSummary} — Audio Compare` : 'izci Audio Compare'}</title></svelte:head>

<div class="tool-shell audio-compare-shell">
  <div class="window-frame-safe-strip" aria-hidden="true"></div>
  <input bind:this={fileInputA} class="sr-only" type="file" accept={FILE_ACCEPT} on:change={(event) => handleFileInput('a', event)} />
  <input bind:this={fileInputB} class="sr-only" type="file" accept={FILE_ACCEPT} on:change={(event) => handleFileInput('b', event)} />

  <AudioCompareMenuBar
    {fileSummary}
    {canPlay}
    {canCompare}
    hasA={Boolean(sourceA.buffer)}
    hasB={Boolean(sourceB.buffer)}
    {playing}
    {loopEnabled}
    {gainMatchEnabled}
    on:openA={() => void chooseSource('a')}
    on:openB={() => void chooseSource('b')}
    on:close={() => window.close()}
    on:playPause={() => void togglePlayback()}
    on:stop={stopPlayback}
    on:auditionA={() => setComparisonMode('a')}
    on:auditionB={() => setComparisonMode('b')}
    on:difference={() => setComparisonMode('difference')}
    on:toggleLoop={toggleLoop}
    on:toggleGainMatch={toggleGainMatch}
  />

  <TabStrip ariaLabel={$t('audioCompare.tabs.label', { default: 'Audio comparison tools' })} className="tool-tabs" flushStart>
    <button class="tab-strip-tab" class:active={activeTab === 'compare'} type="button" role="tab" aria-selected={activeTab === 'compare'} on:click={() => setActiveTab('compare')}><span class="material-symbols-outlined" aria-hidden="true">compare_arrows</span>{$t('audioCompare.tabs.compare', { default: 'Compare' })}</button>
    <button class="tab-strip-tab" class:active={activeTab === 'abx'} type="button" role="tab" aria-selected={activeTab === 'abx'} on:click={() => setActiveTab('abx')}><span class="material-symbols-outlined" aria-hidden="true">quiz</span>{$t('audioCompare.tabs.abx', { default: 'Blind ABX' })}</button>
  </TabStrip>

  <div class="tool-row tool-toolbar compare-toolbar" role="toolbar" aria-label={$t('audioCompare.toolbar', { default: 'Audio comparison controls' })}>
    <div class="toolbar-group">
      <button class="text-button source-open" class:active={activeSource === 'a'} type="button" on:click={() => void chooseSource('a')}><span class="source-key">A</span>{$t('audioCompare.openShort', { default: 'Open' })}</button>
      <button class="text-button source-open" class:active={activeSource === 'b'} type="button" on:click={() => void chooseSource('b')}><span class="source-key">B</span>{$t('audioCompare.openShort', { default: 'Open' })}</button>
    </div>
    <span class="toolbar-separator" aria-hidden="true"></span>
    <div class="toolbar-group">
      <button class="icon-button transport-play hover-tooltip-anchor" class:is-active={playing} type="button" disabled={!canPlay} on:click={() => void togglePlayback()} aria-label={playing ? $t('audioCompare.pause', { default: 'Pause' }) : $t('audioCompare.play', { default: 'Play' })}><span class="material-symbols-outlined" aria-hidden="true">{playing ? 'pause' : 'play_arrow'}</span><HoverTooltip>{playing ? $t('audioCompare.pauseShortcut', { default: 'Pause · Space' }) : $t('audioCompare.playShortcut', { default: 'Play · Space' })}</HoverTooltip></button>
      <button class="icon-button hover-tooltip-anchor" type="button" disabled={!canPlay} on:click={stopPlayback} aria-label={$t('audioCompare.stop', { default: 'Stop' })}><span class="material-symbols-outlined" aria-hidden="true">stop</span><HoverTooltip>{$t('audioCompare.stop', { default: 'Stop' })}</HoverTooltip></button>
      <span class="transport-time">{formatTime(playhead)} / {formatTime(comparisonDuration)}</span>
    </div>
    <span class="toolbar-separator" aria-hidden="true"></span>
    {#if activeTab === 'compare'}
      <div class="toolbar-group audition-group" aria-label={$t('audioCompare.audition', { default: 'Audition source' })}>
        <button class="source-switch" class:active={comparisonMode === 'a'} type="button" disabled={!sourceA.buffer} on:click={() => setComparisonMode('a')}>A</button>
        <button class="source-switch" class:active={comparisonMode === 'b'} type="button" disabled={!sourceB.buffer} on:click={() => setComparisonMode('b')}>B</button>
        <button class="source-switch difference" class:active={comparisonMode === 'difference'} type="button" disabled={!canCompare} on:click={() => setComparisonMode('difference')}>A−B</button>
      </div>
    {:else}
      <div class="toolbar-group audition-group" aria-label={$t('audioCompare.abx.audition', { default: 'ABX audition source' })}>
        <button class="source-switch" class:active={abxAudition === 'a'} type="button" disabled={!canCompare} on:click={() => setAbxAudition('a')}>A</button>
        <button class="source-switch" class:active={abxAudition === 'b'} type="button" disabled={!canCompare} on:click={() => setAbxAudition('b')}>B</button>
        <button class="source-switch x-source" class:active={abxAudition === 'x'} type="button" disabled={!abxTarget} on:click={() => setAbxAudition('x')}>X</button>
      </div>
    {/if}
    <span class="toolbar-separator" aria-hidden="true"></span>
    <button class="text-button toggle-button hover-tooltip-anchor" class:is-active={loopEnabled} type="button" disabled={!canPlay} on:click={toggleLoop} aria-pressed={loopEnabled}><span class="material-symbols-outlined" aria-hidden="true">{loopEnabled ? 'repeat_on' : 'repeat'}</span>{$t('audioCompare.loop', { default: 'Loop' })}<HoverTooltip>{$t('audioCompare.loopSelection', { default: 'Loop selection' })}</HoverTooltip></button>
    <button class="text-button toggle-button hover-tooltip-anchor" class:is-active={gainMatchEnabled} type="button" disabled={!canCompare} on:click={toggleGainMatch} aria-pressed={gainMatchEnabled}><span class="material-symbols-outlined" aria-hidden="true">balance</span>{$t('audioCompare.match', { default: 'Match' })}<HoverTooltip>{$t('audioCompare.loudnessMatchDetail', { default: 'Attenuate the louder source to match integrated loudness' })}</HoverTooltip></button>
    <div class="toolbar-spacer"></div>
    <label class="crossfade-control">{$t('audioCompare.crossfade', { default: 'Switch fade' })}<input type="range" min="0" max="250" step="1" value={crossfadeMs} on:input={(event) => updateCrossfade(Number(event.currentTarget.value))} /><output>{formatCrossfade(crossfadeMs)}</output></label>
  </div>

  {#if activeTab === 'compare'}
    <main class="source-workbench">
      <AudioCompareSourcePanel
        id="a"
        file={sourceA.file}
        buffer={sourceA.buffer}
        loudness={sourceA.loudness}
        gainDb={matchGains.aDb}
        inverted={sourceA.inverted}
        channelsSwapped={sourceA.channelsSwapped}
        loading={sourceA.loading}
        loadingDetail={sourceA.progress?.detail ?? ''}
        active={activeSource === 'a'}
        renderedModule={sourceA.renderedModule}
        {selectionStart}
        {selectionEnd}
        {playhead}
        bind:zoom={zoomA}
        bind:scrollStart={scrollA}
        on:activate={() => activeSource = 'a'}
        on:open={() => void chooseSource('a')}
        on:contextMenu={(event) => openSourceContextMenu(event.detail, 'a')}
        on:selection={(event) => updateSelection(event.detail.start, event.detail.end)}
        on:seek={(event) => seek(event.detail)}
        on:toggleInvert={() => toggleTransform('a', 'inverted')}
        on:toggleSwap={() => toggleTransform('a', 'channelsSwapped')}
        on:drop={(event) => void openSource('a', event.detail)}
      />
      <AudioCompareSourcePanel
        id="b"
        file={sourceB.file}
        buffer={sourceB.buffer}
        loudness={sourceB.loudness}
        gainDb={matchGains.bDb}
        inverted={sourceB.inverted}
        channelsSwapped={sourceB.channelsSwapped}
        loading={sourceB.loading}
        loadingDetail={sourceB.progress?.detail ?? ''}
        active={activeSource === 'b'}
        renderedModule={sourceB.renderedModule}
        {selectionStart}
        {selectionEnd}
        {playhead}
        bind:zoom={zoomB}
        bind:scrollStart={scrollB}
        on:activate={() => activeSource = 'b'}
        on:open={() => void chooseSource('b')}
        on:contextMenu={(event) => openSourceContextMenu(event.detail, 'b')}
        on:selection={(event) => updateSelection(event.detail.start, event.detail.end)}
        on:seek={(event) => seek(event.detail)}
        on:toggleInvert={() => toggleTransform('b', 'inverted')}
        on:toggleSwap={() => toggleTransform('b', 'channelsSwapped')}
        on:drop={(event) => void openSource('b', event.detail)}
      />
    </main>
  {:else}
    <main class="abx-workbench">
      <section class="abx-setup">
        <div class="abx-source-summary"><span class="source-key">A</span><strong>{sourceA.file?.name ?? '—'}</strong><span>{sourceA.loudness !== null ? `${sourceA.loudness.toFixed(1)} LUFS` : '—'}</span></div>
        <div class="abx-source-summary"><span class="source-key">B</span><strong>{sourceB.file?.name ?? '—'}</strong><span>{sourceB.loudness !== null ? `${sourceB.loudness.toFixed(1)} LUFS` : '—'}</span></div>
        <label>{$t('audioCompare.abx.trials', { default: 'Trials' })}<select bind:value={abxTrialCount} disabled={Boolean(abxTarget)}><option value={5}>5</option><option value={10}>10</option><option value={20}>20</option></select></label>
        <button class="text-button primary" type="button" disabled={!canCompare} on:click={startAbxSession}>{abxTarget || abxResults.length > 0 || abxComplete ? $t('audioCompare.abx.restart', { default: 'Restart session' }) : $t('audioCompare.abx.start', { default: 'Start session' })}</button>
      </section>

      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <section class="abx-console" on:contextmenu|preventDefault={openAbxContextMenu}>
        {#if !canCompare}
          <div class="abx-empty"><span class="material-symbols-outlined" aria-hidden="true">quiz</span><strong>{$t('audioCompare.abx.needSources', { default: 'Two sources are required' })}</strong><span>{$t('audioCompare.abx.needSourcesHint', { default: 'Load A and B in the Compare tab first.' })}</span></div>
        {:else if !abxTarget && !abxComplete}
          <div class="abx-empty"><span class="material-symbols-outlined" aria-hidden="true">visibility_off</span><strong>{$t('audioCompare.abx.ready', { default: 'Ready for a blind comparison' })}</strong><span>{$t('audioCompare.abx.readyHint', { default: 'A and B remain available as references. X is randomly assigned for every trial.' })}</span></div>
        {:else if abxComplete}
          <div class="abx-result"><span class="material-symbols-outlined" aria-hidden="true">fact_check</span><strong>{score} / {abxResults.length}</strong><span>{$t('audioCompare.abx.complete', { default: 'Session complete' })}</span></div>
        {:else}
          <div class="trial-counter">{$t('audioCompare.abx.trialProgress', { default: 'Trial {current} of {total}', values: { current: abxResults.length + 1, total: abxTrialCount } })}</div>
          <div class="abx-listen-buttons" role="group" aria-label={$t('audioCompare.abx.listenReferences', { default: 'Listen to references and unknown source' })}>
            <button class:active={abxAudition === 'a'} type="button" on:click={() => setAbxAudition('a')}><span>A</span><small>{$t('audioCompare.abx.reference', { default: 'Reference' })}</small></button>
            <button class:active={abxAudition === 'b'} type="button" on:click={() => setAbxAudition('b')}><span>B</span><small>{$t('audioCompare.abx.reference', { default: 'Reference' })}</small></button>
            <button class="unknown" class:active={abxAudition === 'x'} type="button" on:click={() => setAbxAudition('x')}><span>X</span><small>{$t('audioCompare.abx.unknown', { default: 'Unknown' })}</small></button>
          </div>
          <div class="abx-guess">
            <span>{$t('audioCompare.abx.identify', { default: 'X is identical to:' })}</span>
            <button type="button" on:click={() => submitGuess('a')}>A</button>
            <button type="button" on:click={() => submitGuess('b')}>B</button>
          </div>
        {/if}
      </section>

      <section class="abx-history" aria-label={$t('audioCompare.abx.history', { default: 'Trial history' })}>
        <header><strong>{$t('audioCompare.abx.history', { default: 'Trial history' })}</strong><span>{score} / {abxResults.length}</span></header>
        <div class="history-list">
          {#if abxResults.length === 0}<span class="history-empty">{$t('audioCompare.abx.noResults', { default: 'No completed trials' })}</span>{/if}
          {#each abxResults as result}
            <div class:correct={result.correct} class:incorrect={!result.correct}><span>{result.trial}</span><span>X = {result.target.toUpperCase()}</span><span>{$t('audioCompare.abx.guessed', { default: 'guessed {guess}', values: { guess: result.guess.toUpperCase() } })}</span><span class="material-symbols-outlined" aria-hidden="true">{result.correct ? 'check' : 'close'}</span></div>
          {/each}
        </div>
      </section>
    </main>
  {/if}

  {#if contextMenuSource}
    <MenuSurface
      items={contextMenuItems}
      x={contextMenuX}
      y={contextMenuY}
      ariaLabel={$t('audioCompare.sourceGroup', {
        default: 'Comparison source {source}',
        values: { source: contextMenuSource.toUpperCase() }
      })}
      enableOverflowSubmenuFallback
      on:action={(event) => runSourceContextAction(event.detail)}
      on:dismiss={() => (contextMenuSource = null)}
    />
  {/if}

  {#if abxContextMenuOpen}
    <MenuSurface
      items={abxContextMenuItems}
      x={contextMenuX}
      y={contextMenuY}
      ariaLabel={$t('audioCompare.tabs.abx', { default: 'Blind ABX' })}
      enableOverflowSubmenuFallback
      on:action={(event) => runAbxContextAction(event.detail)}
      on:dismiss={() => (abxContextMenuOpen = false)}
    />
  {/if}

  <footer class="tool-status-bar" class:error={Boolean(errorMessage)}>
    <span class="material-symbols-outlined" aria-hidden="true">{errorMessage ? 'error' : loadingSource ? 'progress_activity' : 'info'}</span>
    <span>{statusMessage}</span>
    {#if comparisonDuration > 0}<span class="range-summary">{$t('audioCompare.selectionSummary', { default: 'Selection {start}–{end}', values: { start: formatTime(selectionStart), end: formatTime(selectionEnd) } })}</span>{/if}
  </footer>
</div>
