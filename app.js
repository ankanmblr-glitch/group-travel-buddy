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
let isAdminMode = localStorage.getItem("gtb_adminMode") === "true";

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

// ---- Admin toggle -----------------------------------------------------------
const adminToggleBtn = document.getElementById("admin-toggle-btn");
const adminCard = document.getElementById("admin-card");

function applyAdminMode() {
  adminCard.style.display = isAdminMode ? "block" : "none";
  adminToggleBtn.classList.toggle("active", isAdminMode);
  if (isAdminMode) renderAdminPanel();
}

adminToggleBtn.addEventListener("click", () => {
  isAdminMode = !isAdminMode;
  localStorage.setItem("gtb_adminMode", isAdminMode);
  applyAdminMode();
  if (isAdminMode) toast("Admin mode on — manage your trip members.");
});

applyAdminMode();

// ---- Admin: member management -----------------------------------------------
function getMemberContacts() {
  const raw = localStorage.getItem("gtb_memberContacts");
  return raw ? JSON.parse(raw) : {};
}

function saveMemberContact(name, info) {
  const contacts = getMemberContacts();
  contacts[name] = info;
  localStorage.setItem("gtb_memberContacts", JSON.stringify(contacts));
}

function deleteMemberContact(name) {
  const contacts = getMemberContacts();
  delete contacts[name];
  localStorage.setItem("gtb_memberContacts", JSON.stringify(contacts));
}

function renderAdminPanel() {
  const list = document.getElementById("admin-member-list");
  const names = getNameOptions();
  const contacts = getMemberContacts();

  if (names.length === 0) {
    list.innerHTML = `<p class="hint">No members yet. Add some below.</p>`;
    return;
  }

  list.innerHTML = names.map((name) => {
    const c = contacts[name];
    const hasEmail = !!(c?.email);
    return `
      <div class="admin-member-row" data-name="${escapeHtml(name)}">
        <div>
          <span class="member-name">${escapeHtml(name)}</span>
          ${c ? `<span class="member-contact-hint">${escapeHtml(c.phone || c.email || "")}</span>` : ""}
        </div>
        <div class="member-actions">
          ${c ? `<button class="btn-invite-member" data-action="invite" data-name="${escapeHtml(name)}">Invite</button>` : ""}
          ${hasEmail ? `<button class="btn-share-drive-member" data-action="share-drive" data-name="${escapeHtml(name)}" title="Option B: grant Drive access to ${escapeHtml(c.email)}">📁 Share</button>` : ""}
          <button class="btn-edit-member"   data-action="edit"   data-name="${escapeHtml(name)}">Edit</button>
          <button class="btn-delete-member" data-action="delete" data-name="${escapeHtml(name)}">✕</button>
        </div>
      </div>`;
  }).join("");
}

document.getElementById("admin-member-list").addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-action]");
  if (!btn) return;
  const action = btn.dataset.action;
  const name = btn.dataset.name;

  if (action === "delete") {
    const names = getNameOptions().filter((n) => n !== name);
    saveNameOptions(names);
    deleteMemberContact(name);
    renderNameOptions();
    renderAdminPanel();
    toast(`${name} removed.`);

  } else if (action === "edit") {
    const newName = prompt(`Rename "${name}" to:`, name);
    if (!newName || newName.trim() === name) return;
    const trimmed = newName.trim();
    const names = getNameOptions().map((n) => (n === name ? trimmed : n));
    saveNameOptions(names);
    // migrate contact info to new name
    const contacts = getMemberContacts();
    if (contacts[name]) {
      contacts[trimmed] = contacts[name];
      delete contacts[name];
      localStorage.setItem("gtb_memberContacts", JSON.stringify(contacts));
    }
    renderNameOptions();
    renderAdminPanel();
    toast(`Renamed to ${trimmed}.`);

  } else if (action === "invite") {
    sendInvite(name);

  } else if (action === "share-drive") {
    // Option B: copy member's email to clipboard, then open the Drive folder
    // so the admin can paste it into Drive's "Share" dialog in one step.
    const c = getMemberContacts()[name];
    const email = c?.email || "";
    const driveUrl = latestTripData?.driveFolderUrl ||
                     document.getElementById("drive-folder").value.trim();

    if (!driveUrl) return toast("Save your Drive folder URL in Trip Setup first.");
    if (!email)    return toast("No email stored for this member.");

    if (navigator.clipboard) {
      navigator.clipboard.writeText(email)
        .then(() => toast(`📋 ${email} copied! Opening Drive — paste into the Share box.`))
        .catch(() => toast(`Share with: ${email} — opening Drive now.`));
    } else {
      // Fallback for browsers without clipboard API
      prompt(`Copy this email, then paste it into Drive's Share dialog:`, email);
    }
    // Small delay so the toast is visible before Drive opens
    setTimeout(() => window.open(driveUrl, "_blank"), 600);
  }
});

