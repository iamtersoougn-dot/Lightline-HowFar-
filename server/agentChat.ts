/**
 * POST /api/v1/agent/chat: the Daily Guide's optional online voice.
 *
 * The phone sends: the question, its own on-device draft answer, and a compact facts summary
 * (no bank alert text, no account digits, money totals only if the user allowed it).
 * The LLM (Gemini by default, or Claude) may only rephrase from those facts. Safeguards:
 *  - the API key lives here on the server, never in the app
 *  - strict input limits and a per-device rate limit
 *  - any number in the reply that is not in the facts → the draft is returned instead
 *  - no key, timeout or error → 503, and the phone keeps its own answer
 */
import type { Request, Response } from 'express';

export type ChatProvider = 'gemini' | 'anthropic';

export interface AgentChatOptions {
  provider: ChatProvider;
  apiKey: string | undefined;
  model: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  rateLimit?: { max: number; windowMs: number };
}

type Facts = Record<string, string | number | boolean | null>;

export const DEFAULT_MODELS: Record<ChatProvider, string> = {
  gemini: 'gemini-3.5-flash-lite',
  anthropic: 'claude-haiku-5-5'
};

/** Reads GUIDE_AI_PROVIDER, GEMINI_API_KEY / ANTHROPIC_API_KEY and GUIDE_MODEL. */
export function chatOptionsFromEnv(env: Record<string, string | undefined>): AgentChatOptions {
  const provider: ChatProvider =
    env.GUIDE_AI_PROVIDER === 'anthropic' || (!env.GUIDE_AI_PROVIDER && !env.GEMINI_API_KEY && env.ANTHROPIC_API_KEY)
      ? 'anthropic'
      : 'gemini';
  return {
    provider,
    apiKey: provider === 'gemini' ? env.GEMINI_API_KEY : env.ANTHROPIC_API_KEY,
    model: env.GUIDE_MODEL || DEFAULT_MODELS[provider]
  };
}

