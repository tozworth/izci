export type RenameTransform = 'trim' | 'lower' | 'upper' | 'title' | 'slug' | 'sanitize';

export interface RenameTemplateContext {
  [key: string]: string | number | undefined;
}

export type RenameTemplateNode =
  | { type: 'text'; value: string }
  | { type: 'token'; name: string; padding: number | null; transforms: RenameTransform[] }
  | { type: 'conditional'; name: string; children: RenameTemplateNode[] };

export interface RenameTemplateResult {
  value: string;
  missing: string[];
}

export interface FilenameRules {
  illegalCharacterReplacement?: string;
  normalizeWhitespace?: boolean;
  unicodeNormalization?: 'NFC' | 'NFD' | 'none' | 'ascii';
  extensionCase?: 'preserve' | 'lower' | 'upper';
  missingTokenPolicy?: 'stop' | 'empty' | 'skip';
  collisionPolicy?: 'stop' | 'skip' | 'counter';
}

const TOKEN_NAME = /^[a-z][a-z0-9-]*$/i;
const WINDOWS_RESERVED_NAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;
const TRANSFORMS = new Set<RenameTransform>(['trim', 'lower', 'upper', 'title', 'slug', 'sanitize']);

function parseToken(body: string): RenameTemplateNode {
  const [head, ...transformParts] = body.split('|').map((part) => part.trim());
  const match = head.match(/^([a-z][a-z0-9-]*)(?::(0?)(\d{1,2}))?$/i);
  if (!match) throw new Error(`Invalid rename token: {${body}}`);
  const transforms = transformParts.map((part) => {
    if (!TRANSFORMS.has(part as RenameTransform)) {
      throw new Error(`Unknown rename transform: ${part || '(empty)'}`);
    }
    return part as RenameTransform;
  });
  return {
    type: 'token',
    name: match[1].toLowerCase(),
    padding: match[3] ? Math.min(20, Number.parseInt(match[3], 10)) : null,
    transforms
  };
}

function parseNodes(template: string, start = 0, closingName?: string): {
  nodes: RenameTemplateNode[];
  offset: number;
} {
  const nodes: RenameTemplateNode[] = [];
  let cursor = start;
  let textStart = cursor;
  const pushText = (end: number) => {
    if (end > textStart) nodes.push({ type: 'text', value: template.slice(textStart, end) });
  };

  while (cursor < template.length) {
    if (template.startsWith('[[', cursor)) {
      pushText(cursor);
      nodes.push({ type: 'text', value: '[' });
      cursor += 2;
      textStart = cursor;
      continue;
    }
    if (template.startsWith('{{', cursor)) {
      pushText(cursor);
      nodes.push({ type: 'text', value: '{' });
      cursor += 2;
      textStart = cursor;
      continue;
    }
    if (template.startsWith('[/if]', cursor)) {
      if (!closingName) throw new Error('Unexpected [/if] in rename template.');
      pushText(cursor);
      return { nodes, offset: cursor + 5 };
    }
    if (template.startsWith('[if:', cursor)) {
      pushText(cursor);
      const end = template.indexOf(']', cursor + 4);
      if (end < 0) throw new Error('Unclosed conditional in rename template.');
      const name = template.slice(cursor + 4, end).trim().toLowerCase();
      if (!TOKEN_NAME.test(name)) throw new Error(`Invalid conditional token: ${name || '(empty)'}`);
      const nested = parseNodes(template, end + 1, name);
      nodes.push({ type: 'conditional', name, children: nested.nodes });
      cursor = nested.offset;
      textStart = cursor;
      continue;
    }
    if (template[cursor] === '{') {
      pushText(cursor);
      const end = template.indexOf('}', cursor + 1);
      if (end < 0) throw new Error('Unclosed token in rename template.');
      nodes.push(parseToken(template.slice(cursor + 1, end)));
      cursor = end + 1;
      textStart = cursor;
      continue;
    }
    cursor += 1;
  }

  if (closingName) throw new Error(`Unclosed [if:${closingName}] conditional.`);
  pushText(cursor);
  return { nodes, offset: cursor };
}

