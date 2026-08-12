#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const FIXTURE_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const MANIFEST_PATH = join(FIXTURE_DIRECTORY, 'manifest.json');
const REPOSITORY_ROOT = resolve(FIXTURE_DIRECTORY, '..');

const FFMPEG_RECIPES = {
  'audio-wav-440': [
    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=0.25',
    '-map_metadata', '-1', '-fflags', '+bitexact', '-flags:a', '+bitexact',
    '-ac', '1', '-c:a', 'pcm_s16le'
  ],
  'audio-wav-660': [
    '-f', 'lavfi', '-i', 'sine=frequency=660:sample_rate=48000:duration=0.25',
    '-map_metadata', '-1', '-fflags', '+bitexact', '-flags:a', '+bitexact',
    '-ac', '1', '-c:a', 'pcm_s16le'
  ],
  'audio-mp3-440': [
    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=0.25',
    '-map_metadata', '-1', '-fflags', '+bitexact', '-flags:a', '+bitexact',
    '-ac', '1', '-c:a', 'libmp3lame', '-b:a', '48k', '-write_xing', '0',
    '-id3v2_version', '0'
  ],
  'audio-flac-440': [
    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=0.25',
    '-map_metadata', '-1', '-fflags', '+bitexact', '-flags:a', '+bitexact',
    '-ac', '1', '-c:a', 'flac', '-compression_level', '5'
  ],
  'audio-ogg-440': [
    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=0.25',
    '-map_metadata', '-1', '-fflags', '+bitexact', '-flags:a', '+bitexact',
    '-ac', '1', '-c:a', 'libvorbis', '-q:a', '2'
  ],
  'audio-opus-440': [
    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=0.25',
    '-map_metadata', '-1', '-fflags', '+bitexact', '-flags:a', '+bitexact',
    '-ac', '1', '-c:a', 'libopus', '-b:a', '32k', '-vbr', 'off'
  ],
  'audio-tagged-mp3': [
    '-f', 'lavfi', '-i', 'sine=frequency=523.25:sample_rate=48000:duration=0.25',
    '-f', 'lavfi', '-i', 'color=c=0xc8a03a:s=16x16:r=1:d=0.25',
    '-map', '0:a', '-map', '1:v', '-map_metadata', '-1', '-fflags', '+bitexact',
    '-flags:a', '+bitexact', '-flags:v', '+bitexact', '-c:a', 'libmp3lame',
    '-b:a', '48k', '-write_xing', '0', '-c:v', 'png', '-threads:v', '1',
    '-disposition:v', 'attached_pic', '-id3v2_version', '3',
    '-metadata', 'title=Fixture title', '-metadata', 'artist=izci fixtures',
    '-metadata', 'album=Stage 1', '-metadata', 'date=2026', '-metadata', 'track=1',
    '-metadata', 'comment=CC0 synthetic fixture',
    '-metadata:s:v', 'title=Fixture cover',
    '-metadata:s:v', 'comment=Cover (front)'
  ],
  'video-mp4': [
    '-f', 'lavfi', '-i', 'color=c=0x234567:s=32x24:r=10:d=0.3',
    '-f', 'lavfi', '-i', 'sine=frequency=660:sample_rate=48000:duration=0.3',
    '-map_metadata', '-1', '-fflags', '+bitexact', '-flags:v', '+bitexact',
    '-flags:a', '+bitexact', '-shortest', '-c:v', 'libx264', '-preset', 'veryslow',
    '-tune', 'stillimage', '-pix_fmt', 'yuv420p',
    '-x264-params', 'threads=1:lookahead_threads=1:sync_lookahead=0',
    '-c:a', 'aac', '-b:a', '32k', '-movflags', '+faststart'
  ],
  'video-webm': [
    '-f', 'lavfi', '-i', 'color=c=0x234567:s=32x24:r=10:d=0.3',
    '-f', 'lavfi', '-i', 'sine=frequency=660:sample_rate=48000:duration=0.3',
    '-map_metadata', '-1', '-fflags', '+bitexact', '-flags:v', '+bitexact',
    '-flags:a', '+bitexact', '-shortest', '-c:v', 'libvpx', '-deadline', 'best',
    '-cpu-used', '0', '-threads', '1', '-pix_fmt', 'yuv420p', '-c:a', 'libopus',
    '-b:a', '32k', '-vbr', 'off'
  ],
  'video-mkv': [
    '-f', 'lavfi', '-i', 'color=c=0x234567:s=32x24:r=10:d=0.3',
    '-f', 'lavfi', '-i', 'sine=frequency=660:sample_rate=48000:duration=0.3',
    '-map_metadata', '-1', '-fflags', '+bitexact', '-flags:v', '+bitexact',
    '-flags:a', '+bitexact', '-shortest', '-c:v', 'libvpx', '-deadline', 'best',
    '-cpu-used', '0', '-threads', '1', '-pix_fmt', 'yuv420p', '-c:a', 'libvorbis',
    '-q:a', '2'
  ]
};

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function ensureRelativeFixturePath(path) {
  if (isAbsolute(path) || path.split('/').includes('..')) {
    throw new Error(`Fixture output path must be repository-relative: ${path}`);
  }
}

