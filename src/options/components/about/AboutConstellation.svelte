<script lang="ts">
  import { constellationArc, constellationNeedle } from './space-geometry';
</script>

<svg class="about-constellation" viewBox="48 40 416 416" aria-hidden="true">
  <g class="constellation-lines">
    {#each [0, -90, 180] as rotation}
      <polygon points={constellationArc.map((point) => point.join(',')).join(' ')} transform="rotate({rotation} 256 256)" />
    {/each}
    <polygon points={constellationNeedle.map((point) => point.join(',')).join(' ')} />
  </g>
  <g class="constellation-halos">
    {#each [0, -90, 180] as rotation}
      <g transform="rotate({rotation} 256 256)">
        {#each constellationArc as [x, y]}
          <circle cx={x} cy={y} r="6" />
        {/each}
      </g>
    {/each}
    {#each constellationNeedle as [x, y]}
      <circle cx={x} cy={y} r="6" />
    {/each}
  </g>
  <g class="constellation-stars">
    {#each [0, -90, 180] as rotation}
      <g transform="rotate({rotation} 256 256)">
        {#each constellationArc as [x, y], index}
          <circle cx={x} cy={y} r={index % 3 === 0 ? 2.8 : 1.8} />
        {/each}
      </g>
    {/each}
    {#each constellationNeedle as [x, y], index}
      <circle cx={x} cy={y} r={index === 7 ? 4 : index % 3 === 0 ? 2.5 : 1.6} />
    {/each}
    <circle cx="256" cy="256" r="4" />
    <path d="M424 64v24m-12-12h24M256 247v18m-9-9h18" />
  </g>
</svg>

<style>
  .about-constellation {
    display: block;
    width: clamp(148px, 35cqi, 280px);
    max-width: 100%;
    height: auto;
    overflow: visible;
    margin: 0 auto 10px;
  }

  .constellation-lines {
    fill: none;
    stroke: #75a8d5;
    stroke-width: 1.1;
    stroke-linejoin: round;
    opacity: 0.64;
  }

  .constellation-halos {
    fill: #69b5ff;
    opacity: 0.12;
  }

  .constellation-stars {
    fill: #e0f3ff;
    stroke: #e0f3ff;
    stroke-width: 0.8;
  }
</style>
