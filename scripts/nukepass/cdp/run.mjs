#!/usr/bin/env node
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { release as osRelease, type as osType } from 'node:os';
import { basename, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { launchBrowser } from './browser-launcher.mjs';
import {
  assertBuildProvenance,
  assertScenarioEntrypoints,
  readScenarioCatalog
} from './catalog.mjs';
import { CdpConnection } from './protocol-client.mjs';
import { startStaticServer } from './static-server.mjs';

const execFileAsync = promisify(execFile);
const DEFAULT_BROWSER_TIMEOUT_MS = 20_000;
const HARNESS_DIRECTORY = resolve(fileURLToPath(new URL('.', import.meta.url)));

function parseArguments(argv) {
  const options = {
    browser: process.env.IZCI_CDP_BROWSER ?? '',
    dist: 'dist',
    out: `artifacts/cdp/${new Date().toISOString().replaceAll(':', '-')}`,
    profiles: 1,
    windowsPerProfile: 1,
    retainProfiles: false,
    retainProfilesOnFailure: false,
    timeoutMs: DEFAULT_BROWSER_TIMEOUT_MS,
    seed: randomUUID()
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const value = argv[index + 1];
    if (argument === '--browser') options.browser = value, index += 1;
    else if (argument === '--dist') options.dist = value, index += 1;
    else if (argument === '--out') options.out = value, index += 1;
    else if (argument === '--profiles') options.profiles = Number.parseInt(value, 10), index += 1;
    else if (argument === '--windows-per-profile') options.windowsPerProfile = Number.parseInt(value, 10), index += 1;
    else if (argument === '--timeout-ms') options.timeoutMs = Number.parseInt(value, 10), index += 1;
    else if (argument === '--seed') options.seed = value, index += 1;
    else if (argument === '--retain-profiles') options.retainProfiles = true;
    else if (argument === '--retain-profiles-on-failure') options.retainProfilesOnFailure = true;
    else if (argument === '--help') options.help = true;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  if (options.help) return options;
  if (!options.browser) throw new Error('Pass --browser <Chromium executable> or set IZCI_CDP_BROWSER.');
  if (!Number.isInteger(options.profiles) || options.profiles < 1 || options.profiles > 3) {
    throw new Error('--profiles must be an integer from 1 to 3.');
  }
  if (!Number.isInteger(options.windowsPerProfile)
    || options.windowsPerProfile < 1
    || options.windowsPerProfile > 3) {
    throw new Error('--windows-per-profile must be an integer from 1 to 3.');
  }
  if (!Number.isInteger(options.timeoutMs) || options.timeoutMs < 1_000) {
    throw new Error('--timeout-ms must be at least 1000.');
  }
  return options;
}

function printHelp() {
  console.log(`Usage: node scripts/nukepass/cdp/run.mjs --browser <path> [options]

Options:
  --dist <path>                 Built site directory (default: dist)
  --out <path>                  Report bundle directory (default: artifacts/cdp/<time>)
  --profiles <1..3>             Isolated browser profiles (default: 1)
  --windows-per-profile <1..3>  Concurrent same-profile targets (default: 1)
  --timeout-ms <ms>             CDP command/readiness timeout (default: 20000)
  --seed <value>                Scenario seed recorded in the report
  --retain-profiles             Keep all temporary browser profiles
  --retain-profiles-on-failure  Keep profiles only when the run fails
  --help                        Show this help`);
}

async function listFiles(root) {
  const files = [];
  async function visit(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) files.push(path);
    }
  }
  await visit(root);
  return files;
}

async function describeBuild(distDirectory) {
  const files = await listFiles(distDirectory);
  const digest = createHash('sha256');
  const manifest = [];
  for (const file of files) {
    const contents = await readFile(file);
    const path = relative(distDirectory, file).replaceAll('\\', '/');
    const sha256 = createHash('sha256').update(contents).digest('hex');
    digest.update(`${path}\0${contents.length}\0${sha256}\n`);
    manifest.push({ path, bytes: contents.length, sha256 });
  }
  return { id: digest.digest('hex'), files: manifest };
}

async function readBuildProvenance(distDirectory) {
  return JSON.parse(await readFile(resolve(distDirectory, 'nukepass-build.json'), 'utf8'));
}

async function readCommit() {
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD']);
    return stdout.trim();
  } catch {
    return null;
  }
}

