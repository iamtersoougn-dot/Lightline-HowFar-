/**
 * Checks that online chat works with your key before the demo.
 *   npm run check:ai                      (reads .env)
 *   GEMINI_API_KEY=... npm run check:ai
 * Sends one sample question. If the model name is wrong, lists the Gemini models your key can use.
 */
import dotenv from 'dotenv';
import { callModel, chatOptionsFromEnv, systemPrompt } from '../server/agentChat';

dotenv.config();
const opts = chatOptionsFromEnv(process.env);
if (!opts.apiKey) {
  console.log('No key found. Set GEMINI_API_KEY (or ANTHROPIC_API_KEY) in .env or on the command line.');
  process.exit(1);
}
console.log(`Provider: ${opts.provider} · model: ${opts.model}`);

const facts = { area: 'Gwarinpa', likelyOutage: '7pm-11pm (6 of last 7 days)', genFuelLitres: 9.5, genLitresPerDay: 4.2 };
const draft = 'As you dey use 4.2L every day, you go need like 30L this week. You get 9.5L, so buy like 20L.';
const user = `Facts (from the user's phone):\n${JSON.stringify(facts)}\n\nDraft answer computed on the phone:\n${draft}\n\nQuestion:\nHow much fuel I go need this week?`;

const controller = new AbortController();
setTimeout(() => controller.abort(), 20_000);
const t0 = Date.now();
try {
  const r = await callModel(opts, systemPrompt('pcm'), user, controller.signal);
  if (r.status === 200 && r.text) {
    console.log(`OK in ${Date.now() - t0}ms. Reply:\n  ${r.text}`);
    process.exit(0);
  }
  console.log(`Failed: HTTP ${r.status}${r.status === 200 ? ' (empty reply)' : ''}`);
  if (opts.provider === 'gemini' && (r.status === 404 || r.status === 400)) {
    const list = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200', { headers: { 'x-goog-api-key': opts.apiKey } });
    const data = (await list.json()) as { models?: Array<{ name: string; supportedGenerationMethods?: string[] }> };
    const usable = (data.models || [])
      .filter((m) => m.supportedGenerationMethods?.includes('generateContent') && /flash/i.test(m.name))
      .map((m) => m.name.replace('models/', ''));
    console.log('Flash models your key can use (set one as GUIDE_MODEL):');
    for (const m of usable) console.log('  ' + m);
  }
  if (r.status === 401 || r.status === 403) console.log('The key was rejected. Check it was copied fully, and that the API is enabled for it.');
  if (r.status === 429) console.log('Rate or quota limit reached on this key. Wait a minute, or check your plan.');
  process.exit(1);
} catch (e) {
  console.log(`Failed: ${(e as Error).message}`);
  process.exit(1);
}
