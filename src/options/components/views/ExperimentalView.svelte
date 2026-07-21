<script lang="ts">
  import { onMount } from 'svelte';
  import { t } from 'svelte-i18n';
  import SettingsField from '../SettingsField.svelte';
  import { experimentalSettings } from '$lib/stores/experimental-settings';
  import { inspectStemCapability } from '$lib/services/stem-separation/capability';
  import { formatStemGpuAdapter } from '$lib/services/stem-separation/gpu-adapter';
  import { formatBytes, STEM_PAYLOAD } from '$lib/services/stem-separation/payload';
  import { stemPayloadManager } from '$lib/services/stem-separation/payload-manager';
  import { stemSeparationService } from '$lib/services/stem-separation/service';
  import { getStemStorageSummary } from '$lib/services/stem-separation/storage';
  import type {
    StemCapabilityReport,
    StemPayloadInstallProgress,
    StemStorageSummary
  } from '$lib/services/stem-separation/types';

  let capability: StemCapabilityReport | null = null;
  let payload: StemPayloadInstallProgress = stemPayloadManager.getSnapshot();
  let storage: StemStorageSummary = { modelBytes: 0, resultBytes: 0, resultCount: 0 };
  let busy = false;
  const isWindows = typeof navigator !== 'undefined' && /Windows/i.test(navigator.userAgent);
  $: chromiumReturnedIntel = payload.adapterInfo?.vendor.toLowerCase().includes('intel') === true;

  const unsubscribePayload = stemPayloadManager.subscribe((value) => (payload = value));

  async function refreshDiagnostics(): Promise<void> {
    [capability, storage] = await Promise.all([inspectStemCapability(), getStemStorageSummary()]);
  }

  async function installAndEnable(): Promise<void> {
    if (!(await stemPayloadManager.isInstalled())) {
      const accepted = window.confirm(
        $t('options.experimental.stems.downloadConfirm', {
          default: 'Download and verify the {size} stem model?',
          values: { size: formatBytes(STEM_PAYLOAD.installBytes) }
        })
      );
      if (!accepted) return;
      await stemPayloadManager.install();
    }
    experimentalSettings.update({ stemSeparation: true });
    await refreshDiagnostics();
  }

  async function handleToggle(event: Event): Promise<void> {
    const enabled = (event.currentTarget as HTMLInputElement).checked;
    if (!enabled) {
      stemPayloadManager.cancel();
      experimentalSettings.update({ stemSeparation: false });
      return;
    }
    busy = true;
    try {
      await installAndEnable();
    } catch {
      experimentalSettings.update({ stemSeparation: false });
    } finally {
      busy = false;
    }
  }

  async function removeModel(): Promise<void> {
    if (!window.confirm($t('options.experimental.stems.removeConfirm', { default: 'Remove the downloaded stem model? Prepared tracks will be kept.' }))) return;
    busy = true;
    try {
      experimentalSettings.update({ stemSeparation: false });
      await stemPayloadManager.remove();
      await refreshDiagnostics();
    } finally {
      busy = false;
    }
  }

  async function verifyAdapter(): Promise<void> {
    busy = true;
    try {
      await stemPayloadManager.verifyAdapter();
      await refreshDiagnostics();
    } catch {
      // The payload manager exposes the actionable error in its synchronized state.
    } finally {
      busy = false;
    }
  }

  async function clearPreparedTracks(): Promise<void> {
    if (!window.confirm($t('options.experimental.stems.clearConfirm', { default: 'Delete all prepared vocal assets? Source files are never touched.' }))) return;
    busy = true;
    try {
      await stemSeparationService.clearResults();
      await refreshDiagnostics();
    } finally {
      busy = false;
    }
  }

  onMount(() => {
    void refreshDiagnostics();
    return unsubscribePayload;
  });
</script>