async function readRepositoryIdentity() {
  const [packageSource, protocolSource, fixtureManifestSource] = await Promise.all([
    readFile(resolve('package.json'), 'utf8'),
    readFile(resolve('src/lib/services/multiplayer-protocol.ts'), 'utf8'),
    readFile(resolve('fixtures/manifest.json'))
  ]);
  const protocolMatch = protocolSource.match(/export const MULTIPLAYER_PROTOCOL_VERSION\s*=\s*(\d+)\s*;/);
  if (!protocolMatch) throw new Error('Could not read MULTIPLAYER_PROTOCOL_VERSION.');
  return {
    appVersion: JSON.parse(packageSource).version,
    protocolVersion: Number.parseInt(protocolMatch[1], 10),
    fixtureManifestSha256: createHash('sha256').update(fixtureManifestSource).digest('hex')
  };
}

function serializeRemoteArgument(argument) {
  if (Object.hasOwn(argument, 'value')) return argument.value;
  return argument.unserializableValue ?? argument.description ?? argument.type;
}

async function evaluate(connection, sessionId, expression) {
  const result = await connection.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
    userGesture: false
  }, sessionId);
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description
      ?? result.exceptionDetails.text
      ?? 'Runtime evaluation failed');
  }
  return result.result?.value;
}

function readinessExpression(expectedReady) {
  return `new Promise((resolve, reject) => {
  const deadline = setTimeout(() => {
    observer.disconnect();
    reject(new Error('Timed out waiting for the application root'));
  }, 15000);
  const ready = () => document.readyState === 'complete'
    && document.documentElement.dataset.izciReady === ${JSON.stringify(expectedReady)}
    && document.querySelector('#app')?.childElementCount > 0;
  const finish = () => requestAnimationFrame(() => {
    clearTimeout(deadline);
    observer.disconnect();
    resolve({
      title: document.title,
      url: location.href,
      rootChildren: document.querySelector('#app')?.childElementCount ?? 0,
      bodyTextLength: document.body?.innerText?.length ?? 0
    });
  });
  const observer = new MutationObserver(() => { if (ready()) finish(); });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  if (ready()) finish();
})`;
}

function browserStateExpression(expectedServiceWorkerSha256) {
  return `(async () => {
  const registration = navigator.serviceWorker
    ? await Promise.race([
        navigator.serviceWorker.ready,
        new Promise((_, reject) => setTimeout(
          () => reject(new Error('Timed out waiting for the active service worker')),
          15000
        ))
      ])
    : null;
  const serviceWorkerResponse = await fetch('/sw.js', { cache: 'no-store' });
  if (!serviceWorkerResponse.ok) {
    throw new Error('Could not fetch the active build service worker: ' + serviceWorkerResponse.status);
  }
  const digest = Array.from(new Uint8Array(await crypto.subtle.digest(
    'SHA-256',
    await serviceWorkerResponse.arrayBuffer()
  ))).map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return {
    serviceWorker: registration ? {
      scope: registration.scope,
      active: registration.active?.scriptURL ?? null,
      waiting: registration.waiting?.scriptURL ?? null,
      installing: registration.installing?.scriptURL ?? null,
      controller: navigator.serviceWorker.controller?.scriptURL ?? null,
      sha256: digest,
      expectedSha256: ${JSON.stringify(expectedServiceWorkerSha256)}
    } : null,
    diagnostics: globalThis.__IZCI_DIAGNOSTICS__ ?? null,
    localStorageKeys: Object.keys(localStorage).sort(),
    sessionStorageKeys: Object.keys(sessionStorage).sort()
  };
})()`;
}

async function readProtocolStream(connection, handle) {
  const chunks = [];
  while (true) {
    const result = await connection.send('IO.read', { handle, size: 256 * 1024 });
    chunks.push(result.base64Encoded
      ? Buffer.from(result.data, 'base64')
      : Buffer.from(result.data, 'utf8'));
    if (result.eof) break;
  }
  await connection.send('IO.close', { handle });
  return Buffer.concat(chunks);
}

function scenarioFailures(scenario) {
  const failures = [];
  if (scenario.runtimeExceptions.length > 0) failures.push('runtime exception');
  if (scenario.console.some((entry) => entry.type === 'error')) failures.push('console error');
  if (scenario.log.some((entry) => entry.level === 'error')) failures.push('browser log error');
  if (scenario.networkFailures.length > 0) failures.push('network load failure');
  if (scenario.network.some((entry) => entry.status >= 400)) failures.push('HTTP error response');
  if (scenario.unexpectedNavigations.length > 0) failures.push('unexpected navigation');
  if (scenario.detached) failures.push('CDP target detached');
  if (!scenario.browserState?.serviceWorker?.active) failures.push('service worker did not activate');
  if (scenario.browserState?.serviceWorker?.waiting
    || scenario.browserState?.serviceWorker?.installing) failures.push('service worker did not settle');
  if (scenario.browserState?.serviceWorker?.sha256
    !== scenario.browserState?.serviceWorker?.expectedSha256) failures.push('stale service worker bytes');
  return failures;
}

