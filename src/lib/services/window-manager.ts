import materialSymbolsOutlinedWoff2Url from '@material-symbols/font-400/material-symbols-outlined.woff2?url';
import {
  DEFAULT_METADATA_SETTINGS,
  METADATA_SETTINGS_CHANNEL,
  METADATA_SETTINGS_STORAGE_KEY
} from '$lib/stores/metadata-settings';
import {
  DEFAULT_MODULE_PLAYBACK_SETTINGS,
  MODULE_INTERPOLATION_OPTIONS,
  MODULE_PLAYBACK_SETTINGS_CHANNEL,
  MODULE_PLAYBACK_SETTINGS_STORAGE_KEY
} from '$lib/stores/module-playback-settings';

const OPTIONS_WINDOW_NAME = 'izci-options';
const OPTIONS_WINDOW_FEATURES = ['popup=yes', 'width=720', 'height=520', 'resizable=yes', 'scrollbars=yes'].join(',');

function buildInterpolationOptionsMarkup(): string {
  return MODULE_INTERPOLATION_OPTIONS.map(
    (option) =>
      `<option value="${option.value}">${option.label}</option>`
  ).join('');
}

function buildOptionsMarkup(): string {
  const defaultSettings = JSON.stringify(DEFAULT_MODULE_PLAYBACK_SETTINGS);
  const defaultMetadataSettings = JSON.stringify(DEFAULT_METADATA_SETTINGS);
  const interpolationOptions = JSON.stringify(MODULE_INTERPOLATION_OPTIONS);

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>izci Options</title>
    <style>
      @font-face {
        font-family: "Material Symbols Outlined";
        font-style: normal;
        font-weight: 400;
        font-display: block;
        src: url("${materialSymbolsOutlinedWoff2Url}") format("woff2");
      }

      :root {
        color-scheme: dark;
        font-family: "Space Grotesk", "Segoe UI", sans-serif;
        background: #1d2021;
        color: #ebdbb2;
        --tree-width: 204px;
      }

      * {
        box-sizing: border-box;
      }

      html,
      body {
        height: 100%;
        overflow: hidden;
      }

      body {
        margin: 0;
        min-height: 100%;
        background:
          radial-gradient(circle at top left, rgba(184, 187, 38, 0.12), transparent 24%),
          radial-gradient(circle at top right, rgba(250, 189, 47, 0.08), transparent 22%),
          linear-gradient(180deg, #282828 0%, #1d2021 100%);
        display: grid;
        grid-template-rows: auto minmax(0, 1fr);
      }

      main {
        min-height: 0;
        display: grid;
        grid-template-columns: minmax(156px, var(--tree-width)) 1px minmax(0, 1fr);
        overflow: hidden;
      }

      p {
        margin: 0.35rem 0 0;
        color: #bdae93;
        line-height: 1.45;
      }

      code {
        font-family: "IBM Plex Mono", "SFMono-Regular", monospace;
        color: #fbf1c7;
      }

      h2 {
        margin: 0;
        font-size: 0.82rem;
        letter-spacing: 0.12em;
        text-transform: uppercase;
        color: #a89984;
      }

      .window-topbar {
        position: sticky;
        top: 0;
        z-index: 40;
        min-height: 1.9rem;
        padding: 0 0.65rem;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 1rem;
        background: rgba(28, 29, 30, 0.96);
        border-bottom: 1px solid rgba(168, 153, 132, 0.22);
        backdrop-filter: blur(16px);
        box-shadow: 0 1px 0 rgba(255, 255, 255, 0.03);
      }

      .window-topbar-title {
        min-width: 0;
        display: flex;
        align-items: center;
        gap: 0.3ch;
        font-size: 0.92rem;
        line-height: 1.1;
      }

      .window-topbar-prefix {
        color: #a89984;
        flex: 0 0 auto;
      }

      .window-topbar-breadcrumbs {
        min-width: 0;
        display: inline-flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 0.3ch;
      }

      .window-topbar-separator {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        color: #a89984;
        font-size: 16px;
        line-height: 1;
      }

      .window-topbar-crumb {
        min-width: 0;
        color: #a89984;
        font-weight: 500;
      }

      .window-topbar-crumb.is-current {
        color: #fbf1c7;
        font-weight: 700;
      }

      .window-topbar-tools {
        display: flex;
        align-items: center;
        gap: 0.2rem;
      }

      .tree-panel,
      .content-panel {
        min-height: 0;
      }

      .tree-panel {
        padding: 10px 8px 10px 10px;
        background: rgba(40, 40, 40, 0.96);
        border-right: 1px solid rgba(168, 153, 132, 0.16);
        overflow: auto;
      }

      .tree {
        display: flex;
        flex-direction: column;
        gap: 2px;
      }

      .tree-group {
        display: flex;
        flex-direction: column;
      }

      .tree-item {
        width: 100%;
        border: 0;
        background: transparent;
        color: inherit;
        display: flex;
        align-items: center;
        gap: 8px;
        text-align: left;
        border-radius: 6px;
        padding: 4px 8px;
        font: inherit;
        font-size: 0.92rem;
        cursor: pointer;
      }

      .tree-item:hover {
        background: rgba(146, 131, 116, 0.16);
      }

      .tree-item[aria-selected="true"] {
        background: rgba(215, 153, 33, 0.2);
        color: #fbf1c7;
      }

      .tree-item.child {
        padding-left: 22px;
        color: #d5c4a1;
      }

      .material-symbols-outlined {
        font-family: "Material Symbols Outlined";
        font-weight: normal;
        font-style: normal;
        font-size: 18px;
        line-height: 1;
        letter-spacing: normal;
        text-transform: none;
        display: inline-block;
        white-space: nowrap;
        word-wrap: normal;
        direction: ltr;
        -webkit-font-smoothing: antialiased;
        -moz-osx-font-smoothing: grayscale;
        text-rendering: optimizeLegibility;
        font-feature-settings: "liga";
        flex: 0 0 auto;
        color: #a89984;
      }

      .tree-item[aria-selected="true"] .material-symbols-outlined {
        color: #fabd2f;
      }

      .tree-label {
        min-width: 0;
      }

      .resizer {
        position: relative;
        background: rgba(168, 153, 132, 0.2);
        cursor: col-resize;
      }

      .resizer::before {
        content: "";
        position: absolute;
        inset: 0;
        left: 50%;
        width: 1px;
        transform: translateX(-50%);
        background: rgba(235, 219, 178, 0.26);
        transition: width 120ms ease, background-color 120ms ease;
      }

      .resizer:hover::before,
      body.is-resizing .resizer::before {
        width: 5px;
        background: rgba(250, 189, 47, 0.72);
      }

      .content-panel {
        padding: 10px 12px;
        overflow: auto;
      }

      .tool-button {
        min-width: 1.9rem;
        min-height: 1.9rem;
        margin: 0;
        padding: 0;
        border: 0;
        border-radius: 0.4rem;
        background: transparent;
        color: #d5c4a1;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
      }

      .tool-button:hover:not(:disabled) {
        background: rgba(235, 219, 178, 0.08);
        color: #fbf1c7;
      }

      .tool-button:disabled {
        opacity: 0.4;
        cursor: default;
      }

      .tool-button .material-symbols-outlined {
        color: currentColor;
        font-size: 18px;
      }

      .view {
        display: none;
      }

      .view.is-active {
        display: block;
      }

      .section + .section {
        margin-top: 16px;
      }

      .section h2 {
        margin: 0 0 10px;
      }

      .section-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
        gap: 14px;
        margin-top: 10px;
      }

      .setting-card {
        padding: 12px;
        border-radius: 10px;
        background: rgba(60, 56, 54, 0.52);
        border: 1px solid rgba(168, 153, 132, 0.14);
      }

      .setting-card h3 {
        margin: 0;
        font-size: 0.96rem;
      }

      .setting-card p {
        margin-top: 0.45rem;
        font-size: 0.88rem;
      }

      .meta-list {
        display: grid;
        grid-template-columns: max-content 1fr;
        gap: 4px 12px;
        margin: 10px 0 0;
        font-size: 0.92rem;
      }

      .meta-label {
        color: #a89984;
      }

      .meta-value {
        color: #ebdbb2;
      }

      .settings-form {
        display: flex;
        flex-direction: column;
        gap: 12px;
        margin-top: 12px;
      }

      .field-grid {
        display: flex;
        flex-direction: column;
        gap: 0;
      }

      .field {
        display: grid;
        grid-template-columns: minmax(0, 1fr) minmax(180px, auto);
        align-items: center;
        gap: 10px;
        padding: 8px 0;
        border-bottom: 1px solid rgba(168, 153, 132, 0.14);
      }

      .field:first-child {
        border-top: 1px solid rgba(168, 153, 132, 0.14);
      }

      .field-copy {
        min-width: 0;
      }

      .field-title {
        font-size: 0.96rem;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .field-control {
        display: inline-flex;
        align-items: center;
        justify-content: flex-end;
        gap: 8px;
        min-width: 0;
      }

      .field-output {
        min-width: 7.5ch;
        color: #fabd2f;
        font-variant-numeric: tabular-nums;
        text-align: right;
        white-space: nowrap;
      }

      .field input,
      .field select,
      .field button {
        font: inherit;
      }

      .field input[type="checkbox"] {
        inline-size: 1rem;
        block-size: 1rem;
        margin: 0;
        accent-color: #d79921;
      }

      .field input[type="range"] {
        width: min(180px, 24vw);
        accent-color: #d79921;
      }

      .field select,
      .field button {
        border-radius: 6px;
        border: 1px solid rgba(168, 153, 132, 0.22);
        padding: 4px 8px;
        color: #ebdbb2;
        background: rgba(29, 32, 33, 0.92);
      }

      .field button {
        cursor: pointer;
      }

      .field button:hover {
        border-color: rgba(250, 189, 47, 0.48);
      }

      .field-hint {
        margin: 0;
        grid-column: 1 / -1;
        font-size: 0.84rem;
        color: #a89984;
      }

      body.hints-collapsed .field-hint {
        display: none;
      }

      .checkbox-field {
        grid-template-columns: minmax(0, 1fr) auto;
      }

      .field-control-checkbox {
        justify-content: flex-end;
      }

      @media (max-width: 640px) {
        .field {
          grid-template-columns: 1fr;
          gap: 8px;
        }

        .field-control {
          justify-content: space-between;
        }

        .field input[type="range"] {
          width: 100%;
        }
      }
    </style>
  </head>
  <body class="hints-collapsed">
    <header class="window-topbar">
      <div class="window-topbar-title" aria-live="polite">
        <span class="window-topbar-prefix">izci Options</span>
        <span class="window-topbar-breadcrumbs" id="content-topbar-breadcrumbs"></span>
      </div>
      <div class="window-topbar-tools" aria-label="Page tools">
        <button class="tool-button" id="toggle-field-hints" type="button" aria-label="Collapse field hints" title="Collapse field hints">
          <span class="material-symbols-outlined" id="toggle-field-hints-icon" aria-hidden="true">unfold_less</span>
        </button>
        <button class="tool-button" id="reset-current-page" type="button" aria-label="Reset current page to defaults" title="Reset current page to defaults">
          <span class="material-symbols-outlined" aria-hidden="true">restart_alt</span>
        </button>
      </div>
    </header>
    <main>
      <aside class="tree-panel" aria-label="Options categories">
        <nav class="tree" role="tree">
          <div class="tree-group" role="none">
            <button class="tree-item" type="button" role="treeitem" aria-selected="false" data-view="playback">
              <span class="material-symbols-outlined" aria-hidden="true">play_circle</span>
              <span class="tree-label">Playback</span>
            </button>
            <button class="tree-item child" type="button" role="treeitem" aria-selected="true" data-view="modules">
              <span class="material-symbols-outlined" aria-hidden="true">memory</span>
              <span class="tree-label">Modules</span>
            </button>
          </div>
          <div class="tree-group" role="none">
            <button class="tree-item" type="button" role="treeitem" aria-selected="false" data-view="metadata">
              <span class="material-symbols-outlined" aria-hidden="true">tag</span>
              <span class="tree-label">Metadata</span>
            </button>
            <button class="tree-item" type="button" role="treeitem" aria-selected="false" data-view="about">
              <span class="material-symbols-outlined" aria-hidden="true">info</span>
              <span class="tree-label">About</span>
            </button>
          </div>
        </nav>
      </aside>
      <div class="resizer" role="separator" aria-orientation="vertical" aria-label="Resize panels"></div>
      <section class="content-panel" aria-live="polite">
        <article class="view" data-view-panel="playback" data-view-label="Playback" data-view-parent-label="">
          <div class="section">
            <h2>Current Module Defaults</h2>
            <dl class="meta-list">
              <div class="meta-label">Looping</div>
              <div class="meta-value" data-summary="repeatCount">Play once</div>
              <div class="meta-label">Stereo</div>
              <div class="meta-value" data-summary="stereoSeparation">100%</div>
              <div class="meta-label">Interpolation</div>
              <div class="meta-value" data-summary="interpolationFilter">1-tap (minimal)</div>
              <div class="meta-label">Tempo</div>
              <div class="meta-value" data-summary="tempoFactor">100% (1.00x)</div>
              <div class="meta-label">Pitch</div>
              <div class="meta-value" data-summary="pitchFactor">100% (1.00x)</div>
            </dl>
          </div>

          <div class="section">
            <h2>Backend Notes</h2>
            <div class="section-grid">
              <div class="setting-card">
                <h3>Streamed Audio</h3>
                <p><code>mp3</code>, <code>wav</code>, <code>flac</code>, <code>ogg</code>, and <code>opus</code> continue through Howler.js.</p>
              </div>
              <div class="setting-card">
                <h3>Tracker Modules</h3>
                <p><code>mod</code>, <code>xm</code>, <code>s3m</code>, and <code>it</code> use libopenmpt render parameters and playback controls.</p>
              </div>
            </div>
          </div>
        </article>

        <article class="view is-active" data-view-panel="modules" data-view-label="Modules" data-view-parent-label="Playback">
          <form class="settings-form" id="modules-form">
            <div class="section">
              <h2>Rendering</h2>
              <div class="field-grid">
                <label class="field">
                  <div class="field-copy">
                    <span class="field-title">Stereo / Pan Separation</span>
                  </div>
                  <div class="field-control">
                    <input id="stereo-separation" name="stereoSeparation" type="range" min="0" max="200" step="1" />
                    <span class="field-output" id="stereo-separation-value">100%</span>
                  </div>
                  <p class="field-hint">Below 100 = collapse to mono. Above 100 = widen the image.</p>
                </label>

                <label class="field">
                  <div class="field-copy">
                    <span class="field-title">Interpolation</span>
                  </div>
                  <div class="field-control">
                    <select id="interpolation-filter" name="interpolationFilter">${buildInterpolationOptionsMarkup()}</select>
                  </div>
                  <p class="field-hint" id="interpolation-filter-hint">Minimal smoothing.</p>
                </label>
              </div>
            </div>

            <div class="section">
              <h2>Playback</h2>
              <div class="field-grid">
                <label class="field">
                  <div class="field-copy">
                    <span class="field-title">Looping</span>
                  </div>
                  <div class="field-control">
                    <select id="repeat-count" name="repeatCount">
                      <option value="0">Play once</option>
                      <option value="-1">Loop forever</option>
                    </select>
                  </div>
                  <p class="field-hint">Maps to libopenmpt repeat count.</p>
                </label>

                <label class="field">
                  <div class="field-copy">
                    <span class="field-title">Tempo Factor</span>
                  </div>
                  <div class="field-control">
                    <input id="tempo-factor" name="tempoFactor" type="range" min="25" max="400" step="1" />
                    <span class="field-output" id="tempo-factor-value">100% (1.00x)</span>
                  </div>
                  <p class="field-hint">Adjust playback/tracking speed of modules.</p>
                </label>

                <label class="field">
                  <div class="field-copy">
                    <span class="field-title">Pitch Factor</span>
                  </div>
                  <div class="field-control">
                    <input id="pitch-factor" name="pitchFactor" type="range" min="25" max="400" step="1" />
                    <span class="field-output" id="pitch-factor-value">100% (1.00x)</span>
                  </div>
                  <p class="field-hint">Adjust sample pitch of modules.</p>
                </label>
              </div>
            </div>
          </form>
        </article>

        <article class="view" data-view-panel="metadata" data-view-label="Metadata" data-view-parent-label="">
          <form class="settings-form" id="metadata-form">
            <div class="section">
              <h2>Filename Inference</h2>
              <div class="field-grid">
                <label class="field checkbox-field">
                  <div class="field-copy">
                    <span class="field-title">Infer artist and title from filenames</span>
                  </div>
                  <div class="field-control field-control-checkbox">
                    <input id="infer-from-filename" name="inferFromFilename" type="checkbox" />
                  </div>
                  <p class="field-hint">If file has no metadata, fill in from <code>Artist - Title</code>-style filename.</p>
                </label>
              </div>
            </div>
          </form>
        </article>

        <article class="view" data-view-panel="about" data-view-label="About" data-view-parent-label="">
          <div class="section">
            <h2>İZCİ</h2>
            <dl class="meta-list">
              <div class="meta-label">Version</div>
              <div class="meta-value">0.1.0</div>
              <div class="meta-label">Playback</div>
              <div class="meta-value">Howler.js + Chiptune3</div>
              <div class="meta-label">Mode</div>
              <div class="meta-value">Offline-capable local PWA</div>
            </dl>
          </div>
        </article>
      </section>
    </main>
    <script>
      const defaultSettings = ${defaultSettings};
      const defaultMetadataSettings = ${defaultMetadataSettings};
      const interpolationOptions = ${interpolationOptions};
      const storageKey = ${JSON.stringify(MODULE_PLAYBACK_SETTINGS_STORAGE_KEY)};
      const channelName = ${JSON.stringify(MODULE_PLAYBACK_SETTINGS_CHANNEL)};
      const metadataStorageKey = ${JSON.stringify(METADATA_SETTINGS_STORAGE_KEY)};
      const metadataChannelName = ${JSON.stringify(METADATA_SETTINGS_CHANNEL)};
      const root = document.documentElement;
      const body = document.body;
      const treeItems = Array.from(document.querySelectorAll('.tree-item'));
      const views = Array.from(document.querySelectorAll('[data-view-panel]'));
      const resizer = document.querySelector('.resizer');
      const stereoSeparationInput = document.getElementById('stereo-separation');
      const stereoSeparationValue = document.getElementById('stereo-separation-value');
      const interpolationFilterInput = document.getElementById('interpolation-filter');
      const interpolationFilterHint = document.getElementById('interpolation-filter-hint');
      const repeatCountInput = document.getElementById('repeat-count');
      const tempoFactorInput = document.getElementById('tempo-factor');
      const tempoFactorValue = document.getElementById('tempo-factor-value');
      const pitchFactorInput = document.getElementById('pitch-factor');
      const pitchFactorValue = document.getElementById('pitch-factor-value');
      const inferFromFilenameInput = document.getElementById('infer-from-filename');
      const topbarBreadcrumbs = document.getElementById('content-topbar-breadcrumbs');
      const toggleFieldHintsButton = document.getElementById('toggle-field-hints');
      const toggleFieldHintsIcon = document.getElementById('toggle-field-hints-icon');
      const resetCurrentPageButton = document.getElementById('reset-current-page');
      const summaryNodes = {
        repeatCount: document.querySelector('[data-summary="repeatCount"]'),
        stereoSeparation: document.querySelector('[data-summary="stereoSeparation"]'),
        interpolationFilter: document.querySelector('[data-summary="interpolationFilter"]'),
        tempoFactor: document.querySelector('[data-summary="tempoFactor"]'),
        pitchFactor: document.querySelector('[data-summary="pitchFactor"]')
      };
      const broadcastChannel = 'BroadcastChannel' in window ? new BroadcastChannel(channelName) : null;
      const metadataBroadcastChannel =
        'BroadcastChannel' in window ? new BroadcastChannel(metadataChannelName) : null;
      let activeViewName = 'modules';
      let fieldHintsExpanded = false;

      function clamp(value, min, max) {
        return Math.min(Math.max(value, min), max);
      }

      function toNumber(value, fallback) {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : fallback;
      }

      function normalizeInterpolationFilter(value) {
        const nextValue = toNumber(value, defaultSettings.interpolationFilter);
        return [1, 2, 4, 8].includes(nextValue) ? nextValue : defaultSettings.interpolationFilter;
      }

      function normalizeSettings(value) {
        const source = value && typeof value === 'object' ? value : {};

        return {
          repeatCount: Math.round(clamp(toNumber(source.repeatCount, defaultSettings.repeatCount), -1, 32)),
          stereoSeparation: Math.round(clamp(toNumber(source.stereoSeparation, defaultSettings.stereoSeparation), 0, 200)),
          interpolationFilter: normalizeInterpolationFilter(source.interpolationFilter),
          tempoFactor: clamp(toNumber(source.tempoFactor, defaultSettings.tempoFactor), 0.25, 4),
          pitchFactor: clamp(toNumber(source.pitchFactor, defaultSettings.pitchFactor), 0.25, 4)
        };
      }

      function readSettings() {
        try {
          const rawValue = window.localStorage.getItem(storageKey);
          return rawValue ? normalizeSettings(JSON.parse(rawValue)) : defaultSettings;
        } catch {
          return defaultSettings;
        }
      }

      function writeSettings(nextValue) {
        const normalized = normalizeSettings(nextValue);
        window.localStorage.setItem(storageKey, JSON.stringify(normalized));
        broadcastChannel?.postMessage(normalized);
        render(normalized);
      }

      function normalizeMetadataSettings(value) {
        const source = value && typeof value === 'object' ? value : {};

        return {
          inferFromFilename:
            typeof source.inferFromFilename === 'boolean'
              ? source.inferFromFilename
              : defaultMetadataSettings.inferFromFilename
        };
      }

      function readMetadataSettings() {
        try {
          const rawValue = window.localStorage.getItem(metadataStorageKey);
          return rawValue ? normalizeMetadataSettings(JSON.parse(rawValue)) : defaultMetadataSettings;
        } catch {
          return defaultMetadataSettings;
        }
      }

      function writeMetadataSettings(nextValue) {
        const normalized = normalizeMetadataSettings(nextValue);
        window.localStorage.setItem(metadataStorageKey, JSON.stringify(normalized));
        metadataBroadcastChannel?.postMessage(normalized);
        renderMetadata(normalized);
      }

      function formatFactor(value) {
        return Math.round(value * 100) + '% (' + value.toFixed(2) + 'x)';
      }

      function formatRepeatCount(value) {
        return value === -1 ? 'Loop forever' : 'Play once';
      }

      function getInterpolationOption(value) {
        return interpolationOptions.find((option) => option.value === value) || interpolationOptions[0];
      }

      function updateHintToggleButton() {
        const hasHints = views.some((view) =>
          view.dataset.viewPanel === activeViewName && view.querySelector('.field-hint')
        );

        if (toggleFieldHintsButton) {
          const nextLabel = fieldHintsExpanded ? 'Collapse field hints' : 'Expand field hints';
          toggleFieldHintsButton.disabled = !hasHints;
          toggleFieldHintsButton.setAttribute('aria-label', nextLabel);
          toggleFieldHintsButton.setAttribute('title', nextLabel);
        }

        if (toggleFieldHintsIcon) {
          toggleFieldHintsIcon.textContent = fieldHintsExpanded ? 'unfold_less' : 'unfold_more';
        }
      }

      function updateResetButton() {
        if (!resetCurrentPageButton) {
          return;
        }

        const canReset = activeViewName === 'modules' || activeViewName === 'metadata';
        resetCurrentPageButton.disabled = !canReset;
      }

      function renderBreadcrumbs(view) {
        if (!topbarBreadcrumbs || !view) {
          return;
        }

        const crumbs = [];
        const parentLabel = view.dataset.viewParentLabel;
        const currentLabel = view.dataset.viewLabel || view.dataset.viewPanel || activeViewName;

        if (parentLabel) {
          crumbs.push(parentLabel);
        }

        crumbs.push(currentLabel);
        topbarBreadcrumbs.replaceChildren();

        crumbs.forEach((label, index) => {
          const separator = document.createElement('span');
          separator.className = 'material-symbols-outlined window-topbar-separator';
          separator.setAttribute('aria-hidden', 'true');
          separator.textContent = 'chevron_right';
          topbarBreadcrumbs.append(separator);

          const crumb = document.createElement('span');
          crumb.className = 'window-topbar-crumb';
          if (index === crumbs.length - 1) {
            crumb.classList.add('is-current');
          }
          crumb.textContent = label;
          topbarBreadcrumbs.append(crumb);
        });
      }

      function render(settings) {
        if (stereoSeparationInput) {
          stereoSeparationInput.value = String(settings.stereoSeparation);
        }
        if (stereoSeparationValue) {
          stereoSeparationValue.textContent = settings.stereoSeparation + '%';
        }

        const interpolationOption = getInterpolationOption(settings.interpolationFilter);
        if (interpolationFilterInput) {
          interpolationFilterInput.value = String(settings.interpolationFilter);
        }
        if (interpolationFilterHint) {
          interpolationFilterHint.textContent = interpolationOption.hint;
        }

        if (repeatCountInput) {
          repeatCountInput.value = String(settings.repeatCount);
        }

        if (tempoFactorInput) {
          tempoFactorInput.value = String(Math.round(settings.tempoFactor * 100));
        }
        if (tempoFactorValue) {
          tempoFactorValue.textContent = formatFactor(settings.tempoFactor);
        }

        if (pitchFactorInput) {
          pitchFactorInput.value = String(Math.round(settings.pitchFactor * 100));
        }
        if (pitchFactorValue) {
          pitchFactorValue.textContent = formatFactor(settings.pitchFactor);
        }

        summaryNodes.repeatCount.textContent = formatRepeatCount(settings.repeatCount);
        summaryNodes.stereoSeparation.textContent = settings.stereoSeparation + '%';
        summaryNodes.interpolationFilter.textContent = interpolationOption.label;
        summaryNodes.tempoFactor.textContent = formatFactor(settings.tempoFactor);
        summaryNodes.pitchFactor.textContent = formatFactor(settings.pitchFactor);
      }

      function renderMetadata(settings) {
        if (inferFromFilenameInput) {
          inferFromFilenameInput.checked = settings.inferFromFilename;
        }
      }

      function showView(viewName) {
        activeViewName = viewName;

        treeItems.forEach((item) => {
          item.setAttribute('aria-selected', item.dataset.view === viewName ? 'true' : 'false');
        });

        views.forEach((view) => {
          view.classList.toggle('is-active', view.dataset.viewPanel === viewName);
        });

        const activeView = views.find((view) => view.dataset.viewPanel === viewName);
        if (activeView) {
          renderBreadcrumbs(activeView);
        }

        updateHintToggleButton();
        updateResetButton();
      }

      treeItems.forEach((item) => {
        item.addEventListener('click', () => showView(item.dataset.view));
      });

      let resizeState = null;

      resizer?.addEventListener('pointerdown', (event) => {
        resizeState = {
          pointerId: event.pointerId
        };

        body.classList.add('is-resizing');
        resizer.setPointerCapture(event.pointerId);
        event.preventDefault();
      });

      resizer?.addEventListener('pointermove', (event) => {
        if (!resizeState) {
          return;
        }

        const nextWidth = Math.min(Math.max(event.clientX, 156), window.innerWidth - 220);
        root.style.setProperty('--tree-width', nextWidth + 'px');
      });

      function stopResize() {
        if (!resizeState) {
          return;
        }

        body.classList.remove('is-resizing');
        resizeState = null;
      }

      resizer?.addEventListener('pointerup', stopResize);
      resizer?.addEventListener('pointercancel', stopResize);

      stereoSeparationInput?.addEventListener('input', () => {
        stereoSeparationValue.textContent = stereoSeparationInput.value + '%';
      });
      stereoSeparationInput?.addEventListener('change', () => {
        writeSettings({ ...readSettings(), stereoSeparation: Number(stereoSeparationInput.value) });
      });

      interpolationFilterInput?.addEventListener('change', () => {
        writeSettings({ ...readSettings(), interpolationFilter: Number(interpolationFilterInput.value) });
      });

      repeatCountInput?.addEventListener('change', () => {
        writeSettings({ ...readSettings(), repeatCount: Number(repeatCountInput.value) });
      });

      tempoFactorInput?.addEventListener('input', () => {
        const tempoFactor = Number(tempoFactorInput.value) / 100;
        tempoFactorValue.textContent = formatFactor(tempoFactor);
        writeSettings({ ...readSettings(), tempoFactor });
      });

      pitchFactorInput?.addEventListener('input', () => {
        const pitchFactor = Number(pitchFactorInput.value) / 100;
        pitchFactorValue.textContent = formatFactor(pitchFactor);
        writeSettings({ ...readSettings(), pitchFactor });
      });

      inferFromFilenameInput?.addEventListener('change', () => {
        writeMetadataSettings({ ...readMetadataSettings(), inferFromFilename: inferFromFilenameInput.checked });
      });

      toggleFieldHintsButton?.addEventListener('click', () => {
        fieldHintsExpanded = !fieldHintsExpanded;
        body.classList.toggle('hints-collapsed', !fieldHintsExpanded);
        updateHintToggleButton();
      });

      resetCurrentPageButton?.addEventListener('click', () => {
        if (activeViewName === 'modules') {
          writeSettings(defaultSettings);
          return;
        }

        if (activeViewName === 'metadata') {
          writeMetadataSettings(defaultMetadataSettings);
        }
      });

      window.addEventListener('storage', (event) => {
        if (event.key === storageKey && event.newValue) {
          try {
            render(normalizeSettings(JSON.parse(event.newValue)));
          } catch {
            render(defaultSettings);
          }
        }

        if (event.key === metadataStorageKey && event.newValue) {
          try {
            renderMetadata(normalizeMetadataSettings(JSON.parse(event.newValue)));
          } catch {
            renderMetadata(defaultMetadataSettings);
          }
        }
      });

      broadcastChannel?.addEventListener('message', (event) => {
        render(normalizeSettings(event.data));
      });
      metadataBroadcastChannel?.addEventListener('message', (event) => {
        renderMetadata(normalizeMetadataSettings(event.data));
      });

      render(readSettings());
      renderMetadata(readMetadataSettings());
      showView(activeViewName);
    </script>
  </body>
</html>`;
}

function isOpenWindow(windowRef: Window | null): windowRef is Window {
  return windowRef !== null && !windowRef.closed;
}

let optionsWindowRef: Window | null = null;

export const windowManager = {
  openOptions() {
    const existingWindow = optionsWindowRef;

    if (isOpenWindow(existingWindow)) {
      existingWindow.focus();
      return existingWindow;
    }

    optionsWindowRef = window.open('', OPTIONS_WINDOW_NAME, OPTIONS_WINDOW_FEATURES);

    if (!optionsWindowRef) {
      return null;
    }

    optionsWindowRef.document.open();
    optionsWindowRef.document.write(buildOptionsMarkup());
    optionsWindowRef.document.close();
    optionsWindowRef.focus();

    return optionsWindowRef;
  },
  exit() {
    window.close();

    if (!window.closed) {
      window.location.replace('about:blank');
    }
  }
};
