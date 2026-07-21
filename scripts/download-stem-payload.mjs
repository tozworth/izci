import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rename, rm, stat } from 'node:fs/promises';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

const revision = '9158719ee2173edd480a735764627526506fe4af';
const fileName = 'bs_polarformer_webgpu_fp16.onnx';
const expectedBytes = 108_302_219;
const expectedSha256 = '51015f20d3b2d981eaad706a442b1ce00967826aef2638b324029ca240bd197e';
const destination = fileURLToPath(
  new URL(`../public/optional/stem-separation/v1/${fileName}`, import.meta.url)
);
const temporary = `${destination}.tmp`;
const source = `https://huggingface.co/bgkb/bs_polarformer/resolve/${revision}/${fileName}`;
const runtime = fileURLToPath(
  new URL('../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.wasm', import.meta.url)
);
const expectedRuntimeBytes = 24_254_953;
const expectedRuntimeSha256 = '7e83cd6cee77e478bc96a7e91b198144fb5e4126287daf1f9b54bb195ebcd55a';

async function digestFile(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

async function existingPayloadIsUsable() {
  try {
    if ((await stat(destination)).size !== expectedBytes) return false;
    return (await digestFile(destination)) === expectedSha256;
  } catch {
    return false;
  }
}

if ((await stat(runtime)).size !== expectedRuntimeBytes || (await digestFile(runtime)) !== expectedRuntimeSha256) {
  throw new Error('The pinned ONNX Runtime Web artifact failed verification.');
}

if (await existingPayloadIsUsable()) {
  process.stdout.write(`Stem payload already present: ${destination}\n`);
  process.exit(0);
}

await mkdir(fileURLToPath(new URL('../public/optional/stem-separation/v1/', import.meta.url)), {
  recursive: true
});
await rm(temporary, { force: true });

const response = await fetch(source, { redirect: 'follow' });
if (!response.ok || !response.body) {
  throw new Error(`Stem payload download failed: HTTP ${response.status}`);
}

const hash = createHash('sha256');
let bytes = 0;
const verifier = new Transform({
  transform(chunk, _encoding, callback) {
    bytes += chunk.length;
    hash.update(chunk);
    callback(null, chunk);
  }
});

try {
  await pipeline(Readable.fromWeb(response.body), verifier, createWriteStream(temporary));
  const digest = hash.digest('hex');
  if (bytes !== expectedBytes) {
    throw new Error(`Stem payload size mismatch: expected ${expectedBytes}, received ${bytes}`);
  }
  if (digest !== expectedSha256) {
    throw new Error(`Stem payload digest mismatch: expected ${expectedSha256}, received ${digest}`);
  }
  await rename(temporary, destination);
  process.stdout.write(`Downloaded and verified stem payload: ${destination}\n`);
} catch (error) {
  await rm(temporary, { force: true });
  throw error;
}
