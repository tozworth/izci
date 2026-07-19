import { readdir, readFile, writeFile } from 'node:fs/promises';
import { getMessageFormatter } from 'svelte-i18n';

const sourcePath = new URL('../src/lib/i18n/locales/en.json', import.meta.url);
const targetPath = new URL('../src/lib/i18n/locales/tr.json', import.meta.url);
const checkOnly = process.argv.includes('--check');

const source = JSON.parse(await readFile(sourcePath, 'utf8'));
const target = JSON.parse(await readFile(targetPath, 'utf8'));

function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function mergeMissing(sourceValue, targetValue) {
  if (!isObject(sourceValue)) {
    return typeof targetValue === 'string' && targetValue !== '' ? targetValue : sourceValue;
  }

  const targetObject = isObject(targetValue) ? targetValue : {};
  return Object.fromEntries(
    Object.entries(sourceValue).map(([key, value]) => [
      key,
      mergeMissing(value, targetObject[key])
    ])
  );
}

function collectLeafPaths(value, prefix = '') {
  if (!isObject(value)) return [prefix];
  return Object.entries(value).flatMap(([key, child]) =>
    collectLeafPaths(child, prefix ? `${prefix}.${key}` : key)
  );
}

async function collectSvelteFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = new URL(`${entry.name}${entry.isDirectory() ? '/' : ''}`, directory);
    if (entry.isDirectory()) return collectSvelteFiles(path);
    return entry.name.endsWith('.svelte') ? [path] : [];
  }));
  return nested.flat();
}

if (checkOnly) {
  const sourceKeys = collectLeafPaths(source);
  const targetKeys = new Set(collectLeafPaths(target));
  const missingKeys = sourceKeys.filter((key) => !targetKeys.has(key));
  const emptySourceKeys = sourceKeys.filter((key) => {
    const value = key.split('.').reduce((current, part) => current?.[part], source);
    return value === '';
  });
  const emptyTargetKeys = sourceKeys.filter((key) => {
    const value = key.split('.').reduce((current, part) => current?.[part], target);
    return value === '';
  });
  const invalidMessageKeys = [];
  const invalidTargetMessageKeys = [];

  for (const key of sourceKeys) {
    const value = key.split('.').reduce((current, part) => current?.[part], source);
    if (typeof value !== 'string' || value === '') continue;
    try {
      getMessageFormatter(value, 'en');
    } catch (error) {
      invalidMessageKeys.push(`${key}: ${error instanceof Error ? error.message : String(error)}`);
    }

    const targetValue = key.split('.').reduce((current, part) => current?.[part], target);
    if (typeof targetValue !== 'string' || targetValue === '') continue;
    try {
      getMessageFormatter(targetValue, 'tr');
    } catch (error) {
      invalidTargetMessageKeys.push(
        `${key}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
  const sourceDirectory = new URL('../src/', import.meta.url);
  const nonLiteralCallSites = [];

  for (const file of await collectSvelteFiles(sourceDirectory)) {
    const contents = await readFile(file, 'utf8');
    for (const match of contents.matchAll(/\$t\s*\(\s*([^'"\s])/g)) {
      const line = contents.slice(0, match.index).split(/\r?\n/).length;
      nonLiteralCallSites.push(`${file.pathname.replace(/^\//, '')}:${line}`);
    }
  }

  if (nonLiteralCallSites.length > 0) {
    throw new Error(
      `Found ${nonLiteralCallSites.length} translation call(s) with non-literal IDs; svelte-i18n cannot extract them:\n${nonLiteralCallSites.join('\n')}`
    );
  }

  if (emptySourceKeys.length > 0) {
    throw new Error(
      `English catalog has ${emptySourceKeys.length} empty source message(s):\n${emptySourceKeys.join('\n')}`
    );
  }

  if (emptyTargetKeys.length > 0) {
    throw new Error(
      `Turkish catalog has ${emptyTargetKeys.length} empty message(s):\n${emptyTargetKeys.join('\n')}`
    );
  }

  if (invalidMessageKeys.length > 0) {
    throw new Error(
      `English catalog has ${invalidMessageKeys.length} invalid ICU message(s):\n${invalidMessageKeys.join('\n')}`
    );
  }


  if (invalidTargetMessageKeys.length > 0) {
    throw new Error(
      `Turkish catalog has ${invalidTargetMessageKeys.length} invalid ICU message(s):\n${invalidTargetMessageKeys.join('\n')}`
    );
  }

  if (missingKeys.length > 0) {
    throw new Error(`Turkish catalog is missing ${missingKeys.length} key(s):\n${missingKeys.join('\n')}`);
  }
} else {
  const synchronized = mergeMissing(source, target);
  await writeFile(targetPath, `${JSON.stringify(synchronized, null, 2)}\n`);
}
