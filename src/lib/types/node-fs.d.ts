declare module 'node:fs' {
  export function readFileSync(path: string | URL): string | Uint8Array;
}
