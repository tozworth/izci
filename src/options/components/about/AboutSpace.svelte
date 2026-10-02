<script lang="ts">
  import { planetTiles, stars } from './space-geometry';
</script>

<div class="about-space" aria-hidden="true">
  <svg class="starfield" viewBox="0 0 1200 800" preserveAspectRatio="none">
    <g fill="#c3e3ff">
      {#each stars as star}
        <circle cx={star.x} cy={star.y} r={star.radius} opacity={star.opacity} />
      {/each}
    </g>
    <g fill="none" stroke="#a8d6ff" stroke-width="0.6" opacity="0.5">
      <path d="M1040 181v10m-5-5h10M141 142v8m-4-4h8M1004 604v8m-4-4h8" />
    </g>
  </svg>

  <svg class="planet" viewBox="0 0 660 660">
    <defs>
      <radialGradient id="about-planet-shade" cx="72%" cy="18%" r="84%">
        <stop offset="0" stop-color="#b9d8ff" stop-opacity="0.12" />
        <stop offset="0.35" stop-color="#061126" stop-opacity="0.12" />
        <stop offset="0.7" stop-color="#020716" stop-opacity="0.7" />
        <stop offset="1" stop-color="#020510" stop-opacity="0.97" />
      </radialGradient>
      <radialGradient id="about-planet-atmosphere">
        <stop offset="0.91" stop-color="#79bbff" stop-opacity="0" />
        <stop offset="0.95" stop-color="#79bbff" stop-opacity="0.08" />
        <stop offset="0.976" stop-color="#8fceff" stop-opacity="0.36" />
        <stop offset="1" stop-color="#79bbff" stop-opacity="0" />
      </radialGradient>
    </defs>
    <circle cx="330" cy="330" r="302" fill="url(#about-planet-atmosphere)" />
    <g transform="rotate(-23 330 330)" stroke-width="0.4" stroke-linejoin="round">
      {#each planetTiles as tile}
        <path d={tile.path} fill={tile.light ? '#cbd7e9' : '#a53e58'} stroke={tile.light ? '#cbd7e9' : '#a53e58'} />
      {/each}
    </g>
    <circle cx="330" cy="330" r="284" fill="url(#about-planet-shade)" stroke="#8dcaff" stroke-opacity="0.35" />

    <g class="space-bubble">
      <path d="M355 17h57q5 0 5 5v23q0 5-5 5h-26l-15 20 4-20h-20q-5 0-5-5V22q0-5 5-5Z" />
      <text x="383" y="39" text-anchor="middle">M.K.</text>
      <path d="M515 62h59q5 0 5 5v23q0 5-5 5h-37l-39 37 26-37h-9q-5 0-5-5V67q0-5 5-5Z" />
      <text x="544" y="84" text-anchor="middle">M!K!</text>
    </g>
  </svg>

  <svg class="satellite" viewBox="0 0 160 138">
    <g transform="rotate(-24 80 92)" stroke="#91badc" stroke-width="1.2" stroke-linejoin="round">
      <path d="M28 81h31v25H28zM102 81h31v25h-31z" fill="#123253" />
      <path d="M38 81v25m11-25v25m63-25v25m11-25v25M28 93h31m43 0h31" opacity="0.6" />
      <path d="M59 93h12m19 0h12" />
      <path d="m71 80 19 3v24l-19-3z" fill="#89a8c6" />
      <path d="m71 80 8-5 19 3-8 5m0 24 8-6V78" fill="#345675" />
      <path d="m79 75 3-15m-10-3q8 14 21 5Z" fill="#a9c9e3" />
      <path d="m80 61 6-10m-7-9q10 0 13 10m-14-17q17 0 21 17" fill="none" stroke-opacity="0.45" />
      <circle cx="86" cy="51" r="1.8" fill="#d9eeff" stroke="none" />
    </g>
    <g class="space-bubble">
      <path d="M89 8h49q4 0 4 4v20q0 4-4 4h-29l-15 15 4-15h-9q-4 0-4-4V12q0-4 4-4Z" />
      <text x="114" y="27" text-anchor="middle">F/P?</text>
    </g>
  </svg>
</div>

<style>
  .about-space {
    position: absolute;
    inset: 0;
    overflow: hidden;
    pointer-events: none;
    background:
      radial-gradient(ellipse at 58% 29%, #20446c55, transparent 48%),
      radial-gradient(ellipse at 100% 85%, #153d6960, transparent 60%),
      radial-gradient(ellipse at 10% 65%, #132f5350, transparent 42%),
      linear-gradient(155deg, #050913, #08152a 58%, #030811);
  }

  .starfield {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
  }

  .planet {
    --planet-size: clamp(400px, 80cqi, 760px);
    position: absolute;
    width: var(--planet-size);
    height: var(--planet-size);
    left: calc(var(--planet-size) * -0.45);
    bottom: calc(var(--planet-size) * -0.54);
  }

  .satellite {
    position: absolute;
    width: clamp(82px, 17cqi, 130px);
    height: auto;
    top: 11%;
    right: 3%;
    opacity: 0.9;
  }

  .space-bubble path {
    fill: #09172b;
    stroke: #8eafd0;
    stroke-width: 1;
  }

  .space-bubble text {
    fill: #d5e6f7;
    font-family: ui-monospace, "SFMono-Regular", Consolas, monospace;
    font-size: 17px;
    letter-spacing: 0.3px;
  }

  @container (max-width: 360px) {
    .satellite {
      top: 4%;
      right: 1%;
    }

    .planet {
      --planet-size: 360px;
      left: -175px;
    }
  }
</style>
