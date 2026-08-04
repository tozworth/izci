const OPUS_STREAM_PARAMETERS = [
  'stereo=1',
  'sprop-stereo=1',
  'useinbandfec=1',
  'usedtx=0',
  'cbr=0'
] as const;
const REPLACED_OPUS_PARAMETERS = new Set(
  OPUS_STREAM_PARAMETERS.map((parameter) => parameter.split('=', 1)[0])
);

export function enableOpusStereo(
  description: RTCSessionDescriptionInit
): RTCSessionDescriptionInit {
  if (!description.sdp) return description;

  const newline = description.sdp.includes('\r\n') ? '\r\n' : '\n';
  const lines = description.sdp.split(/\r\n|\n/);
  const opusPayloadTypes = new Set<string>();

  for (const line of lines) {
    const match = /^a=rtpmap:(\d+)\s+opus\/48000\/2(?:\s|$)/i.exec(line);
    if (match) opusPayloadTypes.add(match[1]);
  }

  if (opusPayloadTypes.size === 0) return description;

  const payloadTypesWithFmtp = new Set<string>();
  const stereoLines = lines.map((line) => {
    const match = /^a=fmtp:(\d+)\s+(.+)$/i.exec(line);
    if (!match || !opusPayloadTypes.has(match[1])) return line;

    payloadTypesWithFmtp.add(match[1]);
    const parameters = match[2]
      .split(';')
      .map((parameter) => parameter.trim())
      .filter((parameter) => {
        const name = parameter.split('=', 1)[0].toLowerCase();
        return !REPLACED_OPUS_PARAMETERS.has(name);
      });
    parameters.push(...OPUS_STREAM_PARAMETERS);
    return `a=fmtp:${match[1]} ${parameters.join(';')}`;
  });

  for (const payloadType of opusPayloadTypes) {
    if (payloadTypesWithFmtp.has(payloadType)) continue;
    const rtpmapIndex = stereoLines.findIndex((line) => new RegExp(
      `^a=rtpmap:${payloadType}\\s+opus\\/48000\\/2(?:\\s|$)`,
      'i'
    ).test(line));
    stereoLines.splice(
      rtpmapIndex + 1,
      0,
      `a=fmtp:${payloadType} ${OPUS_STREAM_PARAMETERS.join(';')}`
    );
  }

  return { ...description, sdp: stereoLines.join(newline) };
}
