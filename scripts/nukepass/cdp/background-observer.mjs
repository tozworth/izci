export const OBSERVED_BACKGROUND_TARGET_TYPES = Object.freeze([
  'service_worker',
  'worker',
  'shared_worker',
  'worklet'
]);

export function isBackgroundTargetType(type) {
  return OBSERVED_BACKGROUND_TARGET_TYPES.includes(type);
}

export function isOwnedBackgroundTarget(targetInfo, baseUrl) {
  return isBackgroundTargetType(targetInfo.type)
    && (targetInfo.url.startsWith(baseUrl) || targetInfo.url.startsWith(`blob:${baseUrl}`));
}

export async function enableBackgroundObservation({
  connection,
  event,
  target,
  serializeArgument
}) {
  connection.on('Runtime.consoleAPICalled', (runtimeEvent) => {
    target.console.push({
      type: runtimeEvent.type,
      timestamp: runtimeEvent.timestamp,
      args: runtimeEvent.args.map(serializeArgument),
      stackTrace: runtimeEvent.stackTrace ?? null
    });
  }, event.sessionId);
  connection.on('Runtime.exceptionThrown', (runtimeEvent) => {
    target.runtimeExceptions.push(runtimeEvent.exceptionDetails);
  }, event.sessionId);
  connection.on('Log.entryAdded', (runtimeEvent) => target.log.push(runtimeEvent.entry), event.sessionId);

  try {
    await Promise.all([
      connection.send('Runtime.enable', {}, event.sessionId),
      connection.send('Log.enable', {}, event.sessionId)
    ]);
  } catch (error) {
    target.setupFailure = error.message;
  } finally {
    try {
      await connection.send('Runtime.runIfWaitingForDebugger', {}, event.sessionId);
    } catch (error) {
      target.setupFailure ??= error.message;
    }
  }
}