/** Sends one request to the chosen provider and returns the reply text ('' if none). */
export async function callModel(
  opts: AgentChatOptions,
  system: string,
  user: string,
  signal: AbortSignal
): Promise<{ status: number; text: string }> {
  const doFetch = opts.fetchImpl || fetch;
  if (opts.provider === 'gemini') {
    const r = await doFetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(opts.model)}:generateContent`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': opts.apiKey || '' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: 'user', parts: [{ text: user }] }],
          // Room for models that think before answering; the prompt keeps the answer short
          generationConfig: { maxOutputTokens: 1024, temperature: 0.3 }
        }),
        signal
      }
    );
    if (!r.ok) return { status: r.status, text: '' };
    const data = (await r.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string; thought?: boolean }> } }>;
    };
    const parts = data.candidates?.[0]?.content?.parts || [];
    return { status: 200, text: parts.filter((x) => !x.thought).map((x) => x.text || '').join(' ').trim() };
  }

  const r = await doFetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': opts.apiKey || '',
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: opts.model,
      max_tokens: 220,
      system,
      messages: [{ role: 'user', content: user }]
    }),
    signal
  });
  if (!r.ok) return { status: r.status, text: '' };
  const data = (await r.json()) as { content?: Array<{ type: string; text?: string }> };
  return {
    status: 200,
    text: (data.content || []).filter((c) => c.type === 'text').map((c) => c.text || '').join(' ').trim()
  };
}

export function validateChatBody(body: unknown):
  | { ok: true; question: string; lang: 'en' | 'pcm'; draft: string; facts: Facts }
  | { ok: false; error: string } {
  if (!body || typeof body !== 'object') return { ok: false, error: 'Body must be JSON' };
  const b = body as Record<string, unknown>;
  if (typeof b.question !== 'string' || !b.question.trim() || b.question.length > 300) {
    return { ok: false, error: 'question must be 1–300 characters' };
  }
  if (b.lang !== 'en' && b.lang !== 'pcm') return { ok: false, error: 'lang must be en or pcm' };
  if (typeof b.draft !== 'string' || b.draft.length > 1500) return { ok: false, error: 'draft must be a string up to 1500 characters' };
  if (!b.facts || typeof b.facts !== 'object' || Array.isArray(b.facts)) return { ok: false, error: 'facts must be an object' };
  const entries = Object.entries(b.facts as Record<string, unknown>);
  if (entries.length > 30) return { ok: false, error: 'too many facts' };
  const facts: Facts = {};
  for (const [k, v] of entries) {
    if (k.length > 40) return { ok: false, error: 'fact name too long' };
    if (v === null || typeof v === 'number' || typeof v === 'boolean') facts[k] = v;
    else if (typeof v === 'string' && v.length <= 400) facts[k] = v;
    else return { ok: false, error: `fact ${k} has an unsupported value` };
  }
  return { ok: true, question: b.question.trim(), lang: b.lang, draft: b.draft, facts };
}

/** Every number of 2+ digits in the reply must already appear in what we gave the model. */
export function numbersAreGrounded(reply: string, allowed: string): boolean {
  const norm = (s: string) => (s.match(/\d[\d,]*(\.\d+)?/g) || []).map((n) => n.replace(/,/g, ''));
  const known = new Set(norm(allowed));
  return norm(reply).every((n) => n.length < 2 || known.has(n) || known.has(String(Math.round(Number(n)))));
}

export function systemPrompt(lang: 'en' | 'pcm'): string {
  return [
    "You are the Daily Guide inside Lightline, a phone app that helps people in Nigeria with light (electricity), generator fuel, fuel prices, transport fares, bank network problems and spending.",
    'Answer the question using ONLY the facts and the draft answer provided. Never invent numbers, prices, places, times or bank names.',
    'If the facts do not answer the question, say so in one sentence and suggest what to record in the app.',
    lang === 'pcm'
      ? 'Reply in natural, respectful Nigerian Pidgin English.'
      : 'Reply in plain, friendly English as spoken in Nigeria.',
    'At most 3 short sentences. Plain text only: no markdown, no lists, no emojis.',
    'Do not give investment, legal or medical advice.'
  ].join(' ');
}

export function createAgentChatHandler(opts: AgentChatOptions) {
  const limit = opts.rateLimit || { max: 20, windowMs: 10 * 60_000 };
  const hits = new Map<string, number[]>();

  return async (req: Request, res: Response) => {
    if (!opts.apiKey) {
      return res.status(503).json({ error: 'AI chat is not configured on this server' });
    }

    const who = String(req.headers['x-device-id'] || req.ip || 'anon').slice(0, 80);
    const now = Date.now();
    const recent = (hits.get(who) || []).filter((t) => now - t < limit.windowMs);
    if (recent.length >= limit.max) {
      return res.status(429).json({ error: 'Too many questions. Try again in a few minutes.' });
    }
    recent.push(now);
    hits.set(who, recent);
    if (hits.size > 5000) hits.clear(); // keep memory bounded on a small server

    const v = validateChatBody(req.body);
    if (!v.ok) return res.status(400).json({ error: v.error });

    const factsText = JSON.stringify(v.facts);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 10_000);
    try {
      const user = `Facts (from the user's phone):\n${factsText}\n\nDraft answer computed on the phone:\n${v.draft}\n\nQuestion:\n${v.question}`;
      const { status, text } = await callModel(opts, systemPrompt(v.lang), user, controller.signal);
      if (status !== 200) return res.status(502).json({ error: `AI service error (${status})` });
      if (!text) return res.status(502).json({ error: 'Empty AI reply' });

      // Safeguard: a reply with an unknown number falls back to the phone's own answer
      if (!numbersAreGrounded(text, `${factsText} ${v.draft} ${v.question}`)) {
        return res.json({ text: v.draft, grounded: false });
      }
      return res.json({ text: text.slice(0, 900), grounded: true });
    } catch {
      return res.status(504).json({ error: 'AI service timed out' });
    } finally {
      clearTimeout(timer);
    }
  };
}
