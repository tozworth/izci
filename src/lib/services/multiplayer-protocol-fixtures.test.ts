import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  isHostMessage,
  isMultiplayerCommand,
  isMultiplayerCommandEnvelope,
  isUnknownCriticalMessage
} from './multiplayer-protocol';
import { isClientMessage } from './multiplayer-utils';
import { parseSourceFileFrame } from './multiplayer-source-transfer';
import { decodeRenderFrame } from './multiplayer-render-transfer';

const PROTOCOL_DIR = join(process.cwd(), 'tests', 'multiplayer-protocol');
const FRAMES_DIR = join(PROTOCOL_DIR, 'frames');
const TRANSCRIPTS_DIR = join(PROTOCOL_DIR, 'transcripts');

function isChunkFrame(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const frame = value as Record<string, unknown>;
  return frame.kind === 'chunk'
    && typeof frame.transferId === 'string'
    && Number.isInteger(frame.index)
    && Number.isInteger(frame.total)
    && (frame.total as number) > 0
    && (frame.total as number) <= 10_000
    && (frame.index as number) >= 0
    && (frame.index as number) < (frame.total as number)
    && typeof frame.payload === 'string';
}

describe('multiplayer protocol shared fixtures', () => {
  const entries = readdirSync(PROTOCOL_DIR).filter((name) => name.endsWith('.json'));
  it('has fixtures', () => {
    expect(entries.length).toBeGreaterThan(0);
  });
  for (const name of entries) {
    const wantValid = name.startsWith('valid-');
    const wantInvalid = name.startsWith('invalid-');
    it(`${name} is ${wantValid ? 'accepted' : 'rejected'}`, () => {
      expect(wantValid || wantInvalid).toBe(true);
      const raw = readFileSync(join(PROTOCOL_DIR, name), 'utf8');
      const value = JSON.parse(raw) as unknown;
      const record = value as Record<string, unknown>;
      // Source-file string frames validate separately.
      if (record.kind === 'file.begin' || record.kind === 'file.end') {
        const parsed = parseSourceFileFrame(raw);
        if (wantValid) expect(parsed).not.toBeNull();
        else expect(parsed).toBeNull();
        return;
      }
      if (record.kind === 'chunk') {
        const valid = isChunkFrame(value);
        if (wantValid) expect(valid).toBe(true);
        else expect(valid).toBe(false);
        return;
      }
      // Unknown optional kinds are safely ignored, not decoded as known.
      if (name === 'valid-unknown-optional.json') {
        expect(isHostMessage(value)).toBe(false);
        expect(isClientMessage(value)).toBe(false);
        expect(isUnknownCriticalMessage(value)).toBe(false);
        return;
      }
      // Unsupported command types decode as envelopes (to nack) but not as supported.
      if (name === 'valid-command-unsupported-type.json') {
        expect(isClientMessage(value)).toBe(true);
        const command = (record.command as Record<string, unknown>) ?? null;
        expect(isMultiplayerCommandEnvelope(command)).toBe(true);
        expect(isMultiplayerCommand(command)).toBe(false);
        return;
      }
      const hostOk = isHostMessage(value);
      const clientOk = isClientMessage(value);
      if (wantValid) {
        expect(hostOk || clientOk).toBe(true);
      } else {
        expect(hostOk).toBe(false);
        expect(clientOk).toBe(false);
      }
    });
  }
});

describe('multiplayer protocol binary frames', () => {
  it('decodes valid render fragments', () => {
    for (const name of ['valid-render-cluster.bin', 'valid-render-init.bin']) {
      const data = readFileSync(join(FRAMES_DIR, name));
      const buffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
      const decoded = decodeRenderFrame(buffer);
      expect(decoded).not.toBeNull();
      if (name === 'valid-render-init.bin') {
        expect(decoded?.clusterIndex).toBe(0xffffffff);
        expect(decoded?.epoch).toBe(0);
      }
    }
  });
  it('rejects malformed render fragments', () => {
    for (const name of [
      'invalid-render-bad-marker.bin',
      'invalid-render-truncated.bin',
      'invalid-render-length-mismatch.bin'
    ]) {
      const data = readFileSync(join(FRAMES_DIR, name));
      const buffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
      expect(decodeRenderFrame(buffer)).toBeNull();
    }
  });
});

function generationOf(payload: Record<string, unknown> | null): string {
  if (!payload) return '';
  if (typeof payload.generationId === 'string') return payload.generationId;
  for (const key of ['delivery', 'playback', 'preparation', 'manifest', 'need', 'start']) {
    const nested = payload[key] as Record<string, unknown> | undefined;
    if (nested && typeof nested.generationId === 'string') return nested.generationId;
  }
  const command = payload.command as Record<string, unknown> | undefined;
  void command;
  return '';
}

function renderOf(payload: Record<string, unknown> | null): string {
  if (!payload) return '';
  if (typeof payload.renderId === 'string') return payload.renderId;
  for (const key of ['manifest', 'need']) {
    const nested = payload[key] as Record<string, unknown> | undefined;
    if (nested && typeof nested.renderId === 'string') return nested.renderId;
  }
  return '';
}

function validateTranscriptSteps(steps: Array<{
  from: string;
  to: string;
  channel: string;
  kind: string;
  payload: Record<string, unknown>;
}>): void {
  const announcedGenerations = new Map<string, string>();
  const announcedRenders = new Map<string, string>();
  for (const step of steps) {
    const full = { kind: step.kind, ...step.payload };
    // Every step must be a known message, a source frame, or safely ignored.
    const known = isHostMessage(full) || isClientMessage(full)
      || step.kind === 'file.begin' || step.kind === 'file.end'
      || parseSourceFileFrame(JSON.stringify(full)) !== null;
    // Transcripts only use known kinds; unknown would be a test bug.
    expect(known).toBe(true);
    const gen = generationOf(step.payload);
    const render = renderOf(step.payload);
    const scope = step.from.includes('freeplay') || step.to.includes('freeplay')
      ? `${step.from}->${step.to}`
      : 'shared';
    if (['delivery', 'playback', 'playback.prepare', 'render.manifest'].includes(step.kind)) {
      if (gen) announcedGenerations.set(gen, scope);
      if (render && gen) announcedRenders.set(render, gen);
    }
    if (['playback.ready', 'render.ready', 'playback.ended', 'source.retry', 'render.need', 'playback.start', 'clock.ping', 'clock.pong'].includes(step.kind)) {
      if (gen) {
        expect(announcedGenerations.has(gen)).toBe(true);
        const owner = announcedGenerations.get(gen);
        if (scope === 'shared') expect(owner).toBe('shared');
      }
      if (render) expect(announcedRenders.has(render)).toBe(true);
    }
  }
}

describe('multiplayer protocol transcripts', () => {
  const entries = readdirSync(TRANSCRIPTS_DIR).filter((name) => name.endsWith('.json'));
  it('has transcripts', () => {
    expect(entries.length).toBeGreaterThan(0);
  });
  for (const name of entries) {
    it(`${name} preserves ordering and generation ownership`, () => {
      const raw = readFileSync(join(TRANSCRIPTS_DIR, name), 'utf8');
      const transcript = JSON.parse(raw) as {
        steps: Array<{ from: string; to: string; channel: string; kind: string; payload: Record<string, unknown> }>;
      };
      expect(Array.isArray(transcript.steps)).toBe(true);
      expect(transcript.steps.length).toBeGreaterThan(0);
      validateTranscriptSteps(transcript.steps);
    });
  }
});