async function runEntrypoint({
  connection,
  entrypoint,
  profile,
  baseUrl,
  outputDirectory,
  timeoutMs,
  expectedServiceWorkerSha256
}) {
  const expectedUrl = new URL(entrypoint.path, baseUrl).href;
  const { targetId } = await connection.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await connection.send('Target.attachToTarget', { targetId, flatten: true });
  const scenario = {
    id: entrypoint.id,
    profileId: profile.profileId,
    expectedUrl,
    status: 'running',
    console: [],
    log: [],
    runtimeExceptions: [],
    network: [],
    networkFailures: [],
    unexpectedNavigations: [],
    detached: false
  };
  const disposers = [];

  disposers.push(connection.on('Runtime.consoleAPICalled', (event) => {
    scenario.console.push({
      type: event.type,
      timestamp: event.timestamp,
      args: event.args.map(serializeRemoteArgument),
      stackTrace: event.stackTrace ?? null
    });
  }, sessionId));
  disposers.push(connection.on('Runtime.exceptionThrown', (event) => {
    scenario.runtimeExceptions.push(event.exceptionDetails);
  }, sessionId));
  disposers.push(connection.on('Log.entryAdded', (event) => scenario.log.push(event.entry), sessionId));
  disposers.push(connection.on('Network.responseReceived', (event) => {
    scenario.network.push({
      requestId: event.requestId,
      url: event.response.url,
      status: event.response.status,
      mimeType: event.response.mimeType,
      fromDiskCache: event.response.fromDiskCache,
      fromServiceWorker: event.response.fromServiceWorker
    });
  }, sessionId));
  disposers.push(connection.on('Network.loadingFailed', (event) => {
    if (!event.canceled) scenario.networkFailures.push(event);
  }, sessionId));
  disposers.push(connection.on('Page.frameNavigated', (event) => {
    if (!event.frame.parentId && event.frame.url !== 'about:blank' && event.frame.url !== expectedUrl) {
      scenario.unexpectedNavigations.push(event.frame.url);
    }
  }, sessionId));
  disposers.push(connection.on('Inspector.detached', () => { scenario.detached = true; }, sessionId));

  try {
    await Promise.all([
      connection.send('Page.enable', {}, sessionId),
      connection.send('Runtime.enable', {}, sessionId),
      connection.send('Log.enable', {}, sessionId),
      connection.send('Network.enable', {}, sessionId),
      connection.send('Performance.enable', {}, sessionId),
      connection.send('Inspector.enable', {}, sessionId)
    ]);

    const loaded = connection.waitFor('Page.loadEventFired', { sessionId, timeoutMs });
    const navigation = await connection.send('Page.navigate', { url: expectedUrl }, sessionId);
    if (navigation.errorText) throw new Error(`Navigation failed: ${navigation.errorText}`);
    await loaded;
    scenario.readiness = await evaluate(
      connection,
      sessionId,
      readinessExpression(entrypoint.ready)
    );
    if (scenario.readiness.url !== expectedUrl) {
      throw new Error(`Unexpected final URL ${scenario.readiness.url}; expected ${expectedUrl}`);
    }

    const screenshot = await connection.send('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: false,
      fromSurface: true
    }, sessionId);
    await writeFile(resolve(outputDirectory, `${entrypoint.id}.png`), screenshot.data, 'base64');

    const domSnapshot = await connection.send('DOMSnapshot.captureSnapshot', {
      computedStyles: [],
      includePaintOrder: true,
      includeDOMRects: true
    }, sessionId);
    await writeFile(
      resolve(outputDirectory, `${entrypoint.id}.dom.json`),
      `${JSON.stringify(domSnapshot)}\n`
    );

    const [{ metrics }, heapUsage, browserState] = await Promise.all([
      connection.send('Performance.getMetrics', {}, sessionId),
      connection.send('Runtime.getHeapUsage', {}, sessionId),
      evaluate(connection, sessionId, browserStateExpression(expectedServiceWorkerSha256))
    ]);
    scenario.metrics = Object.fromEntries(metrics.map((metric) => [metric.name, metric.value]));
    scenario.heapUsage = heapUsage;
    scenario.domCounters = await connection.send('Memory.getDOMCounters', {}, sessionId);
    scenario.browserState = browserState;
    scenario.failures = scenarioFailures(scenario);
    scenario.status = scenario.failures.length === 0 ? 'passed' : 'failed';
  } catch (error) {
    scenario.status = 'failed';
    scenario.failures = [...scenarioFailures(scenario), error.message];
  } finally {
    for (const dispose of disposers) dispose();
    try {
      await connection.send('Target.closeTarget', { targetId });
    } catch (error) {
      scenario.failures ??= [];
      scenario.failures.push(`Failed to close target: ${error.message}`);
      scenario.status = 'failed';
    }
  }

  await writeFile(
    resolve(outputDirectory, `${entrypoint.id}.json`),
    `${JSON.stringify(scenario, null, 2)}\n`
  );
  return scenario;
}

