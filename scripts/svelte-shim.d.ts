// Shim for module kinds plain tsc cannot resolve; only used by
// scripts/tsconfig.strict.json (never by svelte-check's config).
declare module '*.svelte' {
  const component: any;
  export default component;
  // Named exports (e.g. <script context="module"> types) used by tsc-strict
  // only; svelte-check resolves the real declarations.
  export type SharedOptionsViewDefinition = any;
}
declare module '*?url';
declare module '*?raw';
declare module '*?worker';
declare module '*?inline';
