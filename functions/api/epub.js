// GET /api/epub?url=<epub url>
// CORS-safe proxy for EPUB downloads from an allowlist of public-domain hosts.
// The app tries a direct fetch first and only falls back to this when the host blocks cross-origin requests.
const ALLOW = ['gutenberg.org', 'standardebooks.org', 'archive.org', 'feedbooks.com', 'manybooks.net'];

export async function onRequestGet({ request }) {
  const target = new URL(request.url).searchParams.get('url');
  if (!target) return json({ error: 'url is required' }, 400);
  let u;
  try { u = new URL(target); } catch { return json({ error: 'bad url' }, 400); }
  if (u.protocol !== 'https:' || !ALLOW.some(h => u.hostname === h || u.hostname.endsWith('.' + h)))
    return json({ error: 'host not allowed' }, 403);

  const upstream = await fetch(u.toString(), { redirect: 'follow', headers: { 'User-Agent': 'Shelfmark/1.0 (personal reader)' }, cf: { cacheTtl: 86400, cacheEverything: true } });
  if (!upstream.ok) return json({ error: 'upstream ' + upstream.status }, 502);

  const headers = new Headers({
    'Content-Type': upstream.headers.get('content-type') || 'application/epub+zip',
    'Cache-Control': 'public, max-age=86400',
    'Access-Control-Allow-Origin': '*',
  });
  const len = upstream.headers.get('content-length'); if (len) headers.set('Content-Length', len);
  return new Response(upstream.body, { status: 200, headers });
}
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json' } });
