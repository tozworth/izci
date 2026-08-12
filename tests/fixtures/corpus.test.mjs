import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, posix } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { generateCorpus, loadManifest } from '../../fixtures/generate.mjs';

const temporaryDirectories = [];

async function temporaryDirectory() {
  const directory = await mkdtemp(join(tmpdir(), 'izci-fixtures-'));
  temporaryDirectories.push(directory);
  return directory;
}

afterAll(async () => {
  await Promise.all(temporaryDirectories.map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('Stage 1 fixture manifest', () => {
  it('records provenance, licensing, generation, digests, and expected facts for every file', async () => {
    const manifest = await loadManifest();
    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.corpusVersion).toMatch(/^stage-1-v\d+$/);
    expect(manifest.files.length).toBeGreaterThan(15);

    const ids = new Set();
    const paths = new Set();
    for (const file of manifest.files) {
      expect(ids.has(file.id), `duplicate fixture id ${file.id}`).toBe(false);
      expect(paths.has(file.path), `duplicate fixture path ${file.path}`).toBe(false);
      ids.add(file.id);
      paths.add(file.path);
      expect(file.provenance).toBeTruthy();
      expect(file.license).toBe('CC0-1.0');
      expect(file.generation.command).toBeTruthy();
      expect(file.sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(file.expected.bytes).toBeGreaterThan(0);
      expect(posix.isAbsolute(file.path)).toBe(false);
      expect(file.path.split('/')).not.toContain('..');
      expect(typeof file.expected.deliberatelyCorrupt).toBe('boolean');
    }

    for (const coverage of manifest.requiredCoverage) {
      expect(['generated', 'gap', 'format-policy']).toContain(coverage.status);
      if (coverage.status === 'generated') expect(ids.has(coverage.fixtureId)).toBe(true);
      if (coverage.status === 'gap') expect(coverage.reason).toBeTruthy();
      if (coverage.status === 'format-policy') expect(coverage.evidence).toBeTruthy();
    }
  });

  it('defines nested duplicates, stable revisions, and all programmable handle states', async () => {
    const manifest = await loadManifest();
    const ids = new Set(manifest.files.map((file) => file.id));
    const logical = manifest.logicalFixtures;

    expect(logical.nestedTree.facts.maximumDepth).toBeGreaterThanOrEqual(3);
    expect(logical.nestedTree.fileIds.every((id) => ids.has(id))).toBe(true);
    expect(logical.duplicateIdentities.groups[0].fixtureIds.length).toBeGreaterThanOrEqual(3);
    expect(logical.stablePathReplacement.revisionSequence.map((revision) => revision.lastModified)).toEqual([1000, 2000]);
    expect(logical.stablePathReplacement.revisionSequence.every((revision) => ids.has(revision.fixtureId))).toBe(true);
    expect(logical.handleStates.map((state) => state.id)).toEqual(['granted', 'prompt', 'denied', 'unavailable']);
    expect(logical.handleStates.find((state) => state.id === 'unavailable').available).toBe(false);
  });
});

describe('Stage 1 fixture generator', () => {
  it('reproduces the manifest digests in independent output directories', async () => {
    const firstDirectory = await temporaryDirectory();
    const secondDirectory = await temporaryDirectory();
    const first = await generateCorpus({ outputDirectory: firstDirectory });
    const second = await generateCorpus({ outputDirectory: secondDirectory });

    expect(first.files).toEqual(second.files);
    expect(first.files.length).toBe((await loadManifest()).files.length);
    for (const file of first.files) {
      expect(await readFile(join(firstDirectory, file.path))).toEqual(
        await readFile(join(secondDirectory, file.path))
      );
    }
  }, 30_000);
});