document.getElementById("admin-add-btn").addEventListener("click", () => {
  const input = document.getElementById("admin-new-name");
  const name = input.value.trim();
  if (!name) return toast("Enter a name first.");
  const names = getNameOptions();
  if (names.includes(name)) return toast(`${name} is already in the list.`);
  names.push(name);
  saveNameOptions(names);
  renderNameOptions();
  renderAdminPanel();
  input.value = "";
  toast(`${name} added.`);
});

document.getElementById("admin-contacts-btn").addEventListener("click", async () => {
  if (!("contacts" in navigator && "ContactsManager" in window)) {
    toast("Contact picker isn't supported on this browser. Try Chrome on Android.");
    return;
  }
  try {
    const results = await navigator.contacts.select(["name", "tel", "email"], { multiple: false });
    if (!results || results.length === 0) return;

    const contact = results[0];
    const pickedName = (contact.name?.[0] || "").trim();
    const phone = (contact.tel?.[0] || "").replace(/\s+/g, "");
    const email = contact.email?.[0] || "";

    if (!pickedName) return toast("Contact has no name — please add them manually.");

    const names = getNameOptions();
    if (!names.includes(pickedName)) {
      names.push(pickedName);
      saveNameOptions(names);
      renderNameOptions();
    }
    if (phone || email) saveMemberContact(pickedName, { phone, email });
    renderAdminPanel();
    toast(`${pickedName} added. Sending invite…`);
    sendInvite(pickedName);

  } catch (err) {
    toast("Couldn't open contacts: " + err.message);
  }
});

function sendInvite(memberName) {
  const tripCode = currentTripCode || "(ask organiser for code)";
  const appUrl = "https://ankanmblr-glitch.github.io/group-travel-buddy/";
  const driveUrl = latestTripData?.driveFolderUrl ||
                   document.getElementById("drive-folder").value.trim();
  const driveSection = driveUrl
    ? `\n📁 Access our shared photo folder: ${driveUrl}`
    : "";
  const message =
    `Ankan has invited you on this new exciting road trip! 🚗\n` +
    `Join us on Group Travel Buddy with trip code: *${tripCode}*\n` +
    `Open the app here: ${appUrl}` +
    driveSection;

  const contacts = getMemberContacts();
  const c = contacts[memberName];
  const phone = c?.phone?.replace(/\D/g, "") || "";

  if (phone) {
    // Direct WhatsApp link to this contact's number
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(message)}`, "_blank");
  } else if (navigator.share) {
    navigator.share({ text: message }).catch(() => {});
  } else {
    // Fallback: general WhatsApp share (user picks contact inside WhatsApp)
    window.open(`https://wa.me/?text=${encodeURIComponent(message)}`, "_blank");
  }
}

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
    updateDriveTip();
  });

  subscribeExpenses(code);
}

// Show Drive tip box whenever the Drive folder URL field has a value
function updateDriveTip() {
  const url = document.getElementById("drive-folder").value.trim();
  const tip = document.getElementById("drive-tip");
  tip.style.display = url ? "block" : "none";
}
document.getElementById("drive-folder").addEventListener("input", updateDriveTip);

// Option A: "Open Drive →" button opens the folder so admin can change sharing mode
document.getElementById("drive-open-share-btn").addEventListener("click", () => {
  const url = document.getElementById("drive-folder").value.trim() ||
              latestTripData?.driveFolderUrl;
  if (!url) return toast("Paste a Drive folder URL first.");
  window.open(url, "_blank");
});

document.getElementById("save-trip-btn").addEventListener("click", async () => {
  if (!currentTripCode) return toast("Join a trip first.");
  const destination = document.getElementById("destination").value.trim();
  const driveFolderUrl = document.getElementById("drive-folder").value.trim();
  await updateDoc(doc(db, "trips", currentTripCode), { destination, driveFolderUrl });
  updateDriveTip();
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
  const isAndroid = /Android/i.test(navigator.userAgent);
  if (isAndroid) {
    // Use Zello's custom URL scheme — launches the app directly if installed.
    window.location.href = "zello://";
    // If Zello isn't installed the page won't leave, so after 2 s redirect to
    // the Play Store. If the app DID open the window loses focus first and we
    // cancel the timer so the user isn't bounced to the Store on return.
    const fallbackTimer = setTimeout(() => {
      window.location.href =
        "https://play.google.com/store/apps/details?id=com.loudtalks";
    }, 2000);
    window.addEventListener("blur", () => clearTimeout(fallbackTimer), { once: true });
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