<article class="view">
  <div class="section">
    <h2>{$t('options.experimental.heading', { default: 'Optional experiments' })}</h2>
    <div class="field-grid">
      <SettingsField
        title={$t('options.experimental.stems.title', { default: 'Stem separation' })}
        hint={$t('options.experimental.stems.hint', { default: 'Locally estimates vocals for stream tracks using WebGPU. It never uploads or changes your music.' })}
        checkbox
      >
        <input
          type="checkbox"
          checked={$experimentalSettings.stemSeparation}
          disabled={busy || payload.state === 'downloading' || payload.state === 'validating'}
          on:change={(event) => void handleToggle(event)}
        />
      </SettingsField>
    </div>
  </div>

  <div class="section">
    <h2>{$t('options.experimental.diagnostics.heading', { default: 'Diagnostics and storage' })}</h2>
    <dl class="experiment-diagnostics">
      <div><dt>WebGPU</dt><dd>{capability?.webGpu ? $t('options.common.available', { default: 'Available' }) : $t('options.common.unavailable', { default: 'Unavailable' })}</dd></div>
      <div><dt>shader-f16</dt><dd>{capability?.shaderF16 ? $t('options.common.available', { default: 'Available' }) : $t('options.common.unavailable', { default: 'Unavailable' })}</dd></div>
      <div><dt>{$t('options.experimental.stems.gpuRequest', { default: 'GPU request' })}</dt><dd>high-performance</dd></div>
      <div>
        <dt>{$t('options.experimental.stems.inferenceAdapter', { default: 'Verified inference adapter' })}</dt>
        <dd>{payload.adapterInfo ? formatStemGpuAdapter(payload.adapterInfo) : $t('options.experimental.stems.notVerified', { default: 'Not verified yet' })}</dd>
      </div>
      <div><dt>{$t('options.experimental.stems.model', { default: 'Model' })}</dt><dd>{payload.state === 'installed' ? `${formatBytes(storage.modelBytes)} · v${STEM_PAYLOAD.version}` : payload.state}</dd></div>
      <div><dt>{$t('options.experimental.stems.runtime', { default: 'Optional runtime' })}</dt><dd>{formatBytes(STEM_PAYLOAD.runtimeBytes)} · ONNX Runtime Web 1.27.0</dd></div>
      <div><dt>{$t('options.experimental.stems.prepared', { default: 'Prepared tracks' })}</dt><dd>{storage.resultCount} · {formatBytes(storage.resultBytes)}</dd></div>
      <div><dt>{$t('options.experimental.stems.siteStorage', { default: 'Total site storage' })}</dt><dd>{formatBytes(storage.usage ?? 0)} / {formatBytes(storage.quota ?? 0)}</dd></div>
    </dl>

    {#if capability?.reason}<p class="experiment-message attention">{capability.reason}</p>{/if}
    {#if isWindows && chromiumReturnedIntel}
      <p class="experiment-message attention">
        {$t('options.experimental.stems.windowsGpuWarning', {
          default: 'Chromium returned the Intel adapter. Chrome currently ignores WebGPU powerPreference on Windows; assign chrome.exe to High performance in Windows Graphics settings, fully exit Chrome, then verify again.'
        })}
      </p>
    {/if}
    {#if payload.message}<p class="experiment-message attention">{payload.message}</p>{/if}
    {#if payload.state === 'downloading' || payload.state === 'verifying' || payload.state === 'validating'}
      <div class="experiment-progress">
        <progress max={payload.totalBytes} value={payload.loadedBytes}></progress>
        <span>{formatBytes(payload.loadedBytes)} / {formatBytes(payload.totalBytes)} · {payload.state}</span>
        <button type="button" on:click={() => stemPayloadManager.cancel()}>{$t('options.experimental.stems.cancel', { default: 'Cancel' })}</button>
      </div>
    {/if}

    <div class="experiment-actions">
      {#if payload.state !== 'installed'}
        <button type="button" disabled={busy || capability?.supported === false} on:click={() => void installAndEnable()}>{$t('options.experimental.stems.download', { default: 'Download model and runtime' })} ({formatBytes(STEM_PAYLOAD.installBytes)})</button>
      {:else}
        <button type="button" disabled={busy} on:click={() => void verifyAdapter()}>{$t('options.experimental.stems.verifyAdapter', { default: 'Verify inference GPU' })}</button>
        <button type="button" disabled={busy} on:click={() => void removeModel()}>{$t('options.experimental.stems.remove', { default: 'Remove downloaded model' })}</button>
      {/if}
      <button type="button" disabled={busy || storage.resultCount === 0} on:click={() => void clearPreparedTracks()}>{$t('options.experimental.stems.clear', { default: 'Delete prepared tracks' })}</button>
    </div>
  </div>
</article>
