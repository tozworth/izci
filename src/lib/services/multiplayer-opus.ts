const OPUS_STEREO_PARAMETERS = ['stereo=1', 'sprop-stereo=1'] as const;

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
        return name !== 'stereo' && name !== 'sprop-stereo';
      });
    parameters.push(...OPUS_STEREO_PARAMETERS);
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
      `a=fmtp:${payloadType} ${OPUS_STEREO_PARAMETERS.join(';')}`
    );
  }

  return { ...description, sdp: stereoLines.join(newline) };
}
