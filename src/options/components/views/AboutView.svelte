<script lang="ts">
  import { version as appVersion } from '../../../../package.json';
  import { formatDisplayVersion } from '$lib/utils/version';
  const displayVersion = formatDisplayVersion(appVersion);
</script>

<article class="view">
  <div class="section about-section">
    <h2>About</h2>
    <div class="about-hero">
      <img class="about-logo" src="/icons/izci-icon.svg" alt="izci logo" />
      <div class="about-copy">
        <h3 class="about-name">izci</h3>
        <p class="about-tagline">PWA music player</p>
        <p class="about-meta">Version {displayVersion}</p>
        <p class="about-meta">Toz, 2026</p>
      </div>
    </div>
  </div>

  <div class="section">
    <h2>Features</h2>
    <ul class="feature-list">
      <li>Plays usual streamed formats and tracker modules. It plays tracker modules!!!</li>
      <li>Local-first and offline-capable</li>
      <li>Persistent playlists and a proper library, with metadata, artwork, lyrics, and play counts</li>
      <li>Dockable workspaces, a big moody Now Playing view, and a mini mode</li>
      <li>Desktop PWA niceties: file associations, media keys, launch handling, custom window chrome</li>
      <li>Per-zone artwork and visualizer backdrops</li>
      <li>Raf: a tiny effects rack, with the usual suspects</li>
      <li>"izci" means “tracker” in Turkish; well closer to “scout” but it was cute and the name stuck</li>
    </ul>
  </div>
</article>

