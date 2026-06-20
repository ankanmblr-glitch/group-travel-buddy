// ============================================================================
// Group Travel Buddy — main app logic
// Vanilla JS, no build step. Loaded as a module directly by index.html.
// ============================================================================

import { firebaseConfig } from "./firebase-config.js";
import { calculateSettlement } from "./settlement-engine.js";

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import {
  getAuth,
  signInAnonymously,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  collection,
  addDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

// ---- Firebase init ---------------------------------------------------------
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

let currentUid = null;
let currentTripCode = localStorage.getItem("gtb_tripCode") || "";
let currentName = localStorage.getItem("gtb_name") || "";
let unsubscribeExpenses = null;
let unsubscribeTrip = null;
let latestExpenses = [];
let latestTripData = null;

const statusPill = document.getElementById("connection-status");

onAuthStateChanged(auth, (user) => {
  if (user) {
    currentUid = user.uid;
    statusPill.textContent = "online";
    statusPill.classList.add("online");
    if (currentTripCode) joinTrip(currentTripCode, { silent: true });
  } else {
    signInAnonymously(auth).catch((err) => {
      statusPill.textContent = "offline";
      statusPill.classList.add("offline");
      console.error("Anonymous sign-in failed:", err);
    });
  }
});

// ---- Helpers ---------------------------------------------------------------
function toast(message) {
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = message;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2500);
}

function getNameOptions() {
  const raw = localStorage.getItem("gtb_participantNames");
  return raw ? JSON.parse(raw) : ["AA", "BB", "CC", "DD", "EE", "FF"];
}

function saveNameOptions(names) {
  localStorage.setItem("gtb_participantNames", JSON.stringify(names));
}

function renderNameOptions() {
  const select = document.getElementById("your-name");
  const names = getNameOptions();
  select.innerHTML = names.map((n) => `<option value="${n}">${n}</option>`).join("");
  if (currentName && names.includes(currentName)) {
    select.value = currentName;
  }
}

// ---- Trip setup -------------------------------------------------------------
document.getElementById("add-name-btn").addEventListener("click", () => {
  const input = document.getElementById("new-name");
  const name = input.value.trim();
  if (!name) return;
  const names = getNameOptions();
  if (!names.includes(name)) {
    names.push(name);
    saveNameOptions(names);
    renderNameOptions();
    document.getElementById("your-name").value = name;
  }
  input.value = "";
});

document.getElementById("join-trip-btn").addEventListener("click", () => {
  const code = document.getElementById("trip-code").value.trim().toLowerCase().replace(/\s+/g, "-");
  const name = document.getElementById("your-name").value;
  if (!code) return toast("Enter a trip code first.");
  if (!name) return toast("Pick or add your name first.");
  currentName = name;
  localStorage.setItem("gtb_name", name);
  joinTrip(code);
});

async function joinTrip(code, opts = {}) {
  if (!currentUid) return; // wait for anonymous auth
  currentTripCode = code;
  localStorage.setItem("gtb_tripCode", code);
  document.getElementById("trip-code").value = code;
  document.getElementById("trip-details").classList.remove("hidden");

  const tripRef = doc(db, "trips", code);
  const snap = await getDoc(tripRef);
  if (!snap.exists()) {
    await setDoc(tripRef, {
      destination: "",
      driveFolderUrl: "",
      createdAt: serverTimestamp(),
    });
    if (!opts.silent) toast(`Trip "${code}" created. Share this code with your group.`);
  } else if (!opts.silent) {
    toast(`Joined trip "${code}".`);
  }

  if (unsubscribeTrip) unsubscribeTrip();
  unsubscribeTrip = onSnapshot(tripRef, (docSnap) => {
    latestTripData = docSnap.data() || {};
    document.getElementById("destination").value = latestTripData.destination || "";
    document.getElementById("drive-folder").value = latestTripData.driveFolderUrl || "";
  });

  subscribeExpenses(code);
}

document.getElementById("save-trip-btn").addEventListener("click", async () => {
  if (!currentTripCode) return toast("Join a trip first.");
  const destination = document.getElementById("destination").value.trim();
  const driveFolderUrl = document.getElementById("drive-folder").value.trim();
  await updateDoc(doc(db, "trips", currentTripCode), { destination, driveFolderUrl });
  toast("Trip details saved.");
});

// ---- Navigation (Google Maps deep link, no API key needed) -----------------
document.getElementById("navigate-btn").addEventListener("click", () => {
  const destination = (latestTripData && latestTripData.destination) || document.getElementById("destination").value;
  if (!destination) return toast("Set a destination in Trip Setup first.");

  if (!navigator.geolocation) {
    openMapsWithoutOrigin(destination);
    return;
  }

  toast("Getting your location…");
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const { latitude, longitude } = pos.coords;
      const url =
        `https://www.google.com/maps/dir/?api=1` +
        `&origin=${latitude},${longitude}` +
        `&destination=${encodeURIComponent(destination)}` +
        `&travelmode=driving`;
      window.location.href = url;
    },
    () => {
      toast("Couldn't get your location — opening Maps without it.");
      openMapsWithoutOrigin(destination);
    },
    { timeout: 5000 }
  );
});

