<script lang="ts">
  export let artworkUrl: string;
</script>

<div class="library-album-backdrop" aria-hidden="true">
  <img src={artworkUrl} alt="" />
  <div class="library-album-backdrop-overlay"></div>
</div>

<style>
  .library-album-backdrop {
    position: absolute;
    inset: 0;
    z-index: 0;
    overflow: hidden;
    pointer-events: none;
  }

  .library-album-backdrop img,
  .library-album-backdrop-overlay {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
  }

  .library-album-backdrop img {
    object-fit: cover;
    filter: blur(56px) saturate(1.18);
    transform: scale(1.18);
  }

  .library-album-backdrop-overlay {
    background:
      radial-gradient(circle at top, rgba(255, 255, 255, 0.017), transparent 36%),
      linear-gradient(180deg, rgba(8, 9, 13, 0.51) 0%, rgba(8, 9, 13, 0.42) 52%, rgba(8, 9, 13, 0.51) 100%);
  }
</style>
