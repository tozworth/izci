import { readFile } from 'node:fs/promises';

export async function readScenarioCatalog(path) {
  const source = await readFile(path, 'utf8');
  const catalog = JSON.parse(source);
  if (catalog.schemaVersion !== 1 || !Array.isArray(catalog.scenarios)
    || catalog.scenarios.length === 0) throw new Error('Invalid CDP scenario catalog.');
  const ids = new Set();
  for (const scenario of catalog.scenarios) {
    if (!scenario.id || !scenario.path || !scenario.ready || ids.has(scenario.id)) {
      throw new Error(`Invalid or duplicate CDP scenario: ${scenario.id ?? '<missing>'}`);
    }
    ids.add(scenario.id);
  }
  return catalog;
}

export function assertScenarioEntrypoints(catalog, build) {
  const catalogPaths = catalog.scenarios.map((scenario) =>
    scenario.path === '/' ? 'index.html' : scenario.path.replace(/^\/+/, ''));
  if (new Set(catalogPaths).size !== catalogPaths.length) {
    throw new Error('CDP scenario catalog contains duplicate entrypoint paths.');
  }
  const builtHtml = build.files
    .filter((file) => file.path.endsWith('.html'))
    .map((file) => file.path)
    .sort();
  const declaredHtml = [...catalogPaths].sort();
  if (JSON.stringify(builtHtml) !== JSON.stringify(declaredHtml)) {
    throw new Error(
      `CDP scenario/build entrypoint mismatch: built=${builtHtml.join(',')} declared=${declaredHtml.join(',')}`
    );
  }
}

export function assertBuildProvenance(provenance, commit) {
  if (provenance?.schemaVersion !== 1 || typeof provenance.commit !== 'string'
    || typeof provenance.dirty !== 'boolean') {
    throw new Error('Invalid production build provenance marker.');
  }
  if (provenance.dirty) {
    throw new Error('Production build provenance records a dirty worktree.');
  }
  if (!commit || provenance.commit !== commit) {
    throw new Error(
      `Production build commit mismatch: built=${provenance.commit} current=${commit ?? 'unknown'}`
    );
  }
}
