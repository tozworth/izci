// Android currently ships only assembleDebug; use development runtime checks too.
process.env.NODE_ENV = 'development';
const { build } = await import('vite');
await build({ mode: 'android' });
