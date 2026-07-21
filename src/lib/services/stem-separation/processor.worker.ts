/// <reference lib="webworker" />
/// <reference types="@webgpu/types" />

import * as ort from 'onnxruntime-web/webgpu';
import {
  STEM_CHUNK_SAMPLES,
  STEM_FREQUENCIES,
  calculatePeakTable,
  createHannWindow,
  encodeStereoWav,
  prepareModelInput,
  reconstructVocals
} from './dsp';
import { requestHighPerformanceStemGpu, toStemGpuAdapterInfo } from './gpu-adapter';
import type { StemWorkerRequest, StemWorkerResponse } from './processor-protocol';
import type { StemGpuAdapterInfo } from './types';

const scope = self as DedicatedWorkerGlobalScope;
const framesPerChunk = Math.floor((STEM_CHUNK_SAMPLES - 2048) / 512) + 1;

function publish(message: StemWorkerResponse, transfer: Transferable[] = []): void {
  scope.postMessage(message, transfer);
}

interface StemSession {
  session: ort.InferenceSession;
  adapterInfo: StemGpuAdapterInfo;
}

async function createSession(model: ArrayBuffer, validateOutput = true): Promise<StemSession> {
  const selected = await requestHighPerformanceStemGpu(navigator.gpu);
  publish({ type: 'adapter', adapterInfo: selected.info });
  console.info('[izci] Stem inference WebGPU adapter:', JSON.stringify(selected.info));
  ort.env.webgpu.powerPreference = 'high-performance';
  ort.env.webgpu.forceFallbackAdapter = false;
  ort.env.webgpu.adapter = selected.adapter;
  const session = await ort.InferenceSession.create(new Uint8Array(model), {
    executionProviders: ['webgpu'],
    graphOptimizationLevel: 'all',
    freeDimensionOverrides: { batch: 1, time_frames: framesPerChunk }
  });
  const actualDevice = await ort.env.webgpu.device;
  const adapterInfo = toStemGpuAdapterInfo(actualDevice.adapterInfo, actualDevice.limits);
  if (!validateOutput) return { session, adapterInfo };
  let input: ort.Tensor | null = null;
  try {
    input = new ort.Tensor(
      'float32',
      new Float32Array(framesPerChunk * STEM_FREQUENCIES * 4),
      [1, framesPerChunk, STEM_FREQUENCIES * 4]
    );
    const output = await session.run({ stft_features: input });
    if (!output.mask || output.mask.size !== 1 * 1 * STEM_FREQUENCIES * 2 * framesPerChunk * 2) {
      throw new Error('The stem model returned an unexpected output shape.');
    }
    const mask = output.mask.data as Float32Array;
    for (let index = 0; index < mask.length; index += 1) {
      if (!Number.isFinite(mask[index])) throw new Error('The stem model produced non-finite output.');
    }
    output.mask.dispose();
    return { session, adapterInfo };
  } catch (error) {
    await session.release();
    throw error;
  } finally {
    input?.dispose();
  }
}

async function validate(model: ArrayBuffer): Promise<void> {
  const { session, adapterInfo } = await createSession(model);
  await session.release();
  publish({ type: 'validated', adapterInfo });
}

async function processAudio(request: Extract<StemWorkerRequest, { type: 'process' }>): Promise<void> {
  const { session, adapterInfo } = await createSession(request.model, false);
  const originalLeft = new Float32Array(request.left);
  const originalRight = new Float32Array(request.right);
  const vocalLeft = new Float32Array(request.totalSamples);
  const vocalRight = new Float32Array(request.totalSamples);
  const counts = new Float32Array(request.totalSamples);
  const window = createHannWindow(2048);
  const step = Math.floor(STEM_CHUNK_SAMPLES / 2);
  const starts: number[] = [];
  for (let start = 0; start < request.totalSamples; start += step) starts.push(start);

  try {
    for (let chunkIndex = 0; chunkIndex < starts.length; chunkIndex += 1) {
      const start = starts[chunkIndex];
      const end = Math.min(start + STEM_CHUNK_SAMPLES, request.totalSamples);
      const chunkLength = end - start;
      const left = new Float32Array(STEM_CHUNK_SAMPLES);
      const right = new Float32Array(STEM_CHUNK_SAMPLES);
      left.set(originalLeft.subarray(start, end));
      right.set(originalRight.subarray(start, end));
      const prepared = prepareModelInput(left, right, window);
      const tensor = new ort.Tensor('float32', prepared.input, [1, prepared.frames, STEM_FREQUENCIES * 4]);
      const output = await session.run({ stft_features: tensor });
      const mask = output.mask.data as Float32Array;
      const vocals = reconstructVocals(
        mask,
        prepared.leftStft,
        prepared.rightStft,
        window,
        STEM_CHUNK_SAMPLES
      );
      tensor.dispose();
      output.mask.dispose();
      for (let index = 0; index < chunkLength; index += 1) {
        vocalLeft[start + index] += vocals.left[index];
        vocalRight[start + index] += vocals.right[index];
        counts[start + index] += 1;
      }
      publish({ type: 'progress', progress: (chunkIndex + 1) / starts.length });
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    for (let index = 0; index < request.totalSamples; index += 1) {
      if (counts[index] > 0) {
        vocalLeft[index] /= counts[index];
        vocalRight[index] /= counts[index];
      }
    }
    const peakTable = calculatePeakTable(originalLeft, originalRight, vocalLeft, vocalRight);
    const wav = encodeStereoWav(vocalLeft, vocalRight);
    publish({ type: 'complete', wav, peakTable, frameCount: request.totalSamples, adapterInfo }, [wav]);
  } finally {
    await session.release();
  }
}

scope.addEventListener('message', (event: MessageEvent<StemWorkerRequest>) => {
  const task = event.data.type === 'validate' ? validate(event.data.model) : processAudio(event.data);
  void task.catch((error) => {
    publish({ type: 'error', message: error instanceof Error ? error.message : String(error) });
  });
});
