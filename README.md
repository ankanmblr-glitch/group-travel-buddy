# Group Travel Buddy — Setup &amp; Deployment Guide

A single lightweight web page that acts as one window into the tools your group already uses on road trips: Google Maps navigation, Google Maps live location sharing, Zello push-to-talk, a shared Google Drive folder, and a custom expense splitter. **Total cost: $0.** No Play Store, no Apple fee, no paid hosting, no paid APIs.

It installs to your phone's home screen like an app (a "PWA" — Progressive Web App) but is really just a webpage, which is what keeps it free and simple.

---

## What this is NOT

To keep this honest and lean, this app deliberately does **not** rebuild:
- Google Maps' navigation engine (we deep-link into the real Google Maps app)
- Google Maps' live-location sharing (no public API exists for that — you keep using Google Maps' own "Location sharing" feature, this app just has a shortcut button to it)
- Zello's push-to-talk audio engine (we deep-link into the real Zello app)
- Google Drive's upload UI (we deep-link into your real shared Drive folder)

The only thing genuinely custom-built is the **expense splitter**, because no free tool does "AA can only edit AA's entries, then auto-calculate who owes whom" out of the box.

---

## Part 1 — Accounts you need (all free)

1. **Google Account** — you have one already.
2. **GitHub account** — https://github.com/join (free, used to host the app).
3. **Firebase** — no separate signup, sign in at https://console.firebase.google.com with your Google account (used for the free expense database).

That's it. No Play Console, no Apple Developer account, no Zello developer account.

---

## Part 2 — Install tools on your computer

You need exactly two things installed:

1. **Git** — https://git-scm.com/downloads (installer, accept defaults).
2. **A code editor** (optional but helpful) — VS Code, free: https://code.visualstudio.com

You do **not** need Flutter, Android Studio, Xcode, Node.js, or any build toolchain — this is plain HTML/CSS/JavaScript, no compilation step.

