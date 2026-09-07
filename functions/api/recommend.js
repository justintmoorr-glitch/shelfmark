// POST /api/recommend  { history:[{title,author,progress,finished}], loans:[{title,author}], mood:string }
// Returns { recommendations:[{title, author, why, search}] } — public-domain titles only, via Gemini.
// Needs GEMINI_API_KEY in the Cloudflare Pages dashboard (redeploy after setting it).
const MODEL = 'gemini-2.5-flash';
const FALLBACKS = ['gemini-2.0-flash', 'gemini-flash-latest'];

export async function onRequestPost({ request, env }) {
  if (!env.GEMINI_API_KEY) return json({ error: 'GEMINI_API_KEY is not set' }, 500);
  let body; try { body = await request.json(); } catch { return json({ error: 'bad json' }, 400); }
  const history = (body.history || []).slice(0, 60), loans = (body.loans || []).slice(0, 40), mood = String(body.mood || '').slice(0, 300);

  const prompt = `You recommend books that are in the public domain and available for free as EPUBs on Project Gutenberg.
Reader's shelf (digital, with progress): ${JSON.stringify(history)}
Reader's library loans (physical/Libby, not necessarily public domain): ${JSON.stringify(loans)}
Reader's note for this request: ${mood || '(none)'}

Suggest 6 books the reader has NOT already got on the shelf. Mix safe bets with a couple of surprises.
Prefer books that are on Project Gutenberg in English. Do not suggest anything published after 1928 unless you are certain it is public domain.
For each, give a short, specific reason (one sentence, referencing what the reader has read or asked for), and a Gutenberg search string (title plus author surname) that will find it.
Respond with JSON only, no markdown fences:
{"recommendations":[{"title":"","author":"","why":"","search":""}]}`;

  const payload = JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.8, responseMimeType: 'application/json' } });

  // Try the preferred model, then fall back if the key's API version doesn't know it.
  let r, lastErr;
  for (const m of [MODEL, ...FALLBACKS]) {
    r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${env.GEMINI_API_KEY}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload,
    });
    if (r.ok) break;
    lastErr = { status: r.status, model: m, text: await r.text() };
    if (r.status !== 404) break;   // only a missing model is worth retrying
  }
  if (!r.ok) {
    let msg = '';
    try { msg = JSON.parse(lastErr.text)?.error?.message || ''; } catch {}
    const hint = lastErr.status === 400 ? 'The API key looks malformed — check for a stray space or newline.'
      : lastErr.status === 403 ? 'The key was rejected. Enable the Generative Language API for its project, and make sure the key has no HTTP-referrer restriction (a Worker sends no referrer).'
      : lastErr.status === 404 ? `No model matched (tried ${[MODEL, ...FALLBACKS].join(', ')}).`
      : lastErr.status === 429 ? 'Free-tier rate limit reached. Wait a minute and try again.'
      : '';
    return json({ error: `Gemini returned ${lastErr.status}`, detail: [msg, hint].filter(Boolean).join(' — ') || lastErr.text.slice(0, 300) }, 502);
  }
  const data = await r.json();
  const text = data.candidates?.[0]?.content?.parts?.map(p => p.text).join('') || '';
  try {
    const parsed = JSON.parse(text.replace(/```json|```/g, '').trim());
    const recs = (parsed.recommendations || []).filter(x => x.title && x.author).slice(0, 6);
    return json({ recommendations: recs });
  } catch { return json({ error: 'could not parse model output', raw: text }, 502); }
}
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json' } });