async function captureHeapSnapshot(connection, sessionId, destination) {
  const chunks = [];
  const dispose = connection.on('HeapProfiler.addHeapSnapshotChunk', ({ chunk }) => {
    chunks.push(chunk);
  }, sessionId);
  try {
    await connection.send('HeapProfiler.enable', {}, sessionId);
    await connection.send('HeapProfiler.takeHeapSnapshot', {
      reportProgress: false,
      captureNumericValue: true
    }, sessionId);
    if (chunks.length === 0) throw new Error('Heap snapshot completed without chunks');
    await writeFile(destination, chunks.join(''));
  } finally {
    dispose();
    await connection.send('HeapProfiler.disable', {}, sessionId).catch(() => {});
  }
}

async function runProfile({
  profile,
  entries,
  baseUrl,
  outputDirectory,
  timeoutMs,
  windowsPerProfile,
  expectedServiceWorkerSha256
}) {
  const connection = await CdpConnection.connect(profile.webSocketUrl, {
    connectTimeoutMs: timeoutMs,
    commandTimeoutMs: timeoutMs
  });
  const profileDirectory = resolve(outputDirectory, profile.profileId);
  await mkdir(profileDirectory, { recursive: true });
  const browserVersion = await connection.send('Browser.getVersion');
  const { targetId: keeperTargetId } = await connection.send('Target.createTarget', {
    url: 'about:blank',
    background: true
  });
  const { sessionId: keeperSessionId } = await connection.send('Target.attachToTarget', {
    targetId: keeperTargetId,
    flatten: true
  });
  await connection.send('Runtime.enable', {}, keeperSessionId);
  const targetEvents = [];
  const disposeTargetEvents = connection.onAny((message) => {
    if (message.method === 'Target.targetCrashed') targetEvents.push(message);
  });
  await connection.send('Target.setDiscoverTargets', { discover: true });
  await connection.send('Tracing.start', {
    categories: '-*,devtools.timeline,blink.user_timing,loading',
    transferMode: 'ReturnAsStream'
  });

  const scenarios = [];
  let traceFailure = null;
  let heapSnapshotFailure = null;
  let processInfo = null;
  try {
    for (let index = 0; index < entries.length; index += windowsPerProfile) {
      const batch = await Promise.all(entries.slice(index, index + windowsPerProfile).map(
        (entrypoint) => runEntrypoint({
          connection,
          entrypoint,
          profile,
          baseUrl,
          outputDirectory: profileDirectory,
          timeoutMs,
          expectedServiceWorkerSha256
        })
      ));
      scenarios.push(...batch);
    }
    try {
      await captureHeapSnapshot(
        connection,
        keeperSessionId,
        resolve(profileDirectory, 'heap.heapsnapshot')
      );
    } catch (error) {
      heapSnapshotFailure = error.message;
    }
    processInfo = await connection.send('SystemInfo.getProcessInfo').catch(() => null);
  } finally {
    try {
      const completed = connection.waitFor('Tracing.tracingComplete', { timeoutMs });
      await connection.send('Tracing.end');
      const { stream } = await completed;
      if (!stream) throw new Error('Tracing completed without a stream');
      await writeFile(resolve(profileDirectory, 'trace.json'), await readProtocolStream(connection, stream));
    } catch (error) {
      traceFailure = error.message;
    }
    try {
      await connection.send('Target.closeTarget', { targetId: keeperTargetId });
    } catch {
      // The profile cleanup below still owns the browser lifetime.
    }
    disposeTargetEvents();
    connection.close();
  }

  return {
    profileId: profile.profileId,
    port: profile.port,
    flags: profile.flags,
    browserVersion,
    targetEvents,
    traceFailure,
    heapSnapshotFailure,
    processInfo,
    processLogs: profile.getProcessLogs(),
    scenarios
  };
}

