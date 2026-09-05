export interface ReceivedByteSample {
  timestamp: number;
  bytesReceived: number;
}

interface ReceivedBitrateWindow {
  samples: ReceivedByteSample[];
  averageKbps: number | null;
}

export function updateReceivedBitrateWindow(
  previous: ReceivedByteSample[],
  sample: ReceivedByteSample,
  windowMs = 5_000
): ReceivedBitrateWindow {
  const latest = previous.at(-1);
  const samples = !latest
    || sample.timestamp <= latest.timestamp
    || sample.bytesReceived < latest.bytesReceived
    ? [sample]
    : [...previous, sample].filter(
        (candidate) => candidate.timestamp >= sample.timestamp - windowMs
      );
  const first = samples[0];
  const elapsedMs = sample.timestamp - first.timestamp;
  const averageKbps = elapsedMs > 0
    ? Math.round(((sample.bytesReceived - first.bytesReceived) * 8) / elapsedMs)
    : null;

  return { samples, averageKbps };
}