function openMapsWithoutOrigin(destination) {
  const url = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}&travelmode=driving`;
  window.location.href = url;
}

// ---- Location sharing (just opens Maps) -------------------------------------
document.getElementById("open-maps-btn").addEventListener("click", () => {
  window.location.href = "https://www.google.com/maps";
});

// ---- Zello launch ------------------------------------------------------------
document.getElementById("open-zello-btn").addEventListener("click", () => {
  const fallback = encodeURIComponent("https://play.google.com/store/apps/details?id=com.loudtalks");
  const intentUrl = `intent://launch#Intent;package=com.loudtalks;S.browser_fallback_url=${fallback};end`;
  // Try the Android intent launch; if this device/browser doesn't support
  // intent: URIs (e.g. desktop testing), fall back to the Play Store link.
  const isAndroid = /Android/i.test(navigator.userAgent);
  if (isAndroid) {
    window.location.href = intentUrl;
  } else {
    window.open("https://zello.com/", "_blank");
  }
});

// ---- Drive folder open --------------------------------------------------------
document.getElementById("open-drive-btn").addEventListener("click", () => {
  const url = (latestTripData && latestTripData.driveFolderUrl) || document.getElementById("drive-folder").value;
  if (!url) return toast("Paste your shared Drive folder link in Trip Setup first.");
  window.open(url, "_blank");
});

// ---- Expenses -----------------------------------------------------------------
function subscribeExpenses(tripCode) {
  if (unsubscribeExpenses) unsubscribeExpenses();
  const expensesRef = collection(db, "trips", tripCode, "expenses");
  unsubscribeExpenses = onSnapshot(expensesRef, (snap) => {
    latestExpenses = [];
    snap.forEach((d) => latestExpenses.push({ id: d.id, ...d.data() }));
    renderExpenses();
  });
}

function renderExpenses() {
  const list = document.getElementById("expense-list");
  if (latestExpenses.length === 0) {
    list.innerHTML = `<p class="hint">No expenses added yet.</p>`;
    return;
  }
  list.innerHTML = latestExpenses
    .slice()
    .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0))
    .map((e) => {
      const isMine = e.ownerUid === currentUid;
      return `
        <div class="expense-row" data-id="${e.id}">
          <div>
            <div>${escapeHtml(e.description)} — ₹${Number(e.amount).toFixed(2)}</div>
            <div class="meta">paid by ${escapeHtml(e.paidByName)}</div>
          </div>
          ${isMine ? `<div class="actions">
            <button class="delete" data-action="delete" data-id="${e.id}">Delete</button>
          </div>` : ""}
        </div>`;
    })
    .join("");
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

document.getElementById("expense-list").addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-action='delete']");
  if (!btn) return;
  const id = btn.dataset.id;
  if (!currentTripCode) return;
  await deleteDoc(doc(db, "trips", currentTripCode, "expenses", id));
  toast("Expense deleted.");
});

document.getElementById("expense-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!currentTripCode) return toast("Join a trip first.");
  if (!currentUid) return toast("Still connecting, try again in a moment.");

  const description = document.getElementById("exp-desc").value.trim();
  const amount = parseFloat(document.getElementById("exp-amount").value);
  if (!description || isNaN(amount) || amount <= 0) return toast("Enter a valid description and amount.");

  await addDoc(collection(db, "trips", currentTripCode, "expenses"), {
    description,
    amount,
    paidByName: currentName,
    ownerUid: currentUid,
    createdAt: serverTimestamp(),
  });

  document.getElementById("expense-form").reset();
});

// ---- Settlement ------------------------------------------------------------
document.getElementById("calculate-btn").addEventListener("click", () => {
  const participants = getNameOptions();
  if (latestExpenses.length === 0) return toast("Add at least one expense first.");

  const result = calculateSettlement(latestExpenses, participants);
  const resultEl = document.getElementById("settlement-result");

  if (result.transactions.length === 0) {
    resultEl.innerHTML = `<p><strong>Total: ₹${result.total.toFixed(2)}</strong> — everyone is already even, no payments needed.</p>`;
    return;
  }

  resultEl.innerHTML =
    `<p><strong>Total: ₹${result.total.toFixed(2)}</strong> (₹${result.perPersonShare.toFixed(2)} per person)</p>` +
    result.transactions
      .map((t) => `<div class="settlement-line">${escapeHtml(t.from)} pays ${escapeHtml(t.to)} <strong>₹${t.amount.toFixed(2)}</strong></div>`)
      .join("");
});

// ---- Init --------------------------------------------------------------------
renderNameOptions();
if (currentTripCode) document.getElementById("trip-code").value = currentTripCode;
