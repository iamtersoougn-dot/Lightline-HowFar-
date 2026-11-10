# Lightline: Wetin dey?

Offline-first companion for the Nigerian day, across all 36 states and the FCT. One glance answers "wetin dey?": is there light, how much gen fuel is left, which banks are failing, what fuel and fares cost nearby, what chores are waiting, and where your money went today.

## Daily Guide (AI agent)

A personal agent that learns your light, generator, fuel, bank and spending patterns **on your phone**, predicts what's coming ("Light likely off 7–11pm tonight, charge now"), and acts with a morning brief, a few well-timed reminders and chat in English or Pidgin. Every suggestion says why, in one line.

- How it works: [`docs/AGENT_ARCHITECTURE.md`](docs/AGENT_ARCHITECTURE.md)
- Code: `src/agent/` (journal, learning, suggestions, nudge limiter, brief, chat, demo week), `src/hooks/useDailyGuide.ts`, `src/components/guide/`, `server/agentChat.ts`
- Demo for filming: Today → Daily Guide settings → **Demo week**, then tap 6:00am / 12:30pm / 6:15pm / 9:00pm. Or print it in a terminal: `npm run demo:print` (or `npm run demo:print -- pcm` for Pidgin).
- Online chat is optional: set `GEMINI_API_KEY` (or `ANTHROPIC_API_KEY` with `GUIDE_AI_PROVIDER=anthropic`) on the server, and check it with `npm run check:ai`. Without a key, chat answers on the phone.
- Privacy: [`docs/PRIVACY.md`](docs/PRIVACY.md) (draft). Status and launch checklist: [`docs/STATUS.md`](docs/STATUS.md).

## Run locally

```bash
npm install
cp .env.example .env        # DATABASE_URL (Neon) and GEMINI_API_KEY are optional locally
npm run server              # backend on :4000
npm run dev                 # frontend on :5173 (use --host LAN IP to open on your phone)
```

Without `DATABASE_URL` the backend runs in fallback mode: it acknowledges synced reports and the app keeps using its seeded local data.

**Deploying, building the APK and recording the demo:** step by step in [`docs/DEPLOY.md`](docs/DEPLOY.md) (Neon + Render + Gemini + Android Studio).

## Coverage: all 36 states + FCT

- State list, capitals, geopolitical zones and main DisCo per state live in `src/data/nigeriaStates.ts` (ISO 3166-2:NG codes). The app and server both import it.
- Every state starts with a city-wide area at its capital showing "No reports yet" until someone reports. FCT and Lagos also have detailed sample feeders.
- Users add their own street, estate or feeder with "My area is not listed". The area id comes from the state and the name, so neighbours who type the same name share one status. The server creates the area on its first report.
- DisCo mapping is the main company per state. Some states are split (Lagos is IKEDC/EKEDC; parts of Ogun use EKEDC) and some states now run their own markets under the Electricity Act 2023, so users can type a different DisCo for their area.

## Database

Postgres on **Neon** (free plan). Set `DATABASE_URL` to the Neon connection string as copied; the server applies `server/schema.sql` on every start (safe to re-run), so a new database needs no manual SQL. The schema is generated from the state list: after editing `src/data/nigeriaStates.ts`, run `npm run gen:schema`.

Server tests against a throwaway local database: `TEST_DATABASE_URL=postgres://user:pw@localhost:5432/lightline_test npm run test:server` (it wipes that database).


## Android build

The Android project is in `android/`. Set `VITE_API_BASE_URL` in `.env`, then:

```bash
npm run android:sync
npm run android:open    # then Build → Build APK(s) in Android Studio
```

On a real phone, set `VITE_API_BASE_URL` to your computer's LAN IP (e.g. `http://192.168.1.20:4000`) or a deployed backend URL, then rebuild.

## How data flows

1. Every tap (Up NEPA, bank report, fuel price) updates local storage immediately and goes into an outbox queue.
2. On launch, on reconnect, or when you tap the sync button, the outbox is sent to `/api/v1/sync-outbox`. Each report has a unique `client_mutation_id`, so retries never create duplicates.
3. The app then pulls `/api/v1/bootstrap` and merges the live crowd data for your city into local storage.

## Money alerts (on-device)

The Money tab reads pasted bank and fintech alerts (GTBank, Zenith, Access, UBA, FirstBank, OPay, Moniepoint, PalmPay, Kuda and others) and sorts each debit into POS, fuel, urgent 2k (small transfers, limit adjustable), bank charges, airtime/data, light units or transfers. Fuel debits can be added to the generator tank in one tap.

- Code: `src/services/alertParser.ts` (parser), `src/services/moneyLedger.ts` (storage), `src/components/MoneyTab.tsx` (UI).
- Alerts never enter the sync outbox. Balances are stripped and account numbers are cut to the last 2 digits.
- Tests: `npm test` runs 12 sample alerts across 11 banks/fintechs, the state coverage checks, and 41 Daily Guide agent tests.
- Why paste instead of reading SMS automatically: Google Play only lets default SMS apps hold the READ_SMS permission, and other apps cannot read WhatsApp chats. The realistic next step is an Android share target, so users tap Share on an alert and pick Lightline.

## Notes before launch

- Seed data (zones, bank scores, prices, tariffs) is sample data. Check current DisCo tariffs and fuel prices before going live.
- The charger sensor uses the Web Battery API. It works in Android WebView and Chrome, not in iOS Safari/WKWebView; iOS users get the manual buttons.
- All writes go through the backend. Before launch, rate-limit `/api/v1/sync-outbox` per device to stop spam reports.
- If you later parse bank SMS alerts, get explicit consent and follow the Nigeria Data Protection Act.