(One optional tool: **Node.js** https://nodejs.org, only if you want to run the included automated tests for the expense-splitting logic with `node settlement-engine.test.js`. Entirely optional — the app works without it.)

---

## Part 3 — Set up Firebase (free database for expenses)

1. Go to https://console.firebase.google.com → **Add project** → name it `group-travel-buddy` → finish the wizard (Google Analytics can be skipped).
2. In the left sidebar: **Build → Authentication → Get started → Sign-in method → Anonymous → Enable**. This lets each phone connect silently with no login screen, just enough so the app knows "this phone created this expense."
3. In the left sidebar: **Build → Firestore Database → Create database → Production mode** → pick a region close to you → Done.
4. Click the **gear icon → Project settings**, scroll to "Your apps", click the **`</>`  (web)** icon to register a web app. Name it anything (e.g. "Group Travel Buddy Web"). **Do not** check "set up Firebase Hosting" — we're using GitHub Pages instead.
5. Firebase will show you a config object that looks like this:
   ```js
   const firebaseConfig = {
     apiKey: "AIza...",
     authDomain: "group-travel-buddy-xxxxx.firebaseapp.com",
     projectId: "group-travel-buddy-xxxxx",
     storageBucket: "group-travel-buddy-xxxxx.appspot.com",
     messagingSenderId: "...",
     appId: "..."
   };
   ```
   Copy these values into **`firebase-config.js`** in this project, replacing each `"REPLACE_ME"`.

6. Deploy the included security rules so expense editing is properly locked down:
   ```bash
   npm install -g firebase-tools
   firebase login
   cd group-travel-buddy
   firebase init firestore
   ```
   When `firebase init` asks about `firestore.rules`, tell it to use the **existing** `firestore.rules` file already in this folder (don't let it overwrite it — choose "No" if asked to overwrite, since the correct rules are already written for you).
   ```bash
   firebase deploy --only firestore:rules
   ```

> **Why Firebase's free tier is safe here:** Firestore's free "Spark" plan has no billing attached at all — it just stops serving extra requests if you somehow exceed the daily free quota (tens of thousands of reads/writes per day), it never silently charges you. For a 6-person group used a couple of times a month, you will never come close to that limit.

---

## Part 4 — Put the project on GitHub

```bash
cd group-travel-buddy
git init
git add .
git commit -m "Initial commit"
```

On GitHub: **New repository** → name it `group-travel-buddy` → keep it **Public** (required for free GitHub Pages on a free GitHub account, and there's no sensitive data in this repo — the Firebase config is meant to be public) → create it without a README (you already have one) → then follow the page's instructions to push:

```bash
git remote add origin https://github.com/YOUR_USERNAME/group-travel-buddy.git
git branch -M main
git push -u origin main
```

---

## Part 5 — Deploy for free with GitHub Pages

1. On GitHub, open your repo → **Settings → Pages**.
2. Under "Build and deployment", set **Source: Deploy from a branch**.
3. Branch: `main`, folder: `/ (root)` → **Save**.
4. Wait a minute, then your app is live at:
   ```
   https://YOUR_USERNAME.github.io/group-travel-buddy/
   ```
5. Open that URL on your Android phone in Chrome. Tap the **⋮ menu → Add to Home screen**. Now it has an icon like any other app.

Whenever you push new commits to `main`, GitHub Pages redeploys automatically within a minute or two — no manual rebuild step.

---

## Part 6 — Using the app (first trip)

1. Whoever's organizing opens the app, types a **Trip Code** (e.g. `goa-2026` — just a shared password, doesn't need to be secret, just unique enough not to collide with someone else's trip), picks/adds their name, taps **Join / Create Trip**.
2. They fill in the **Destination** and paste the **shared Google Drive folder link** (create that folder the same way you do today — File → New folder in Drive, then Share → add everyone's email), tap **Save Trip Details**.
3. Organizer shares the Trip Code with the group over WhatsApp/text, same as you'd share anything else.
4. Everyone else opens the app, types the **same Trip Code**, picks their own name, taps **Join**. They now see the same destination and Drive folder automatically.
5. During the trip: tap **Start Navigation** to launch Google Maps with the destination preloaded; tap **Talk to Friends** to jump into your push-to-talk channel; tap **Open Shared Drive Folder** to upload photos; add expenses as they happen; tap **Calculate & Split** at the end of the trip to see who owes whom.

---

## Part 7 — Why I steered away from Streamlit, and the honest answer on Android Auto

**Streamlit:** Streamlit is built for Python data apps (dashboards, charts) that re-run a script on every interaction and are typically used at a desk. It's not designed for a touch-first, installable phone UI, doesn't support geolocation/PWA install/offline shell caching the way a plain web page does, and free Streamlit Community Cloud apps go to sleep after inactivity and take a few seconds to wake up — not great for a "tap a button while driving" use case. A plain static site on GitHub Pages does everything Streamlit would here, with none of those downsides, and is genuinely simpler to deploy (`git push` vs. connecting a Python repo to a hosting service).

**Android Auto:** I want to be straight with you here rather than overpromise — a web app/PWA **cannot** be projected onto the Android Auto screen. Android Auto only displays apps built against Google's official "Android for Cars App Library" using specific approved templates (navigation, messaging, media, parking/EV charging categories), and getting an app onto Android Auto requires native Android development plus a Google review process. That's a genuinely different, much bigger project than this one — not something achievable for free in a lean build. I'd recommend not chasing this for v1.

**Screen mirroring/casting (Smart View, Miracast, just propping your phone on a dash mount):** this needs **zero development work** — it works at the operating-system level for literally any app or webpage already, today, with no code changes from us. If your car or a casting app supports mirroring your phone screen, this PWA will mirror exactly like any other app would.

---

## Part 8 — Suggestions for improvement (optional, your call)

These are genuinely optional — the app above already covers everything in your "Solution design" section. Ideas if you want to extend it later, roughly ordered by how cheap/easy they are to add:

1. **QR code for the Trip Code** — instead of typing the code, scan a QR code. Can be done free client-side with a small JS QR library, no backend.
2. **"Mark as settled" on the settlement screen** — persist the calculated payments to Firestore so the group can tick off "BB paid AA" once it actually happens (currently the Calculate button is a live, recalculate-anytime view, not a saved record).
3. **Expense categories** (fuel/food/hotel/tickets) — easy addition to the form and a small pie-chart breakdown, still free.
4. **Multiple trips list** — a simple screen showing all trip codes you've previously joined (already stored in your browser), so you don't have to remember/retype old codes.
5. **A real PTT alternative if you ever want it embedded** (instead of just launching Zello) — Zello publishes a free, open WebSocket-based "zello-channel-api" SDK (https://github.com/zelloptt/zello-channel-api) for embedding push-to-talk into your own app. It's more development work (handling audio recording/streaming yourself) and is explicitly in beta, so I left it out of this lean build, but it's worth knowing it exists and is free if you want tighter integration later.
6. **Offline expense queuing** — Firestore already queues writes locally and syncs when you're back online, so this mostly already works; the main visible gap is the app not telling you clearly when you're offline. A small "you're offline, will sync later" banner would close that gap.

I did **not** add: native GPS-based live tracking inside the app (no public API for Google's consumer location sharing, and building your own tracking duplicates a feature you already have for free), in-app audio recording for PTT (Zello already does this better and for free), or a custom Drive uploader UI (Drive's own picker is already good and free).

---

## Project file reference

| File | Purpose |
|---|---|
| `index.html` | The single page — all 6 sections |
| `style.css` | Styling |
| `app.js` | All app logic: Firebase wiring, the 6 sections' button handlers |
| `firebase-config.js` | **You edit this** — your Firebase project's public web config |
| `settlement-engine.js` | Pure-function expense-splitting math, fully unit tested |
| `settlement-engine.test.js` | Run with `node settlement-engine.test.js` |
| `firestore.rules` | Security rules — deploy with `firebase deploy --only firestore:rules` |
| `manifest.json` | Makes the page installable as a home-screen app |
| `sw.js` | Service worker — caches the app shell so buttons still load with no signal |
| `icons/` | App icons for the home screen |
| `AGENT_TASKS.md` | A checklist written for an AI coding agent (e.g. Claude Cowork) to execute the parts of this setup that can be automated |
