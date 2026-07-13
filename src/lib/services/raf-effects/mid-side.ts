import type { RafMidSideSettings } from '$lib/types';
import { decibelsToGain, disconnectNode, setAudioParam, type RafEffectNode } from './shared';

const MATRIX_GAIN = Math.SQRT1_2;

export interface MidSideNode extends RafEffectNode {
  nodes: AudioNode[];
  midGain: GainNode;
  sideGain: GainNode;
}

function matrixGain(context: BaseAudioContext, gain: number): GainNode {
  const node = context.createGain();
  node.gain.value = gain;
  return node;
}

export function createMidSideNode(context: BaseAudioContext, settings: RafMidSideSettings): MidSideNode {
  const input = context.createGain();
  const splitter = context.createChannelSplitter(2);
  const midBus = context.createGain();
  const sideBus = context.createGain();
  const leftToMid = matrixGain(context, MATRIX_GAIN);
  const rightToMid = matrixGain(context, MATRIX_GAIN);
  const leftToSide = matrixGain(context, MATRIX_GAIN);
  const rightToSide = matrixGain(context, -MATRIX_GAIN);
  const midGain = matrixGain(context, decibelsToGain(settings.midGainDb));
  const sideGain = matrixGain(context, decibelsToGain(settings.sideGainDb));
  const midToLeft = matrixGain(context, MATRIX_GAIN);
  const midToRight = matrixGain(context, MATRIX_GAIN);
  const sideToLeft = matrixGain(context, MATRIX_GAIN);
  const sideToRight = matrixGain(context, -MATRIX_GAIN);
  const merger = context.createChannelMerger(2);
  const output = context.createGain();

  input.connect(splitter);
  splitter.connect(leftToMid, 0);
  splitter.connect(leftToSide, 0);
  splitter.connect(rightToMid, 1);
  splitter.connect(rightToSide, 1);
  leftToMid.connect(midBus);
  rightToMid.connect(midBus);
  leftToSide.connect(sideBus);
  rightToSide.connect(sideBus);
  midBus.connect(midGain);
  sideBus.connect(sideGain);
  midGain.connect(midToLeft);
  midGain.connect(midToRight);
  sideGain.connect(sideToLeft);
  sideGain.connect(sideToRight);
  midToLeft.connect(merger, 0, 0);
  sideToLeft.connect(merger, 0, 0);
  midToRight.connect(merger, 0, 1);
  sideToRight.connect(merger, 0, 1);
  merger.connect(output);

  return {
    input,
    output,
    midGain,
    sideGain,
    nodes: [
      input, splitter, midBus, sideBus, leftToMid, rightToMid, leftToSide, rightToSide,
      midGain, sideGain, midToLeft, midToRight, sideToLeft, sideToRight, merger, output
    ]
  };
}

export function updateMidSideNode(
  node: MidSideNode,
  settings: RafMidSideSettings,
  context: BaseAudioContext
): void {
  setAudioParam(node.midGain.gain, decibelsToGain(settings.midGainDb), context);
  setAudioParam(node.sideGain.gain, decibelsToGain(settings.sideGainDb), context);
}

export function disposeMidSideNode(node: MidSideNode): void {
  node.nodes.forEach(disconnectNode);
}