function renderSummary(report) {
  const lines = [
    `izci Stage 1 CDP characterization: ${report.status.toUpperCase()}`,
    `commit: ${report.commit ?? 'unknown'}`,
    `build: ${report.build.id}`,
    `seed: ${report.seed}`,
    `profiles: ${report.profiles.length}`,
    ''
  ];
  for (const profile of report.profiles) {
    lines.push(`${profile.profileId}: ${profile.browserVersion.product}`);
    if (profile.traceFailure) lines.push(`  trace: FAILED (${profile.traceFailure})`);
    if (profile.heapSnapshotFailure) lines.push(`  heap: FAILED (${profile.heapSnapshotFailure})`);
    for (const scenario of profile.scenarios) {
      const detail = scenario.failures?.length ? ` — ${scenario.failures.join('; ')}` : '';
      lines.push(`  ${scenario.status === 'passed' ? 'PASS' : 'FAIL'} ${scenario.id}${detail}`);
    }
  }
  return `${lines.join('\n')}\n`;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) return printHelp();

  const distDirectory = resolve(options.dist);
  const outputDirectory = resolve(options.out);
  const browserExecutable = resolve(options.browser);
  const browserDetails = await stat(browserExecutable);
  if (!browserDetails.isFile()) throw new Error(`Browser is not a file: ${browserExecutable}`);
  await mkdir(outputDirectory, { recursive: true });

  const startedAt = new Date().toISOString();
  const [build, buildProvenance, commit, repository, scenarioCatalog] = await Promise.all([
    describeBuild(distDirectory),
    readBuildProvenance(distDirectory),
    readCommit(),
    readRepositoryIdentity(),
    readScenarioCatalog(resolve(HARNESS_DIRECTORY, 'scenarios.json'))
  ]);
  assertScenarioEntrypoints(scenarioCatalog, build);
  assertBuildProvenance(buildProvenance, commit);
  const server = await startStaticServer(distDirectory);
  const serviceWorkerAsset = build.files.find((file) => file.path === 'sw.js');
  if (!serviceWorkerAsset) throw new Error('The production build does not contain sw.js.');
  const profiles = [];
  let report;
  try {
    for (let index = 0; index < options.profiles; index += 1) {
      profiles.push(await launchBrowser({
        executable: browserExecutable,
        profileId: `profile-${index + 1}`,
        retainProfileOnFailure: options.retainProfilesOnFailure
      }));
    }

    const groups = profiles.map(() => []);
    scenarioCatalog.scenarios.forEach((entrypoint, index) => {
      groups[index % groups.length].push(entrypoint);
    });
    const profileReports = await Promise.all(profiles.map((profile, index) => runProfile({
      profile,
      entries: groups[index],
      baseUrl: server.baseUrl,
      outputDirectory,
      timeoutMs: options.timeoutMs,
      windowsPerProfile: options.windowsPerProfile,
      expectedServiceWorkerSha256: serviceWorkerAsset.sha256
    })));
    const failed = profileReports.some((profile) => profile.traceFailure
      || profile.heapSnapshotFailure
      || profile.targetEvents.length > 0
      || profile.scenarios.some((scenario) => scenario.status !== 'passed'));
    report = {
      schemaVersion: 1,
      status: failed ? 'failed' : 'passed',
      startedAt,
      commit,
      appVersion: repository.appVersion,
      build,
      buildProvenance,
      fixtureSet: {
        ...scenarioCatalog.fixtureSet,
        manifestSha256: repository.fixtureManifestSha256
      },
      scenarioCatalog,
      seed: options.seed,
      os: {
        platform: process.platform,
        architecture: process.arch,
        type: osType(),
        release: osRelease()
      },
      node: process.version,
      browserExecutable,
      server: { baseUrl: server.baseUrl, port: server.port },
      protocolVersion: repository.protocolVersion,
      windowsPerProfile: options.windowsPerProfile,
      profiles: profileReports
    };
  } finally {
    const failed = report?.status === 'failed';
    await Promise.all(profiles.map((profile) => profile.close({
      retainProfile: options.retainProfiles || (failed && options.retainProfilesOnFailure)
    })));
    await server.close();
  }

  const summary = renderSummary(report);
  await writeFile(resolve(outputDirectory, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(resolve(outputDirectory, 'summary.txt'), summary);
  console.log(summary.trimEnd());
  if (report.status !== 'passed') process.exitCode = 1;
}

main().catch((error) => {
  console.error(error.stack ?? error.message);
  if (error.processLogs) console.error(error.processLogs);
  process.exitCode = 1;
});
