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

function runTool(executable, args) {
  return spawnSync(executable, args, { encoding: 'utf8' });
}

function toolVersion(executable) {
  const result = runTool(executable, ['-version']);
  if (result.error) return { available: false, reason: result.error.message };
  if (result.status !== 0) {
    return { available: false, reason: result.stderr.trim() || `exit ${result.status}` };
  }
  return { available: true, version: result.stdout.split(/\r?\n/, 1)[0] };
}

export function inspectPinnedToolchain(
  manifest,
  {
    ffmpeg = process.env.IZCI_FIXTURE_FFMPEG || 'ffmpeg',
    ffprobe = process.env.IZCI_FIXTURE_FFPROBE || 'ffprobe'
  } = {}
) {
  const nodeMajor = Number(process.versions.node.split('.', 1)[0]);
  if (nodeMajor < manifest.toolchain.node.minimumMajor) {
    return {
      available: false,
      reason: `Node.js ${manifest.toolchain.node.minimumMajor}+ is required; found ${process.versions.node}`
    };
  }

  const ffmpegResult = toolVersion(ffmpeg);
  if (!ffmpegResult.available) {
    return { available: false, reason: `FFmpeg unavailable: ${ffmpegResult.reason}` };
  }
  if (ffmpegResult.version !== manifest.toolchain.ffmpeg.version) {
    return {
      available: false,
      reason: `FFmpeg mismatch: expected ${manifest.toolchain.ffmpeg.version}; found ${ffmpegResult.version}`
    };
  }

  const ffprobeResult = toolVersion(ffprobe);
  if (!ffprobeResult.available) {
    return { available: false, reason: `FFprobe unavailable: ${ffprobeResult.reason}` };
  }
  if (ffprobeResult.version !== manifest.toolchain.ffprobe.version) {
    return {
      available: false,
      reason: `FFprobe mismatch: expected ${manifest.toolchain.ffprobe.version}; found ${ffprobeResult.version}`
    };
  }

  const encoders = runTool(ffmpeg, ['-hide_banner', '-encoders']);
  if (encoders.error || encoders.status !== 0) {
    return { available: false, reason: `Could not inspect FFmpeg encoders: ${encoders.error?.message || encoders.stderr.trim()}` };
  }
  const missingEncoders = manifest.toolchain.ffmpeg.requiredEncoders.filter(
    (encoder) => !new RegExp(`\\s${encoder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s`).test(encoders.stdout)
  );
  if (missingEncoders.length > 0) {
    return { available: false, reason: `FFmpeg is missing encoders: ${missingEncoders.join(', ')}` };
  }

  const demuxers = runTool(ffprobe, ['-hide_banner', '-demuxers']);
  if (demuxers.error || demuxers.status !== 0) {
    return { available: false, reason: `Could not inspect FFprobe demuxers: ${demuxers.error?.message || demuxers.stderr.trim()}` };
  }
  const missingDemuxers = manifest.toolchain.ffprobe.requiredDemuxers.filter(
    (demuxer) => !new RegExp(`\\s${demuxer.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s`).test(demuxers.stdout)
  );
  if (missingDemuxers.length > 0) {
    return { available: false, reason: `FFprobe is missing demuxers: ${missingDemuxers.join(', ')}` };
  }

  return {
    available: true,
    ffmpeg,
    ffprobe,
    ffmpegVersion: ffmpegResult.version,
    ffprobeVersion: ffprobeResult.version
  };
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

function assertPinnedToolchain(manifest, executables) {
  const status = inspectPinnedToolchain(manifest, executables);
  if (!status.available) {
    throw new Error(`Pinned fixture toolchain unavailable. ${status.reason}`);
  }
  return status;
}

function probeFile(ffprobe, destination) {
  const result = runTool(ffprobe, [
    '-v', 'error',
    '-show_entries',
    'format=format_name,duration:format_tags:stream=index,codec_name,codec_type,sample_rate,channels,width,height,r_frame_rate:stream_tags:stream_disposition',
    '-of', 'json',
    destination
  ]);
  if (result.error) throw result.error;
  return result.status === 0
    ? { accepted: true, value: JSON.parse(result.stdout) }
    : { accepted: false, error: result.stderr.trim() };
}

function approximately(actual, expected, tolerance, label, fixtureId) {
  if (!Number.isFinite(actual) || Math.abs(actual - expected) > tolerance) {
    throw new Error(`${fixtureId}: expected ${label} ${expected} ± ${tolerance}; received ${actual}`);
  }
}

function expectedProbeContainer(format) {
  return {
    wav: 'wav',
    mp3: 'mp3',
    flac: 'flac',
    ogg: 'ogg',
    opus: 'ogg',
    mp4: 'mov,mp4,m4a,3gp,3g2,mj2',
    webm: 'matroska,webm',
    mkv: 'matroska,webm',
    mod: 'libopenmpt'
  }[format];
}

function rationalNumber(value) {
  const [numerator, denominator] = value.split('/').map(Number);
  return denominator ? numerator / denominator : Number.NaN;
}

async function verifyMediaFacts(file, destination, ffprobe) {
  const expected = file.expected;
  if (expected.kind === 'plain-lyrics' || expected.kind === 'timestamped-lyrics') {
    const contents = await readFile(destination, 'utf8');
    const lines = contents.trimEnd().split(/\r?\n/);
    if (expected.lines !== undefined && lines.length !== expected.lines) {
      throw new Error(`${file.id}: expected ${expected.lines} lyric lines; received ${lines.length}`);
    }
    if (expected.timestampsSeconds) {
      const timestamps = lines.map((line) => {
        const match = line.match(/^\[(\d+):(\d+(?:\.\d+)?)\]/);
        if (!match) throw new Error(`${file.id}: lyric line is missing an LRC timestamp`);
        return Number(match[1]) * 60 + Number(match[2]);
      });
      if (JSON.stringify(timestamps) !== JSON.stringify(expected.timestampsSeconds)) {
        throw new Error(`${file.id}: LRC timestamps do not match the manifest`);
      }
    }
    return { status: 'verified', format: expected.format, lines: lines.length };
  }
  const shouldReject = expected.deliberatelyCorrupt || expected.kind === 'unsupported';
  const shouldProbe = shouldReject || expected.codec || expected.videoCodec || expected.kind === 'tree-file';
  if (!shouldProbe) return { status: 'not-applicable' };

  const probe = probeFile(ffprobe, destination);
  if (shouldReject) {
    if (probe.accepted) throw new Error(`${file.id}: FFprobe unexpectedly accepted rejected fixture`);
    return { status: 'rejected-as-expected' };
  }
  if (!probe.accepted) throw new Error(`${file.id}: FFprobe rejected valid fixture: ${probe.error}`);

  const format = probe.value.format || {};
  const streams = probe.value.streams || [];
  const container = expectedProbeContainer(expected.format);
  if (container && format.format_name !== container) {
    throw new Error(`${file.id}: expected probe container ${container}; received ${format.format_name}`);
  }
  if (expected.durationSeconds !== undefined) {
    approximately(Number(format.duration), expected.durationSeconds, 0.002, 'durationSeconds', file.id);
  }

  for (const [key, value] of Object.entries(expected.tags || {})) {
    if (format.tags?.[key] !== value) {
      throw new Error(`${file.id}: expected tag ${key}=${value}; received ${format.tags?.[key]}`);
    }
  }

  if (expected.kind === 'module' || expected.kind === 'unknown-extension-module') {
    const bytes = await readFile(destination);
    if (bytes.subarray(1080, 1084).toString('ascii') !== 'M.K.') {
      throw new Error(`${file.id}: missing ProTracker M.K. signature`);
    }
    const orderCount = bytes[950];
    const highestPattern = Math.max(...bytes.subarray(952, 952 + orderCount));
    if (expected.channels !== 4 || expected.patterns !== highestPattern + 1) {
      throw new Error(`${file.id}: ProTracker header does not match ${expected.channels} channels/${expected.patterns} patterns`);
    }
    return { status: 'verified', container: format.format_name };
  }

  const audio = streams.find((stream) => stream.codec_type === 'audio');
  if (expected.codec && audio?.codec_name !== expected.codec) {
    throw new Error(`${file.id}: expected audio codec ${expected.codec}; received ${audio?.codec_name}`);
  }
  if (expected.audioCodec && audio?.codec_name !== expected.audioCodec) {
    throw new Error(`${file.id}: expected audio codec ${expected.audioCodec}; received ${audio?.codec_name}`);
  }
  if (expected.sampleRate !== undefined && Number(audio?.sample_rate) !== expected.sampleRate) {
    throw new Error(`${file.id}: expected sample rate ${expected.sampleRate}; received ${audio?.sample_rate}`);
  }
  if (expected.channels !== undefined && audio?.channels !== expected.channels) {
    throw new Error(`${file.id}: expected ${expected.channels} audio channels; received ${audio?.channels}`);
  }
  if (expected.frequencyHz !== undefined) {
    const bytes = await readFile(destination);
    const dataMarker = bytes.indexOf(Buffer.from('data'));
    if (dataMarker < 0) throw new Error(`${file.id}: WAV data chunk is missing`);
    const sampleBytes = bytes.subarray(dataMarker + 8);
    let upwardCrossings = 0;
    let previous = sampleBytes.readInt16LE(0);
    for (let offset = 2; offset + 1 < sampleBytes.length; offset += 2) {
      const current = sampleBytes.readInt16LE(offset);
      if (previous <= 0 && current > 0) upwardCrossings += 1;
      previous = current;
    }
    approximately(
      upwardCrossings / expected.durationSeconds,
      expected.frequencyHz,
      2,
      'frequencyHz',
      file.id
    );
  }

  const attachedArtwork = streams.find((stream) => stream.disposition?.attached_pic === 1);
  if (expected.artwork) {
    if (!attachedArtwork) throw new Error(`${file.id}: expected attached artwork`);
    if (attachedArtwork.codec_name !== expected.artwork.format ||
        attachedArtwork.width !== expected.artwork.width ||
        attachedArtwork.height !== expected.artwork.height) {
      throw new Error(`${file.id}: attached artwork facts do not match the manifest`);
    }
    if (expected.artwork.type === 'front-cover'
      && attachedArtwork.tags?.comment !== 'Cover (front)') {
      throw new Error(`${file.id}: attached artwork is not marked as the front cover`);
    }
  } else if (attachedArtwork) {
    throw new Error(`${file.id}: manifest says artwork=false but FFprobe found attached artwork`);
  }
  if (expected.lyrics === false) {
    const tags = Object.keys(format.tags || {}).map((key) => key.toLowerCase());
    if (tags.some((key) => ['lyrics', 'unsyncedlyrics', 'syncedlyrics'].includes(key))) {
      throw new Error(`${file.id}: manifest says lyrics=false but FFprobe found a lyrics tag`);
    }
  }

  if (expected.videoCodec) {
    const video = streams.find((stream) => stream.codec_type === 'video' && stream.disposition?.attached_pic !== 1);
    if (video?.codec_name !== expected.videoCodec || video.width !== expected.width || video.height !== expected.height) {
      throw new Error(`${file.id}: video codec or dimensions do not match the manifest`);
    }
    approximately(rationalNumber(video.r_frame_rate), expected.frameRate, 0.0001, 'frameRate', file.id);
  }
  return { status: 'verified', container: format.format_name };
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
  ffprobe = process.env.IZCI_FIXTURE_FFPROBE || 'ffprobe',
  verify = true
} = {}) {
  const manifest = await loadManifest();
  const target = resolve(outputDirectory || join(REPOSITORY_ROOT, manifest.defaultOutputDirectory));
  const toolchain = assertPinnedToolchain(manifest, { ffmpeg, ffprobe });
  await mkdir(target, { recursive: true });

  const files = [];
  for (const file of manifest.files) {
    const generated = await materializeFile(file, target, ffmpeg);
    if (verify && (generated.sha256 !== file.sha256 || generated.bytes !== file.expected.bytes)) {
      throw new Error(
        `Fixture digest mismatch for ${file.id}: expected ${file.sha256}/${file.expected.bytes}, ` +
        `received ${generated.sha256}/${generated.bytes}`
      );
    }
    if (verify) generated.mediaVerification = await verifyMediaFacts(file, resolve(target, file.path), ffprobe);
    files.push(generated);
  }

  const report = {
    schemaVersion: 1,
    corpusVersion: manifest.corpusVersion,
    ffmpegVersion: toolchain.ffmpegVersion,
    ffprobeVersion: toolchain.ffprobeVersion,
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

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
