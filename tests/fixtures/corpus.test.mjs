import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, posix } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { generateCorpus, inspectPinnedToolchain, loadManifest } from '../../fixtures/generate.mjs';

const fixtureManifest = await loadManifest();
const toolchainStatus = inspectPinnedToolchain(fixtureManifest);

const temporaryDirectories = [];

async function temporaryDirectory() {
  const directory = await mkdtemp(join(tmpdir(), 'izci-fixtures-'));
  temporaryDirectories.push(directory);
  return directory;
}

afterAll(async () => {
  await Promise.all(temporaryDirectories.map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('verification fixture manifest', () => {
  it('records provenance, licensing, generation, digests, and expected facts for every file', async () => {
    const manifest = await loadManifest();
    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.corpusVersion).toMatch(/^stage-1-v\d+$/);
    expect(manifest.files.length).toBeGreaterThan(15);
    expect(manifest.toolchain.node.minimumMajor).toBeGreaterThanOrEqual(22);
    expect(manifest.toolchain.ffmpeg.version).toMatch(/^ffmpeg version /);
    expect(manifest.toolchain.ffprobe.version).toMatch(/^ffprobe version /);
    expect(manifest.toolchain.ffmpeg.requiredEncoders.length).toBeGreaterThan(0);

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
    expect(manifest.requiredCoverage.filter((entry) => entry.status === 'gap').map((entry) => entry.format)).toEqual([
      'xm', 's3m', 'it', 'mo3', 'ahx', 'hvl'
    ]);
  });

  it('defines nested duplicates, stable revisions, and all programmable handle states', async () => {
    const manifest = await loadManifest();
    const filesById = new Map(manifest.files.map((file) => [file.id, file]));
    const ids = new Set(filesById.keys());
    const logical = manifest.logicalFixtures;

    const treeFiles = logical.nestedTree.fileIds.map((id) => filesById.get(id));
    const relativeTreePaths = treeFiles.map((file) => file.path.slice(`${logical.nestedTree.root}/`.length));
    expect(Math.max(...relativeTreePaths.map((path) => path.split('/').length))).toBe(logical.nestedTree.facts.maximumDepth);
    expect(new Set(treeFiles.map((file) => file.sha256)).size).toBe(logical.nestedTree.facts.distinctContentDigests);
    expect(treeFiles.length).toBe(logical.nestedTree.facts.duplicateFileCount);
    expect(logical.nestedTree.fileIds.every((id) => ids.has(id))).toBe(true);
    const duplicateGroup = logical.duplicateIdentities.groups[0].fixtureIds.map((id) => filesById.get(id));
    expect(new Set(duplicateGroup.map((file) => file.sha256)).size).toBe(1);
    expect(new Set(duplicateGroup.map((file) => file.path)).size).toBe(duplicateGroup.length);
    expect(logical.stablePathReplacement.revisionSequence.map((revision) => revision.lastModified)).toEqual([1000, 2000]);
    expect(logical.stablePathReplacement.revisionSequence.every((revision) => ids.has(revision.fixtureId))).toBe(true);
    const revisions = logical.stablePathReplacement.revisionSequence.map((revision) => filesById.get(revision.fixtureId));
    expect(new Set(revisions.map((revision) => revision.sha256)).size).toBe(2);
    expect(logical.stablePathReplacement.path).toBe(filesById.get('tree-stable-path').path);
    expect(logical.handleStates.map((state) => state.id)).toEqual(['granted', 'prompt', 'denied', 'unavailable']);
    expect(logical.handleStates.map(({ queryPermission, requestPermission, available }) => ({
      queryPermission,
      requestPermission,
      available
    }))).toEqual([
      { queryPermission: 'granted', requestPermission: 'granted', available: true },
      { queryPermission: 'prompt', requestPermission: 'granted', available: true },
      { queryPermission: 'denied', requestPermission: 'denied', available: true },
      { queryPermission: 'denied', requestPermission: 'denied', available: false }
    ]);
    expect(logical.handleStates.find((state) => state.id === 'unavailable').available).toBe(false);
  });
});

describe('verification fixture generator', () => {
  const deterministicGenerationTest = toolchainStatus.available ? it : it.skip;
  const unavailableReason = toolchainStatus.available ? '' : ` (intentional skip: ${toolchainStatus.reason})`;

  deterministicGenerationTest(`reproduces digests and verifies media facts with the pinned toolchain${unavailableReason}`, async () => {
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
    expect(first.files.find((file) => file.id === 'audio-tagged-artwork').mediaVerification.status).toBe('verified');
    expect(first.files.find((file) => file.id === 'revision-wav-v1').mediaVerification.status).toBe('verified');
    expect(first.files.find((file) => file.id === 'revision-wav-v2').mediaVerification.status).toBe('verified');
    expect(first.files.find((file) => file.id === 'lyrics-plain').mediaVerification).toEqual({
      status: 'verified',
      format: 'text',
      lines: 2
    });
    expect(first.files.find((file) => file.id === 'lyrics-timestamped').mediaVerification).toEqual({
      status: 'verified',
      format: 'lrc',
      lines: 2
    });
    expect(first.files.find((file) => file.id === 'module-mod').mediaVerification).toEqual({
      status: 'verified',
      container: 'libopenmpt'
    });
    expect(first.files.find((file) => file.id === 'corrupt-truncated-mp3').mediaVerification.status).toBe('rejected-as-expected');
  }, 30_000);

  it('reports an unavailable pinned toolchain without blocking manifest validation', () => {
    const status = inspectPinnedToolchain(fixtureManifest, {
      ffmpeg: 'izci-intentionally-missing-ffmpeg',
      ffprobe: 'izci-intentionally-missing-ffprobe'
    });
    expect(status.available).toBe(false);
    expect(status.reason).toMatch(/^FFmpeg unavailable:/);
  });
});