function makeProTrackerMod() {
  const titleSize = 20;
  const sampleHeaderSize = 30;
  const sampleCount = 31;
  const orderTableSize = 128;
  const patternSize = 64 * 4 * 4;
  const sampleSize = 1024;
  const headerSize = titleSize + sampleHeaderSize * sampleCount + 2 + orderTableSize + 4;
  const result = Buffer.alloc(headerSize + patternSize + sampleSize);
  result.write('izci Stage 1 MOD', 0, 'ascii');

  const sampleHeader = titleSize;
  result.write('440 Hz synthetic', sampleHeader, 'ascii');
  result.writeUInt16BE(sampleSize / 2, sampleHeader + 22);
  result[sampleHeader + 24] = 0;
  result[sampleHeader + 25] = 64;
  result.writeUInt16BE(0, sampleHeader + 26);
  result.writeUInt16BE(1, sampleHeader + 28);

  const songLengthOffset = titleSize + sampleHeaderSize * sampleCount;
  result[songLengthOffset] = 1;
  result[songLengthOffset + 1] = 0x7f;
  result.write('M.K.', songLengthOffset + 2 + orderTableSize, 'ascii');

  const patternOffset = headerSize;
  const periodC3 = 428;
  result[patternOffset] = (periodC3 >> 8) & 0x0f;
  result[patternOffset + 1] = periodC3 & 0xff;
  result[patternOffset + 2] = 0x10;
  result[patternOffset + 3] = 0;

  const sampleOffset = headerSize + patternSize;
  for (let index = 0; index < sampleSize; index += 1) {
    const signed = Math.round(Math.sin((index / 32) * Math.PI * 2) * 96);
    result[sampleOffset + index] = signed & 0xff;
  }
  return result;
}

function getFfmpegVersion(ffmpeg) {
  const result = spawnSync(ffmpeg, ['-version'], { encoding: 'utf8' });
  if (result.error) {
    throw new Error(`FFmpeg is required for this fixture set: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`FFmpeg version check failed: ${result.stderr.trim()}`);
  }
  return result.stdout.split(/\r?\n/, 1)[0];
}

async function materializeFile(file, outputDirectory, ffmpeg) {
  const destination = resolve(outputDirectory, file.path);
  const outputRelativePath = relative(outputDirectory, destination);
  ensureRelativeFixturePath(outputRelativePath);
  await mkdir(dirname(destination), { recursive: true });

  switch (file.generation.kind) {
    case 'ffmpeg': {
      const recipe = FFMPEG_RECIPES[file.generation.recipe];
      if (!recipe) throw new Error(`Unknown FFmpeg fixture recipe: ${file.generation.recipe}`);
      const result = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', ...recipe, destination], {
        encoding: 'utf8'
      });
      if (result.error) throw result.error;
      if (result.status !== 0) {
        throw new Error(`FFmpeg failed for ${file.id}: ${result.stderr.trim()}`);
      }
      break;
    }
    case 'protracker-mod':
      await writeFile(destination, makeProTrackerMod());
      break;
    case 'utf8':
      await writeFile(destination, file.generation.content, 'utf8');
      break;
    case 'bytes':
      await writeFile(destination, Buffer.from(file.generation.hex, 'hex'));
      break;
    case 'copy': {
      const source = resolve(outputDirectory, file.generation.source);
      ensureRelativeFixturePath(relative(outputDirectory, source));
      const sourceBytes = await readFile(source);
      const bytes = Number.isInteger(file.generation.length)
        ? sourceBytes.subarray(0, file.generation.length)
        : sourceBytes;
      await writeFile(destination, bytes);
      break;
    }
    default:
      throw new Error(`Unknown fixture generator kind: ${file.generation.kind}`);
  }

  const bytes = await readFile(destination);
  return { id: file.id, path: file.path, bytes: bytes.byteLength, sha256: sha256(bytes) };
}

export async function loadManifest() {
  return JSON.parse(await readFile(MANIFEST_PATH, 'utf8'));
}

export async function generateCorpus({
  outputDirectory,
  ffmpeg = process.env.IZCI_FIXTURE_FFMPEG || 'ffmpeg',
  verify = true
} = {}) {
  const manifest = await loadManifest();
  const target = resolve(outputDirectory || join(REPOSITORY_ROOT, manifest.defaultOutputDirectory));
  await mkdir(target, { recursive: true });

  const ffmpegVersion = getFfmpegVersion(ffmpeg);
  if (ffmpegVersion !== manifest.toolchain.ffmpeg.version) {
    throw new Error(
      `Fixture digests are pinned to ${manifest.toolchain.ffmpeg.version}; found ${ffmpegVersion}`
    );
  }

  const files = [];
  for (const file of manifest.files) {
    const generated = await materializeFile(file, target, ffmpeg);
    if (verify && (generated.sha256 !== file.sha256 || generated.bytes !== file.expected.bytes)) {
      throw new Error(
        `Fixture digest mismatch for ${file.id}: expected ${file.sha256}/${file.expected.bytes}, ` +
        `received ${generated.sha256}/${generated.bytes}`
      );
    }
    files.push(generated);
  }

  const report = {
    schemaVersion: 1,
    corpusVersion: manifest.corpusVersion,
    ffmpegVersion,
    files
  };
  await writeFile(join(target, 'generation-report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return { outputDirectory: target, ...report };
}

async function main() {
  const args = process.argv.slice(2);
  const outputFlag = args.indexOf('--output');
  const outputDirectory = outputFlag >= 0 ? args[outputFlag + 1] : undefined;
  const verify = !args.includes('--print-digests');
  const result = await generateCorpus({ outputDirectory, verify });
  if (verify) {
    console.log(`Generated and verified ${result.files.length} fixtures in ${result.outputDirectory}`);
  } else {
    console.log(JSON.stringify(result.files, null, 2));
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
