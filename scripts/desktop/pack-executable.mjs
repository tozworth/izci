import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { unzipSync } from 'fflate';

const version = '5.2.1';
// Official upx/upx release asset digest, pinned rather than trusting a moving release.
const archiveHash = 'eabc6792a347d45e945be7748423e7868fd01b0d2bcaa2f4b1031fd71ff69bda';
const executableHash = 'd20ebe0b7b22b6be968c8c34be61f94ddea12cb11462e2cec27f548ef9574df8';
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

export async function ensureDesktopPacker(root) {
  const folder = `upx-${version}-win64`;
  const directory = join(root, '.local', 'desktop-toolchain', folder);
  const executable = join(directory, 'upx.exe');
  if (!existsSync(executable)) {
    console.log(`Downloading UPX ${version} (build tool only; cached for offline builds).`);
    const response = await fetch(`https://github.com/upx/upx/releases/download/v${version}/${folder}.zip`, {
      signal: AbortSignal.timeout(120_000),
    });
    if (!response.ok) throw new Error(`UPX download failed: HTTP ${response.status}`);
    const archive = new Uint8Array(await response.arrayBuffer());
    if (sha256(archive) !== archiveHash) throw new Error('UPX archive checksum mismatch.');
    const entries = unzipSync(archive);
    const binary = entries[`${folder}/upx.exe`];
    if (!binary || sha256(binary) !== executableHash) throw new Error('UPX executable checksum mismatch.');
    mkdirSync(directory, { recursive: true });
    // Extract only known flat names, including the tool's license and documentation.
    for (const name of ['COPYING', 'LICENSE', 'README', 'NEWS', 'THANKS.txt', 'upx-doc.txt', 'upx.exe']) {
      const bytes = entries[`${folder}/${name}`];
      if (bytes) writeFileSync(join(directory, name), bytes);
    }
  }
  if (sha256(readFileSync(executable)) !== executableHash) throw new Error('Cached UPX executable checksum mismatch.');
  return executable;
}

export function packDesktopExecutable(packer, executable) {
  const originalSize = statSync(executable).size;
  for (const args of [
    ['--best', '--lzma', '--compress-icons=0', '--strip-relocs=0', '--overlay=copy'],
    ['--test'],
  ]) {
    const result = spawnSync(packer, ['--no-env', ...args, executable], { stdio: 'inherit', windowsHide: true });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`UPX ${args[0]} failed (${result.status}).`);
  }
  const packedSize = statSync(executable).size;
  console.log(`Standalone executable: ${(originalSize / 1_000_000).toFixed(2)} MB -> ${(packedSize / 1_000_000).toFixed(2)} MB (${(100 * (1 - packedSize / originalSize)).toFixed(1)}% smaller).`);
}
