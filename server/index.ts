/**
 * Lightline backend entry point.
 *
 * Environment:
 *   DATABASE_URL      Neon connection string (paste as copied). Without it, the API runs in
 *                     local fallback mode and the app keeps using its own data.
 *   GUIDE_AI_PROVIDER gemini (default) or anthropic
 *   GEMINI_API_KEY    for Gemini;  ANTHROPIC_API_KEY for Claude. Without a key, chat answers
 *                     come from the phone only.
 *   GUIDE_MODEL       optional model override
 *   PORT              set by the host
 */
import dotenv from 'dotenv';
import { createApp } from './app';
import { chatOptionsFromEnv } from './agentChat';
import { createDb, migrate } from './db';

dotenv.config();

const db = createDb(process.env.DATABASE_URL);
const chat = chatOptionsFromEnv(process.env);

async function main() {
  if (db) {
    // Neon's free database may be asleep; give it a few tries to wake up
    for (let attempt = 1; ; attempt++) {
      try {
        await migrate(db);
        console.log('[Lightline Backend] Database ready');
        break;
      } catch (err) {
        if (attempt >= 5) throw err;
        console.warn(`[Lightline Backend] Database not ready (${(err as Error).message}); retrying…`);
        await new Promise((r) => setTimeout(r, attempt * 2000));
      }
    }
  } else {
    console.warn('[Lightline Backend] DATABASE_URL not set: running without a database');
  }

  const port = Number(process.env.PORT) || 4000;
  createApp({ db, chat }).listen(port, () => {
    console.log(`[Lightline Backend] Listening on port ${port} · chat: ${chat.apiKey ? `${chat.provider} (${chat.model})` : 'off'}`);
  });
}

main().catch((err) => {
  console.error('[Lightline Backend] Failed to start:', err);
  process.exit(1);
});
