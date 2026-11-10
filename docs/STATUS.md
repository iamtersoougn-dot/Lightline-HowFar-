# Lightline status and launch checklist

_Last updated: 10 Nov 2026_

## Where it stands

| Area | Status |
|---|---|
| App (React + Capacitor): Today, Bank/POS, Chores, Fuel & Fare, Money | ✅ Working prototype, all 36 states + FCT |
| Offline outbox + sync (Express + Supabase) | ✅ Built and tested locally; ⬜ not deployed |
| Bank alert parser (11 banks/fintechs) | ✅ 12 formats tested |
| **Daily Guide agent** (learn, predict, brief, nudges, chat, explanations) | ✅ Built, 41 tests |
| Online chat endpoint (Claude, grounded) | ✅ Built; ⬜ needs `ANTHROPIC_API_KEY` on a deployed server |
| Demo week for the video | ✅ Built (Settings → Daily Guide → Demo week) |
| Privacy policy | 🟨 Draft in `docs/PRIVACY.md`; needs company details and legal review |
| Android APK | ⬜ Not built yet |
| GitHub repo | 🟨 Committed locally; push once the empty `Lightline` repo exists |

## Dubai Create AI Agents Championship (Best Personal AI Agent), due Dec 2026 – Jan 2027

- [x] Agent layer with clear Observe → Learn → Decide → Act → Explain loop
- [x] Personalised: learns each user's area, gen use, bank, spending, route
- [x] Productivity: plans reminders ahead (chores before the outage, charge before 7pm)
- [x] Accessibility: Pidgin + English, voice input where supported, read-aloud, works offline on low-end phones
- [x] One-line explanation on every suggestion and chat answer
- [x] Demo mode with a simulated week and 4 filmable moments (6:00am, 12:30pm, 6:15pm, 9:00pm)
- [x] One-page architecture note (`docs/AGENT_ARCHITECTURE.md`)
- [ ] Deploy backend (Render or Railway) with `ANTHROPIC_API_KEY` so "Smarter answers" can be shown live
- [ ] Build a debug APK and record the demo on a real Android phone (ideally a Tecno/Infinix/itel)
- [ ] Demo video script: 6am brief → 12:30 bank nudge + Pidgin chat ("How much fuel I go need this week?") → 6:15pm "charge now" → 9pm "light usually back by 11pm" → settings (privacy, Few/Normal, Forget everything)
- [ ] Pitch deck: problem (the daily calculations from the "Nigerian day" list), agent loop diagram, demo stills, safeguards, test results, roadmap
- [ ] Short field test: 5–10 real users in 2–3 states for one week, so the deck can show real (not only demo) predictions
- [ ] Confirm entry rules: one agent per category? (TripWatch is in Best Societal AI Agent)

## Before a public launch (Play Store)

**Must do**
- [ ] Register the company and fill in `docs/PRIVACY.md`; legal review against NDPA 2023 (cross-border transfer for AI chat, retention periods)
- [ ] Host the privacy policy at a public URL and link it in the app's settings and in the Play Store listing
- [ ] Play Store Data safety form: on-device bank data; community reports (area, time, status) collected; optional AI chat
- [ ] Deploy backend with HTTPS; remove `cleartext: true` from `capacitor.config.ts`
- [ ] Rate-limit `/api/v1/sync-outbox` per device; abuse checks on crowd reports (one user flipping an area's status)
- [ ] Android 13+ notification permission prompt flow tested; exact-alarm behaviour on Tecno/Infinix (aggressive battery savers can delay notifications; add a "keep Lightline unrestricted" tip)
- [ ] Replace sample seed data (bank scores, prices, tariffs) or label it clearly; check current DisCo tariffs and per-state DisCo mapping
- [ ] Notification icon (`res/drawable/ic_stat_*`) and app icon

**Should do**
- [ ] Android share target, so users can share a bank alert straight into Lightline (closest legal route to automatic tracking, since Play limits SMS reading)
- [ ] Background refresh (WorkManager) so predictions update even if the app isn't opened for days
- [ ] Translations of the Guide into Hausa, Yoruba and Igbo; Tiv as a later option
- [ ] Lazy-load demo mode and chat to trim the first download further
- [ ] Crash reporting that never includes bank alert content

## Known limits (honest list)

- Predictions need about 5 days of light reports for an area; until then the Guide says it is still learning.
- Voice input depends on the phone's speech service; many Android WebViews don't offer it, so the mic button hides itself there.
- The generator forecast relies on users tapping Start/Stop; runs not logged are not counted.
- Notifications are scheduled when the app is opened; without background refresh, a phone left closed for days gets stale reminders (they expire, so none are wrong, but some are missed).
