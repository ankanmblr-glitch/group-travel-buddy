# AGENT_TASKS.md — Instructions for an AI coding agent (e.g. Claude Cowork)

This file is written so an AI agent with file/terminal/browser access can pick up this project and carry out the parts that are safe to automate. It is split into two kinds of tasks:

- **🤖 AGENT CAN DO** — file edits, git commands, local testing. Safe to execute autonomously.
- **🧑 HUMAN MUST DO** — anything involving logging into an account, entering a password, or accepting Google/GitHub OAuth/Terms screens. No AI agent should create accounts, type passwords, or click through identity verification on a person's behalf — these steps need the human physically at the keyboard. The agent should pause and clearly ask the human to complete these, then continue once told they're done.

Work through tasks in order. Do not skip the human-gated steps — wait for explicit confirmation that each one is complete before moving to the step that depends on it.

---

## Phase 1 — Firebase project (🧑 human-gated, then 🤖 agent-assisted)

1. 🧑 **Human:** Sign in to https://console.firebase.google.com, create a project named `group-travel-buddy`, enable **Authentication → Anonymous**, enable **Firestore Database** (production mode), and register a **Web app** under Project Settings → Your apps. Copy the resulting `firebaseConfig` object values.
2. 🤖 **Agent:** Once the human pastes the six config values into chat, edit `firebase-config.js` in this project, replacing each `"REPLACE_ME"` with the real value. Do not invent or guess values — wait for the human to supply them.
3. 🧑 **Human:** Run `firebase login` in a terminal (this opens a browser OAuth consent screen the human must approve themselves).
4. 🤖 **Agent:** After the human confirms they're logged in, run:
   ```bash
   firebase init firestore
   ```
   When prompted about `firestore.rules`, do **not** overwrite the existing file in this repo — it already contains the correct rules. Then run:
   ```bash
   firebase deploy --only firestore:rules
   ```
   Confirm the deploy succeeded by checking the command output for a success message.

---

## Phase 2 — Local verification (🤖 fully automatable)

1. Run the settlement engine tests and confirm all pass:
   ```bash
   node settlement-engine.test.js
   ```
2. Serve the app locally to sanity-check it loads (any static server works, e.g.):
   ```bash
   python3 -m http.server 8000
   ```
   Then report the local URL (`http://localhost:8000`) back to the human so they can open it in a browser and click through the 6 sections once before deploying. Note: Firebase features (anonymous auth, Firestore) will not fully work until Phase 1 is complete with real config values, and Geolocation/intent-launch buttons need to be tested on an actual Android phone, not a desktop browser.

---

## Phase 3 — GitHub repo (🧑 human-gated, then 🤖 agent-assisted)

1. 🧑 **Human:** Create a GitHub account if you don't have one (https://github.com/join), then create a new **empty, public** repository named `group-travel-buddy` (no README/license, this project already has one). Provide the agent with the repo's HTTPS clone URL.
2. 🤖 **Agent:** From the project root, run:
   ```bash
   git init
   git add .
   git commit -m "Initial commit: Group Travel Buddy PWA"
   git remote add origin <REPO_URL_FROM_HUMAN>
   git branch -M main
   git push -u origin main
   ```
   Note: the `git push` step may require the human to authenticate (GitHub username + a Personal Access Token, since GitHub no longer accepts plain passwords for git operations over HTTPS). If the push prompts for credentials, pause and ask the human to either authenticate interactively or provide a Personal Access Token via a secure method — do not ask them to paste a token directly into chat.

---

## Phase 4 — Enable GitHub Pages (🧑 human-gated)

1. 🧑 **Human:** On GitHub, go to the repo's **Settings → Pages**, set Source to "Deploy from a branch", branch `main`, folder `/ (root)`, save.
2. 🧑 **Human:** Wait ~1 minute, then confirm the live URL (`https://<username>.github.io/group-travel-buddy/`) loads correctly, ideally on an actual Android phone.
3. 🤖 **Agent:** If the human reports anything broken (blank page, console errors), use browser dev tools / `Claude in Chrome` tooling if available to inspect the deployed page's console output and diagnose, then propose a fix as a normal file edit + git commit + push.

---

## Phase 5 — Ongoing changes (🤖 fully automatable once Phases 1–4 are done)

For any future feature requests (see README.md "Suggestions for improvement" for ideas already scoped out), the agent can:
1. Edit the relevant file(s) directly (`app.js`, `style.css`, `index.html`, `settlement-engine.js`).
2. Add/update tests in `settlement-engine.test.js` if the change touches expense-splitting logic, and run `node settlement-engine.test.js` to confirm they pass before committing.
3. `git add`, `git commit`, `git push` — GitHub Pages redeploys automatically within a minute or two of any push to `main`. No build step, no manual deployment action needed.

No further human-gated steps are needed after Phase 4 unless the human wants to change Firebase project settings (e.g. add a new sign-in method) or rotate credentials — those always stay human-only.

---

## Hard constraints for any agent working on this repo

- Never commit real passwords, API secrets requiring confidentiality, or `.env` files containing private keys. (Note: `firebase-config.js`'s values are *not* secret — Firebase web config is meant to be public — so this file is fine to commit as-is.)
- Never modify `firestore.rules` to make expense editing less restrictive (e.g. removing the `ownerUid` check) without the human explicitly asking for that change and understanding the tradeoff.
- Never attempt to programmatically create the Firebase project, GitHub account, or Play Console account — these remain human-only steps per the constraints above.
- Keep the app dependency-free and build-step-free unless the human explicitly asks for a framework — that's a deliberate "lean" design choice, not an oversight.
