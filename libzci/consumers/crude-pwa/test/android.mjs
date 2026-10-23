import { _android } from 'playwright';
import { createServer } from 'vite';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { assertDevice, device as adb, serial, avd } from '../../../../scripts/android/tools.mjs';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const media = path.join(root, '.local/libzci/media/m1');
const input = name => path.join(root, '.local/libzci/media', name.endsWith('.opus') ? ['gain.opus', 'chain.opus'].includes(name) ? 'r4' : 'r3' : 'm1', name);
const cli = process.env.ZCI_PLAY ?? path.join(root, 'libzci/target/debug', process.platform === 'win32' ? 'zci-play.exe' : 'zci-play');
assert(assertDevice(), 'Start the dedicated headless emulator with npm run android:emulator -- start');
const devices = await _android.devices();
const device = devices.find(candidate => candidate.serial() === serial);
assert(device, `Playwright cannot connect to ${serial}`);
const server = await createServer({ root: path.join(root, 'libzci/consumers/crude-pwa'), server: { host: '127.0.0.1', port: 5197, strictPort: true } });
let context;
const results = [];
try {
  await server.listen();
  adb(['reverse', 'tcp:5197', 'tcp:5197']);
  context = await device.launchBrowser({ args: ['--mute-audio'] });
  const page = await context.newPage();
  page.setDefaultTimeout(60000);
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  await page.goto('http://localhost:5197');
  const environment = await page.evaluate(() => ({ userAgent: navigator.userAgent, audioWorklet: 'AudioWorkletNode' in window, secure: isSecureContext }));
  assert(environment.secure && environment.audioWorklet);
  const snapshot = () => page.evaluate(() => window.libzci.snapshot());
  const command = async (kind, value = 0) => {
    const revision = (await snapshot()).snapshot.revision;
    await page.evaluate(([kind, value]) => window.libzci.command(kind, value), [kind, value]);
    await page.waitForFunction(revision => window.libzci.snapshot()?.snapshot.revision > revision && !window.libzci.snapshot()?.snapshot.pending_operation, revision);
    assert.equal((await snapshot()).snapshot.error, null);
  };
  const names = ['mono.opus', 'stereo.opus', 'gain.opus', 'chain.opus', '44100-1.wav', '44100-1.mp3', '44100-1.flac', '44100-1.ogg', '48000-2.wav', '48000-2.mp3', '48000-2.flac', '48000-2.ogg', 'tone.mod', 'tone.xm', 'tone.s3m', 'tone.it', 'tone.mo3', 'tone.ahx', 'tone.hvl', '96000-2.wav', '192000-1.wav'];
  for (const name of names) {
    await page.locator('#file').setInputFiles({ name, mimeType: 'application/octet-stream', buffer: await readFile(input(name)) });
    await page.locator('#open').click();
    await page.waitForFunction(name => window.libzci.snapshot()?.sourceName === name && window.libzci.snapshot()?.snapshot.state === 'Ready', name);
    const opened = (await snapshot()).snapshot;
    assert.notEqual(opened.provider.id, 'browser.webcodecs.opus');
    await page.locator('#play').click();
    await page.waitForFunction(() => window.libzci.snapshot()?.snapshot.position_frames > 2000 && window.libzci.snapshot()?.output.energy > 0);
    await command('pause');
    const paused = (await snapshot()).snapshot.position_frames;
    await page.waitForTimeout(150);
    assert.equal((await snapshot()).snapshot.position_frames, paused);
    if (opened.capabilities.interpolation) await command('interpolation', 2);
    const probe = await page.evaluate(() => window.libzci.job('probe'));
    assert.equal(probe.facts.provider.id, opened.provider.id);
    await command('seek', opened.total_frames / opened.sample_rate - 0.05);
    await command('play');
    await page.waitForFunction(() => window.libzci.snapshot()?.snapshot.state === 'Ended');
    assert.equal((await snapshot()).snapshot.position_frames, opened.total_frames);
    results.push({ name, test: 'real Android worklet / pause / seek / probe / controls / final drain', provider: opened.provider.id });
    console.log('passed Android output:', name);
  }
  await page.locator('#file').setInputFiles({ name: 'no-duration.flac', mimeType: 'audio/flac', buffer: await readFile(path.join(media, 'no-duration.flac')) });
  await page.locator('#open').click();
  await page.waitForFunction(() => window.libzci.snapshot()?.sourceName === 'no-duration.flac' && window.libzci.snapshot()?.snapshot.state === 'Ready');
  assert.equal((await snapshot()).snapshot.total_frames, null);
  await command('seek', 0.5);
  assert.equal((await snapshot()).snapshot.position_frames, 24000);
  await command('play');
  await page.waitForFunction(() => window.libzci.snapshot()?.snapshot.state === 'Ended');
  assert((await snapshot()).snapshot.position_frames > 120000);
  results.push({ test: 'Android unknown-duration FLAC seek and drain' });
  const reference = await context.newPage();
  reference.setDefaultTimeout(60000);
  reference.on('pageerror', error => errors.push(String(error)));
  await reference.goto('http://localhost:5197/test/reference.html');
  await reference.waitForFunction(() => !!window.referenceHarness);
  for (const name of [...names, 'no-duration.flac']) {
    const rendered = path.join(media, name + '.android-native.f32');
    const run = spawnSync(cli, [input(name), '--render-pcm', rendered], { encoding: 'utf8', windowsHide: true });
    assert.equal(run.status, 0, run.error?.message ?? run.stderr);
    const pcm = await readFile(rendered);
    const report = await reference.evaluate(async ({ name, bytes, expected, sourceRate }) => {
      const decode = value => Uint8Array.from(atob(value), character => character.charCodeAt(0));
      return window.referenceHarness.run(new File([decode(bytes)], name), new Float32Array(decode(expected).buffer), 0, 3, 48000, sourceRate);
    }, { name, bytes: (await readFile(input(name))).toString('base64'), expected: pcm.toString('base64'), sourceRate: Number(name.split('-')[0]) || 48000 });
    assert.equal(report.frames, pcm.length / 8, name);
    assert(report.maxError < 0.00003, `${name}: sample error ${report.maxError}`);
    assert(report.highWater <= 8);
    assert(report.stats.maxRead <= 32768);
    results.push({ name, test: 'Android samples versus native / delayed recycling', ...report });
    console.log('passed Android samples:', name, report.frames, report.maxError);
  }
  await page.bringToFront();
  await command('dispose');
  assert.deepEqual(errors, []);
  await writeFile(path.join(root, '.local/libzci/review-android-evidence.json'), JSON.stringify({ avd, serial, environment, results }, null, 2));
} finally {
  await context?.close();
  await Promise.all(devices.map(device => device.close()));
  adb(['reverse', '--remove', 'tcp:5197'], { allowFailure: true });
  await server.close();
}
