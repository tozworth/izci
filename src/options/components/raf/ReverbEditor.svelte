<script lang="ts">
  import {
    REVERB_DAMPING_MAX_HZ,
    REVERB_DAMPING_MIN_HZ,
    REVERB_DECAY_MAX_SECONDS,
    REVERB_DECAY_MIN_SECONDS,
    REVERB_MIX_MAX,
    REVERB_MIX_MIN,
    REVERB_PRE_DELAY_MAX_MS,
    REVERB_PRE_DELAY_MIN_MS,
    REVERB_ROOM_SIZE_MAX,
    REVERB_ROOM_SIZE_MIN
  } from '$lib/services/raf-effects/reverb';
  import { rafSettings } from '$lib/stores/raf-settings';
  import type { RafReverbSettings } from '$lib/types';

  export let settings: RafReverbSettings;
  type ReverbKey = 'mix' | 'roomSize' | 'decaySeconds' | 'preDelayMs' | 'dampingHz';

  function update(event: Event, key: ReverbKey) {
    const value = (event.currentTarget as HTMLInputElement).valueAsNumber;
    rafSettings.updateEffect(settings.id, (effect) => effect.type === 'reverb' ? { ...effect, [key]: value } : effect);
  }
</script>

<div class="reverb-editor">
  <label><span>Mix</span><input type="range" min={REVERB_MIX_MIN} max={REVERB_MIX_MAX} step="1" value={settings.mix} on:input={(event) => update(event, 'mix')} /><output>{settings.mix.toFixed(0)}%</output></label>
  <label><span>Room</span><input type="range" min={REVERB_ROOM_SIZE_MIN} max={REVERB_ROOM_SIZE_MAX} step="1" value={settings.roomSize} on:change={(event) => update(event, 'roomSize')} /><output>{settings.roomSize.toFixed(0)}%</output></label>
  <label><span>Decay</span><input type="range" min={REVERB_DECAY_MIN_SECONDS} max={REVERB_DECAY_MAX_SECONDS} step="0.1" value={settings.decaySeconds} on:change={(event) => update(event, 'decaySeconds')} /><output>{settings.decaySeconds.toFixed(1)} s</output></label>
  <label><span>Pre-delay</span><input type="range" min={REVERB_PRE_DELAY_MIN_MS} max={REVERB_PRE_DELAY_MAX_MS} step="1" value={settings.preDelayMs} on:input={(event) => update(event, 'preDelayMs')} /><output>{settings.preDelayMs.toFixed(0)} ms</output></label>
  <label><span>Damping</span><input type="range" min={REVERB_DAMPING_MIN_HZ} max={REVERB_DAMPING_MAX_HZ} step="100" value={settings.dampingHz} on:input={(event) => update(event, 'dampingHz')} /><output>{(settings.dampingHz / 1_000).toFixed(1)} kHz</output></label>
</div>

<style>
  .reverb-editor { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 7px 14px; padding: 2px; }
  label { min-width: 0; display: grid; grid-template-columns: 47px minmax(80px, 1fr) 55px; align-items: center; gap: 7px; color: var(--muted); font-size: 10px; }
  input[type='range'] { width: 100%; accent-color: var(--accent-strong); }
  output { color: var(--text-strong); text-align: right; font-variant-numeric: tabular-nums; }
  @container (max-width: 390px) { .reverb-editor { grid-template-columns: 1fr; } }
</style>