export function parseRenameTemplate(template: string): RenameTemplateNode[] {
  if (!template.trim()) throw new Error('Rename template cannot be empty.');
  return parseNodes(template).nodes;
}

function titleCase(value: string): string {
  return value.toLocaleLowerCase().replace(/(^|[\s_-])\p{L}/gu, (match) => match.toLocaleUpperCase());
}

function slug(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/\p{Mark}/gu, '')
    .toLocaleLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
}

function applyTransform(value: string, transform: RenameTransform): string {
  switch (transform) {
    case 'trim': return value.trim();
    case 'lower': return value.toLocaleLowerCase();
    case 'upper': return value.toLocaleUpperCase();
    case 'title': return titleCase(value);
    case 'slug': return slug(value);
    case 'sanitize': return sanitizeFilename(value).name;
  }
}

function contextValue(context: RenameTemplateContext, name: string): string {
  const value = context[name];
  return value === undefined || value === null ? '' : String(value);
}

export function renderRenameTemplate(
  nodes: RenameTemplateNode[],
  context: RenameTemplateContext
): RenameTemplateResult {
  const missing = new Set<string>();
  const render = (items: RenameTemplateNode[]): string => items.map((node) => {
    if (node.type === 'text') return node.value;
    const raw = contextValue(context, node.name);
    if (node.type === 'conditional') return raw.trim() ? render(node.children) : '';
    if (!raw.trim()) missing.add(node.name);
    let value = raw;
    if (node.padding !== null && /^\d+$/.test(value.trim())) {
      value = value.trim().padStart(node.padding, '0');
    }
    for (const transform of node.transforms) value = applyTransform(value, transform);
    return value;
  }).join('');
  return { value: render(nodes), missing: [...missing] };
}

export function sanitizeFilename(
  value: string,
  rules: FilenameRules = {}
): { name: string; changed: boolean; problems: string[] } {
  const replacement = (rules.illegalCharacterReplacement ?? '_').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '') || '_';
  const problems: string[] = [];
  let name: string;
  if (rules.unicodeNormalization === 'none') {
    name = value;
  } else if (rules.unicodeNormalization === 'ascii') {
    name = value.normalize('NFKD').replace(/\p{Mark}/gu, '');
    const ascii = name.replace(/[^\x20-\x7e]/g, replacement);
    if (ascii !== name) problems.push('non-ascii');
    name = ascii;
  } else {
    name = value.normalize(rules.unicodeNormalization ?? 'NFC');
  }
  const illegal = /[\\/:*?"<>|\u0000-\u001f]/g;
  if (illegal.test(name)) {
    problems.push('illegal-characters');
    name = name.replace(illegal, replacement);
  }
  if (rules.normalizeWhitespace !== false) {
    const normalized = name.replace(/\s+/g, ' ').trim();
    if (normalized !== name) problems.push('whitespace');
    name = normalized;
  }
  if (/[ .]+$/.test(name)) {
    problems.push('trailing-space-or-dot');
    name = name.replace(/[ .]+$/g, '');
  }
  if (WINDOWS_RESERVED_NAME.test(name)) {
    problems.push('reserved-name');
    name = `${replacement}${name}`;
  }
  if (!name) problems.push('empty-name');
  if (name === '.' || name === '..') problems.push('relative-name');
  return { name, changed: name !== value, problems };
}

export function validateFilename(name: string): string[] {
  const problems: string[] = [];
  if (!name) problems.push('empty-name');
  if (/[\\/:*?"<>|\u0000-\u001f]/.test(name)) problems.push('illegal-characters');
  if (/[ .]$/.test(name)) problems.push('trailing-space-or-dot');
  if (WINDOWS_RESERVED_NAME.test(name)) problems.push('reserved-name');
  if (name === '.' || name === '..') problems.push('relative-name');
  if (name.length > 255) problems.push('too-long');
  return problems;
}
