/**
 * Cloudflare Worker entry point used only by ChatGPT Sites packaging.
 * The application itself remains a static, offline-first Vite PWA.
 */
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    let response = await env.ASSETS.fetch(request);

    if (
      response.status === 404 &&
      (request.method === 'GET' || request.method === 'HEAD') &&
      request.headers.get('accept')?.includes('text/html')
    ) {
      response = await env.ASSETS.fetch(new Request(new URL('/index.html', url), request));
    }

    if (url.pathname === '/sw.js' || url.pathname === '/manifest.webmanifest') {
      const headers = new Headers(response.headers);
      headers.set('Cache-Control', 'no-cache');
      response = new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers
      });
    }

    return response;
  }
};
