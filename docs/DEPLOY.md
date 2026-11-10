# Deploy, build the APK, record the demo

About 1 to 1.5 hours in total. Do the steps in order; each one ends with a check.

## 1. Database on Neon (10 min)

1. Go to **neon.com** and sign in (Continue with GitHub works).
2. Create a project named `lightline`. Region: **AWS Europe Central (Frankfurt)**.
3. Click **Connect** and copy the connection string. It starts with `postgresql://` and contains `neon.tech`. Paste it exactly as copied; the server handles the rest.

You don't need to run any SQL. The server creates the tables, the 37 states and the seed areas the first time it starts.

## 2. Backend on Render (15 min)

1. Go to **render.com**, then **New → Blueprint**, and pick the GitHub repo `lightline-howfar-`. Render reads `render.yaml` and proposes a free web service called `lightline-api` (Frankfurt).
2. When it asks for the secret values:
   - `DATABASE_URL`: the Neon string from step 1
   - `GEMINI_API_KEY`: your Gemini key
   - `GUIDE_MODEL`: leave empty for now
3. Click **Apply** and wait until the service shows **Live**.
4. **Check:** open `https://lightline-api.onrender.com/health` (use the URL Render shows). You should see `"database":"connected"` and `"chat":"gemini"`.

Free Render services sleep after 15 minutes without traffic, and the first request then takes up to a minute. Before recording, open the `/health` URL once to wake the server.

## 3. Check the Gemini key (5 min, on your computer)

```bash
npm install
GEMINI_API_KEY=your-key npm run check:ai
```

(On Windows PowerShell: `$env:GEMINI_API_KEY="your-key"; npm run check:ai`)

- **OK:** it prints a reply in Pidgin. Nothing more to do.
- **"Failed: HTTP 404"**: the default model name isn't available to your key. The script lists the Flash models your key *can* use. Copy one (a "flash-lite" model is cheapest) into `GUIDE_MODEL` in Render → Environment, then save and redeploy.

## 4. Build the debug APK (20–30 min the first time)

You need Android Studio (which you have) and Node 20+.

```bash
git pull
npm install
```

Create a file named `.env` in the project folder with one line, using your Render URL:

```
VITE_API_BASE_URL=https://lightline-api.onrender.com
```

Then:

```bash
npm run android:sync     # builds the app and copies it into the Android project
npm run android:open     # opens Android Studio
```

In Android Studio:
1. Wait for **Gradle sync** to finish (bottom status bar; the first time it downloads a lot).
2. **Build → Build App Bundle(s) / APK(s) → Build APK(s)**.
3. When it finishes, click **locate** in the popup. The file is `android/app/build/outputs/apk/debug/app-debug.apk`.
4. Copy it to the phone (USB, WhatsApp to yourself, or Google Drive) and open it. Allow "install unknown apps" for that source when asked.

Or, with the phone plugged in by USB and USB debugging on, press the green ▶ Run button to install straight to the phone.

**Check:** open Lightline, choose your state, tap the sync button (top right). No error toast means the phone is talking to Render and Neon.

Whenever you change code: `npm run android:sync`, then build again.

## 5. Phone settings before recording (5 min)

- Allow notifications when Lightline asks (first reminder) or in Android **Settings → Apps → Lightline → Notifications**.
- Tecno, Infinix and itel phones close background apps aggressively. Set **Settings → Apps → Lightline → Battery → No restrictions** (the wording varies: "Allow background activity", or remove it from "Auto-manage").
- On Android 14, also allow **Alarms & reminders** for Lightline, so the reminders arrive on time.
- Turn on **Do Not Disturb exceptions** if you record at night, or simply record in the day: demo mode lets you pick the time.
- For smarter answers on camera: **Daily Guide settings → Smarter chat answers (online)** on. Leave "Include money totals" off to show the privacy point.

## 6. Recording plan (about 2 minutes of video)

Use the phone's screen recorder, with your voice or captions. Settings → Daily Guide → **Demo week** on.

| Time on screen | Tap | Show and say |
|---|---|---|
| 0:00–0:15 | (Today tab) | "Lightline: wetin dey? Light, gen fuel, prices, bank network and money, for all 36 states and the FCT. Meet the Daily Guide." |
| 0:15–0:35 | **6:00am** | The morning brief opens by itself: light likely off 7–11pm (6 of the last 7 days), gen fuel lasts about 2 days, fuel up 8%. "It learned this on the phone, from this week." |
| 0:35–0:60 | **12:30pm** | The notification: "Zenith app failing, use POS (88%)". Point at the **Why** line. Scroll to **Planned reminders: 5pm do heavy chores · 6:15pm charge before light goes**. "It plans ahead, and it limits itself to a few reminders a day." |
| 1:00–1:25 | **Ask Guide** | Type or say: *How much fuel I go need this week?* It answers in Pidgin with the litres and ₦, plus the reason. Then *Is my bank working?* |
| 1:25–1:40 | **6:15pm** | "Light likely off 7pm–11pm tonight. Charge your phone and power bank now." Tap **Not useful** on one card: "You stay in control." |
| 1:40–1:50 | **9:00pm** | "No light now. It usually comes back around 11pm." The gen is running. |
| 1:50–2:00 | Settings | Reminders Off / Few / Normal, quiet hours, "bank alerts never leave the phone", **Forget everything**. "Works offline. Private by default." |

Tip: turn on airplane mode for one chat question to show it still answers ("Answered on this phone").
