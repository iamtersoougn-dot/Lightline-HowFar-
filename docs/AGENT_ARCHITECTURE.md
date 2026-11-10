# Daily Guide: agent architecture (one page)

**Lightline's Daily Guide** is a personal AI agent for everyday life in Nigeria. It learns each user's light, generator, fuel, bank and spending patterns **on their own phone**, predicts what is coming, and acts ahead of time with a few well-timed reminders, each with a one-line reason.

```
 OBSERVE ─────────► LEARN ─────────────► DECIDE ─────────────► ACT ──────────────► EXPLAIN
 on-device journal  plain maths, on       rules + confidence    nudge limiter,        one-line "why"
 + bank alerts      the phone (~5 ms)     thresholds            brief, chat           from real numbers
        ▲                                                                │
        └──────────── feedback: "useful" / "not useful" ◄────────────────┘
```

## 1. Inputs (Observe)
| Source | Examples | Where it lives |
|---|---|---|
| User taps | "Up NEPA" / "They took light", gen start/stop, refuel, bank success/failure, fuel and fare prices | On-device journal (≤ 2,000 events, ≤ 90 days) |
| Crowd data from the area | Neighbours' light reports, prices in the state, live bank network status | Synced, then journaled on the phone |
| Bank alerts the user pastes | POS, fuel, urgent 2k, bank charges, airtime, salary | On the phone only (balances removed, account cut to 2 digits) |
| Context | State and area (all 36 states + FCT), time, battery level | On the phone |

## 2. Decision logic (Learn → Decide)
- **Light:** for each hour of the day, the chance of no light over the last 21 days, giving recent days more weight (×0.88 per day). A window is "likely dark" at ≥ 60% with ≥ 3 days of data. **No predictions before 5 days of reports**; the brief says "still learning" instead.
- **Generator:** litres burned per day from logged runs → days of fuel left → litres and naira needed for the week at the cheapest local price.
- **Fuel and fares:** last 2 days vs 3–10 days ago (medians); the user's most-reported route vs their usual fare.
- **Bank:** the user's main bank from their alerts, matched against live failure rates; suggests the channel that works (POS or USSD) or another bank.
- **Spending:** today vs usual day, week pace vs budget, urgent-2k count vs last week.
- Each rule outputs a suggestion with **priority** (1–3), **confidence** (0.5–0.95), English and **Pidgin** text, a best time to notify, and an expiry.

## 3. Actions (Act)
- **Morning brief, "Wetin dey today?"**: light forecast, gen fuel, fuel price, your bank, yesterday's spending, chores. It opens once a day at the user's chosen hour.
- **Timely nudges** as phone notifications, planned ahead. Example day: 12:30 "Zenith app failing, use POS"; 5:00pm "pump water and iron before 7pm"; 6:15pm "light likely off 7–11pm, charge now".
- **Chat in English and Pidgin** (typed or voice where the phone supports it, with read-aloud): answered on the phone from the learned figures, with optional AI wording online.

## 4. Safeguards
- **Offline-first:** learning, predictions, brief, nudges and chat all work with no network. The LLM is optional and only rephrases.
- **Grounded AI:** the server checks every number in an AI reply against the figures sent; any unknown number → the phone's own answer is used. The API key stays on the server; inputs are size-limited and rate-limited.
- **Privacy by default:** bank alerts never leave the phone. Online chat is off until switched on; money totals need a second switch, and questions that draw on alerts (spending, "my bank", the brief) stay on the phone without it. "Forget everything" is one tap.
- **No spam (nudge limiter):** user picks Off / Few (3 a day) / Normal (5 a day); quiet hours; never the same thing twice; 4-hour cooldown per kind; 15 minutes between any two nudges; low-priority items stay in the app; whatever the brief already said is not pushed again; "Not useful" twice → urgent only, three times → muted.
- **Honest uncertainty:** minimum-data thresholds, confidence below 60% is never pushed, and every suggestion says why ("No light 7–11pm on 6 of the last 7 days in Gwarinpa").
- **Low-end Android:** no ML library, about 5 ms per run on a full journal, re-runs every 15 minutes (hourly on low battery), and the whole app is about 94 KB over the network.

## 5. Proof
41 automated agent tests (pattern learning, predictions, offline fallback, privacy of what goes online, nudge limits, demo determinism, speed), plus the existing parser and state tests. A built-in **demo week** (Gwarinpa, Abuja) replays the scenario above for the video.
