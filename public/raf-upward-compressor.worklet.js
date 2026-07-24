const MINIMUM_LEVEL = 1e-8;
const DETECTOR_FLOOR_DB = -72;
const FLOOR_FADE_DB = 6;

class RafUpwardCompressorProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'thresholdDb', defaultValue: -36, minValue: -60, maxValue: -12, automationRate: 'k-rate' },
      { name: 'ratio', defaultValue: 1, minValue: 1, maxValue: 8, automationRate: 'k-rate' },
      { name: 'maximumBoostDb', defaultValue: 0, minValue: 0, maxValue: 24, automationRate: 'k-rate' },
      { name: 'speed', defaultValue: 0.3, minValue: 0, maxValue: 1, automationRate: 'k-rate' }
    ];
  }

  envelope = 0;

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];
    const frameCount = output[0]?.length ?? 0;
    if (frameCount === 0) return true;

    const thresholdDb = parameters.thresholdDb[0];
    const ratio = parameters.ratio[0];
    const maximumBoostDb = parameters.maximumBoostDb[0];
    const speed = parameters.speed[0];
    const attackSeconds = (30 - 27 * speed) / 1000;
    const releaseSeconds = (320 - 250 * speed) / 1000;
    const attackCoefficient = Math.exp(-1 / Math.max(attackSeconds * sampleRate, 1));
    const releaseCoefficient = Math.exp(-1 / Math.max(releaseSeconds * sampleRate, 1));

    for (let frame = 0; frame < frameCount; frame += 1) {
      let peak = 0;
      for (let channel = 0; channel < input.length; channel += 1) {
        peak = Math.max(peak, Math.abs(input[channel]?.[frame] ?? 0));
      }

      const coefficient = peak > this.envelope ? attackCoefficient : releaseCoefficient;
      this.envelope = coefficient * this.envelope + (1 - coefficient) * peak;
      const levelDb = 20 * Math.log10(Math.max(this.envelope, MINIMUM_LEVEL));
      const boostDb = calculateUpwardBoostDb(levelDb, thresholdDb, ratio, maximumBoostDb);
      const gain = 10 ** (boostDb / 20);

      for (let channel = 0; channel < output.length; channel += 1) {
        output[channel][frame] = (input[channel]?.[frame] ?? 0) * gain;
      }
    }

    return true;
  }
}

function calculateUpwardBoostDb(levelDb, thresholdDb, ratio, maximumBoostDb) {
  if (ratio <= 1 || maximumBoostDb <= 0 || levelDb >= thresholdDb || levelDb <= DETECTOR_FLOOR_DB) return 0;
  const boostDb = Math.min(maximumBoostDb, (thresholdDb - levelDb) * (1 - 1 / ratio));
  const floorFade = Math.min(1, (levelDb - DETECTOR_FLOOR_DB) / FLOOR_FADE_DB);
  return boostDb * floorFade;
}

registerProcessor('raf-upward-compressor', RafUpwardCompressorProcessor);
