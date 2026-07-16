<script lang="ts">
  import { version as appVersion } from '../../../../package.json';
  import { formatDisplayVersion } from '$lib/utils/version';
  const displayVersion = formatDisplayVersion(appVersion);
</script>

<article class="view">
  <div class="section about-section">
    <h2>About</h2>
    <div class="about-hero">
      <div class="about-pattern" aria-hidden="true">
        <div class="about-pattern-fragment fragment-a">
          <span>00 C-3 01 428</span><span>01 ... .. ...</span><span>02 G-3 02 A06</span><span>03 ... .. ...</span>
        </div>
        <div class="about-pattern-fragment fragment-b">
          <span>1C D#4 03 840</span><span>1D ... .. F03</span><span>1E A-3 01 20F</span><span>1F === == ===</span>
        </div>
        <div class="about-pattern-fragment fragment-c">
          <span>38 C-5 04 C20</span><span>39 ... .. 401</span><span>3A F-4 02 037</span>
        </div>
      </div>
      <div class="about-brand-lockup">
        <img class="about-logo" src="/icons/izci-mark-light.svg" alt="izci logo" />
        <div class="about-copy">
          <p class="about-kicker">GOLDILOCKED / SLOPTIMIZED / WCO'D</p>
          <h3 class="about-name">izci</h3>
          <p class="about-tagline">Experimental PWA music player</p>
          <div class="about-meta-row">
            <span class="about-version">v{displayVersion}</span>
            <span>Toz · 2026</span>
          </div>
        </div>
      </div>
    </div>
  </div>

  <div class="section">
    <h2>Features</h2>
    <ul class="feature-list">
      <li><span class="material-symbols-outlined feature-icon" aria-hidden="true">music_note</span><span>Plays usual streamed formats and tracker modules. It plays tracker modules!!!</span></li>
      <li><span class="material-symbols-outlined feature-icon" aria-hidden="true">auto_stories</span><span>A decent library with artwork, lyrics, and play counts</span></li>
      <li><span class="material-symbols-outlined feature-icon" aria-hidden="true">tab_group</span><span>Dockable tabbed workspace, a big moody Now Playing view, and a mini mode</span></li>
      <li><span class="material-symbols-outlined feature-icon" aria-hidden="true">desktop_windows</span><span>PWA niceties: file associations, media keys, custom window border</span></li>
      <li><span class="material-symbols-outlined feature-icon" aria-hidden="true">palette</span><span>Per-zone artwork and visualizer backdrops</span></li>
      <li><span class="material-symbols-outlined feature-icon" aria-hidden="true">tune</span><span>Raf: a tiny effects rack</span></li>
      <li>
        <span class="material-symbols-outlined feature-icon" aria-hidden="true">explore</span>
        <span>“izci” means “tracker” in Turkish*<small class="feature-note">*Umm actually it’s closer to “scout”. But it was cute and the name stuck</small></span>
      </li>
    </ul>
  </div>
</article>
