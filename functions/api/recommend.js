// POST /api/recommend  { history:[{title,author,progress,finished}], loans:[{title,author}], mood:string }
// Returns { recommendations:[{title, author, why, search}] } — public-domain titles only, via Gemini.
// Needs GEMINI_API_KEY in the Cloudflare Pages dashboard (redeploy after setting it).
const MODEL = 'gemini-2.5-flash';

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

  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${env.GEMINI_API_KEY}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.8, responseMimeType: 'application/json' } }),
  });
  if (!r.ok) return json({ error: 'gemini ' + r.status, detail: await r.text() }, 502);
  const data = await r.json();
  const text = data.candidates?.[0]?.content?.parts?.map(p => p.text).join('') || '';
  try {
    const parsed = JSON.parse(text.replace(/```json|```/g, '').trim());
    const recs = (parsed.recommendations || []).filter(x => x.title && x.author).slice(0, 6);
    return json({ recommendations: recs });
  } catch { return json({ error: 'could not parse model output', raw: text }, 502); }
}
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json' } });
