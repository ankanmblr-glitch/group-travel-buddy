// ============================================================================
// app.js — Group Travel Buddy v2
// Role system: admin (?trip=X&admin=KEY) | participant (?trip=X&name=N) | setup
// ============================================================================

import { firebaseConfig }    from "./firebase-config.js";
import { calculateSettlement } from "./settlement-engine.js";

import { initializeApp }       from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import { getAuth, signInAnonymously, onAuthStateChanged }
  from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
  getFirestore, doc, getDoc, setDoc, updateDoc, deleteDoc,
  collection, addDoc, getDocs, onSnapshot, serverTimestamp, writeBatch,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

// ── Firebase init ───────────────────────────────────────────────────────────
const fbApp = initializeApp(firebaseConfig);
const auth  = getAuth(fbApp);
const db    = getFirestore(fbApp);

// ── URL-param role detection ────────────────────────────────────────────────
const params   = new URLSearchParams(window.location.search);
const urlTrip  = (params.get("trip")  || "").toLowerCase().trim();
const urlAdmin = (params.get("admin") || "").trim();   // admin key
const urlName  = (params.get("name")  || "").trim();   // participant name

// role: "setup" | "admin" | "participant"
let currentRole = urlTrip && urlAdmin ? "admin"
                : urlTrip && urlName  ? "participant"
                : "setup";

// ── State ───────────────────────────────────────────────────────────────────
let currentUid       = null;
let currentTripCode  = urlTrip  || "";
let currentName      = urlName  || "";    // participant's name (from URL)
let latestExpenses   = [];
let latestTripData   = null;
let editingExpenseId = null;
let unsubExpenses    = null;
let unsubTrip        = null;

const BASE_URL = window.location.origin + window.location.pathname;

// ── DOM refs ─────────────────────────────────────────────────────────────────
const statusPill = document.getElementById("connection-status");

// ── Auth ────────────────────────────────────────────────────────────────────
onAuthStateChanged(auth, async function(user) {
  if (user) {
    currentUid = user.uid;
    statusPill.textContent = "online";
    statusPill.className   = "status-pill online";
    await handleRoleInit();
  } else {
    signInAnonymously(auth).catch(function() {
      statusPill.textContent = "offline";
      statusPill.className   = "status-pill offline";
    });
  }
});

// ── Role init ────────────────────────────────────────────────────────────────
async function handleRoleInit() {
  if (currentRole === "setup") {
    showSetupMode();
  } else if (currentRole === "admin") {
    await verifyAndJoinAsAdmin();
  } else {
    await joinAsParticipant();
  }
}

// ── SETUP MODE ───────────────────────────────────────────────────────────────
function showSetupMode() {
  document.getElementById("setup-card").classList.remove("hidden");
}

document.getElementById("create-trip-btn").addEventListener("click", async function() {
  var code = document.getElementById("setup-trip-code").value.toLowerCase().trim();
  if (!code) { toast("Enter a trip code."); return; }

  var tripRef = doc(db, "trips", code);
  var snap    = await getDoc(tripRef);

  var adminKey;

  if (snap.exists() && snap.data().adminKey) {
    // Trip already exists — just redirect to its admin URL
    adminKey = snap.data().adminKey;
  } else if (snap.exists()) {
    // Old trip without adminKey — generate and save one
    adminKey = generateAdminKey();
    await updateDoc(tripRef, { adminKey: adminKey });
  } else {
    // Brand new trip
    adminKey = generateAdminKey();
    await setDoc(tripRef, {
      destination:    "",
      driveFolderUrl: "",
      members:        [],
      adminKey:       adminKey,
      createdAt:      serverTimestamp(),
    });
  }

  // Redirect to the admin URL — browser URL bar becomes the admin link,
  // and the trip-info card will display it permanently once loaded.
  window.location.href = BASE_URL + "?trip=" + encodeURIComponent(code) + "&admin=" + encodeURIComponent(adminKey);
});

// ── ADMIN VERIFICATION ───────────────────────────────────────────────────────
async function verifyAndJoinAsAdmin() {
  var tripRef = doc(db, "trips", urlTrip);
  var snap    = await getDoc(tripRef);
  if (!snap.exists()) {
    showError("Trip \"" + urlTrip + "\" not found. Check the link.");
    return;
  }
  var data = snap.data();
  if (data.adminKey && data.adminKey !== urlAdmin) {
    showError("Invalid admin key. Use the correct admin link.");
    return;
  }
  // If trip has no adminKey yet, set it now
  if (!data.adminKey) {
    await updateDoc(tripRef, { adminKey: urlAdmin });
  }
  subscribeAndShow(urlTrip);
}

// ── PARTICIPANT JOIN ─────────────────────────────────────────────────────────
async function joinAsParticipant() {
  subscribeAndShow(urlTrip);
}

// ── TRIP SUBSCRIPTION & SHOW ─────────────────────────────────────────────────
function subscribeAndShow(tripCode) {
  currentTripCode = tripCode;

  // Hide setup card
  document.getElementById("setup-card").classList.add("hidden");

  // Show role bar
  var bar = document.getElementById("role-bar");
  if (currentRole === "admin") {
    bar.textContent = "👑 Admin • Trip: " + tripCode;
    bar.className   = "role-bar admin-bar";
    document.getElementById("admin-panel-toggle").classList.remove("hidden");
  } else {
    bar.textContent = "👤 " + (currentName || "Participant") + " • Trip: " + tripCode;
    bar.className   = "role-bar participant-bar";
  }
  bar.classList.remove("hidden");

  // Show main sections (null-safe in case of stale browser cache)
  ["bulletin-card","trip-info-card","nav-card","loc-card","talk-card","drive-card","expense-card"].forEach(function(id) {
    var el = document.getElementById(id);
    if (el) el.classList.remove("hidden");
  });
  if (currentRole === "admin") {
    document.getElementById("admin-card").classList.remove("hidden");
    document.getElementById("danger-card").classList.remove("hidden");
  }

  // Wire bulletin board interactions (safe: only attaches once)
  attachBulletinListeners();

  // Subscribe to trip doc
  if (unsubTrip) unsubTrip();
  unsubTrip = onSnapshot(doc(db, "trips", tripCode), function(snap) {
    if (!snap.exists()) return;
    latestTripData = snap.data();
    renderBulletin();
    renderTripInfo();
    renderAdminPanel();
    renderSplitCheckboxes();
    populatePaidByDropdown();
  });

  // Subscribe to expenses
  subscribeExpenses(tripCode);
}

// ── BULLETIN BOARD ────────────────────────────────────────────────────────────
function renderBulletin() {
  var d       = latestTripData || {};
  var notices = Array.isArray(d.notices) ? d.notices : [];
  var el      = document.getElementById("bulletin-content");
  if (!el) return;

  if (currentRole === "admin") {
    var listHtml = notices.length === 0
      ? '<p class="hint" style="margin:4px 0">No announcements yet. Add one below.</p>'
      : '<div class="bulletin-admin-list">'
          + notices.map(function(n) {
              return '<div class="bulletin-item">'
                + '<span class="bulletin-text">' + esc(n.text) + '</span>'
                + '<div class="bulletin-actions">'
                + '<button class="btn-micro btn-micro-copy bul-edit" data-id="' + esc(n.id) + '" title="Edit">&#x270F;&#xFE0F;</button>'
                + '<button class="btn-micro bul-delete" data-id="' + esc(n.id) + '" title="Delete" style="background:#fdf0ef;color:var(--danger)">&#x2715;</button>'
                + '</div></div>';
            }).join("")
          + '</div>';

    el.innerHTML = listHtml
      + '<div class="bulletin-add-row">'
      + '<input id="bulletin-input" type="text" placeholder="New announcement&#x2026;" />'
      + '<button id="bulletin-add-btn" class="btn-icon">&#xFF0B;</button>'
      + '</div>';

  } else {
    // Participant: read-only bullet list
    if (notices.length === 0) {
      el.innerHTML = '<p class="hint" style="margin:4px 0">No announcements yet.</p>';
    } else {
      el.innerHTML = '<ul class="bulletin-list">'
        + notices.map(function(n) {
            return '<li>' + esc(n.text) + '</li>';
          }).join("")
        + '</ul>';
    }
  }
}

async function addBulletinItem() {
  var input = document.getElementById("bulletin-input");
  if (!input) return;
  var text = input.value.trim();
  if (!text) return;
  var notices = Array.isArray((latestTripData || {}).notices)
    ? latestTripData.notices.slice() : [];
  notices.push({ id: Math.random().toString(36).slice(2, 10), text: text });
  try {
    await updateDoc(doc(db, "trips", currentTripCode), { notices: notices });
    input.value = "";
    toast("Notice added.");
  } catch(e) { toast("Failed: " + e.message); }
}

var bulletinListenersAttached = false;

function attachBulletinListeners() {
  if (bulletinListenersAttached) return;
  var container = document.getElementById("bulletin-content");
  if (!container) return;

  container.addEventListener("click", async function(ev) {
    // Add button
    if (ev.target.closest("#bulletin-add-btn")) {
      addBulletinItem();
      return;
    }
    // Edit button
    var editBtn = ev.target.closest(".bul-edit");
    if (editBtn) {
      var id      = editBtn.dataset.id;
      var notices = Array.isArray((latestTripData || {}).notices) ? latestTripData.notices : [];
      var notice  = notices.find(function(n) { return n.id === id; });
      if (!notice) return;
      var newText = prompt("Edit notice:", notice.text);
      if (newText === null || newText.trim() === "") return;
      var updated = notices.map(function(n) {
        return n.id === id ? { id: n.id, text: newText.trim() } : n;
      });
      try {
        await updateDoc(doc(db, "trips", currentTripCode), { notices: updated });
        toast("Notice updated.");
      } catch(e) { toast("Failed: " + e.message); }
      return;
    }
    // Delete button
    var delBtn = ev.target.closest(".bul-delete");
    if (delBtn) {
      var id      = delBtn.dataset.id;
      var notices = Array.isArray((latestTripData || {}).notices) ? latestTripData.notices : [];
      if (!confirm("Delete this notice?")) return;
      var updated = notices.filter(function(n) { return n.id !== id; });
      try {
        await updateDoc(doc(db, "trips", currentTripCode), { notices: updated });
        toast("Notice deleted.");
      } catch(e) { toast("Failed: " + e.message); }
    }
  });

  container.addEventListener("keydown", function(e) {
    if (e.target.id === "bulletin-input" && e.key === "Enter") {
      e.preventDefault();
      addBulletinItem();
    }
  });

  bulletinListenersAttached = true;
}

// ── TRIP INFO RENDER ─────────────────────────────────────────────────────────
function renderTripInfo() {
  var d = latestTripData || {};
  var el = document.getElementById("trip-info-content");

  if (currentRole === "admin" || currentRole === "setup") {
    var adminUrl = BASE_URL + "?trip=" + encodeURIComponent(currentTripCode)
                            + "&admin=" + encodeURIComponent(d.adminKey || urlAdmin);
    el.innerHTML = [
      // Admin link box — always visible so admin can copy/bookmark it
      '<div class="link-box">',
        '<p class="hint" style="margin:0 0 6px"><strong>&#x1F511; Your admin link</strong> — bookmark this, keep it private:</p>',
        '<div class="link-display" id="admin-url-display">' + esc(adminUrl) + '</div>',
        '<button id="copy-admin-link-btn" class="btn-secondary" style="margin-top:8px;font-size:0.82rem">&#x1F4CB; Copy Admin Link</button>',
      '</div>',
      '<label>Destination</label>',
      '<input id="destination" type="text" value="' + esc(d.destination || "") + '" placeholder="e.g. Goa, India" />',
      '<label>Shared Google Drive folder link</label>',
      '<input id="drive-folder" type="url" value="' + esc(d.driveFolderUrl || "") + '" placeholder="Paste the shared folder URL" />',
      d.driveFolderUrl ? '<div class="link-box" style="margin-top:8px"><a href="' + esc(d.driveFolderUrl) + '" target="_blank" class="btn-secondary" style="display:inline-block;margin-top:0;text-decoration:none;padding:8px 14px;font-size:0.85rem">&#x1F4C1; Open Drive Folder &#x2197;</a></div>' : '',
      '<button id="save-trip-btn" class="btn-secondary" style="margin-top:12px">&#x1F4BE; Save Trip Details</button>',
    ].join("");
    document.getElementById("copy-admin-link-btn").addEventListener("click", function() {
      copyText(adminUrl, "Admin link copied!");
    });
    document.getElementById("save-trip-btn").addEventListener("click", saveTripDetails);
  } else {
    // Participant: read-only
    el.innerHTML = [
      '<div class="trip-detail-ro"><span>Welcome</span><strong>Hello, ' + esc(currentName) + '! 👋</strong></div>',
      '<div class="trip-detail-ro"><span>Trip code</span><strong>' + esc(currentTripCode) + '</strong></div>',
      '<div class="trip-detail-ro"><span>Destination</span><strong>' + esc(d.destination || "Not set yet") + '</strong></div>',
      d.driveFolderUrl
        ? '<a href="' + esc(d.driveFolderUrl) + '" target="_blank" class="btn-secondary" style="display:block;margin-top:10px;text-decoration:none;text-align:center">&#x1F4F7; Open Shared Drive Folder</a>'
        : '<p class="hint">Shared Drive folder not set yet.</p>',
    ].join("");
  }
}

async function saveTripDetails() {
  var dest  = (document.getElementById("destination")  || {}).value || "";
  var drive = (document.getElementById("drive-folder") || {}).value || "";
  try {
    await updateDoc(doc(db, "trips", currentTripCode), {
      destination:    dest.trim(),
      driveFolderUrl: drive.trim(),
    });
    toast("Trip details saved.");
  } catch(e) { toast("Save failed: " + e.message); }
}

// ── ADMIN PANEL TOGGLE ───────────────────────────────────────────────────────
var adminPanelVisible = true;
document.getElementById("admin-panel-toggle").addEventListener("click", function() {
  var card = document.getElementById("admin-card");
  adminPanelVisible = !adminPanelVisible;
  card.style.display = adminPanelVisible ? "" : "none";
});

// ── ADMIN PANEL RENDER ───────────────────────────────────────────────────────
function renderAdminPanel() {
  if (currentRole !== "admin") return;
  var list    = document.getElementById("admin-member-list");
  var members = getMembers();
  var contacts = getMemberContacts();

  if (members.length === 0) {
    list.innerHTML = '<p class="hint">No members yet. Add names below.</p>';
    return;
  }

  list.innerHTML = members.map(function(name) {
    var pUrl = BASE_URL + "?trip=" + encodeURIComponent(currentTripCode) + "&name=" + encodeURIComponent(name);
    var c    = contacts[name] || {};
    return [
      '<div class="admin-member-row">',
        '<div class="member-name-row">',
          '<span class="member-name">' + esc(name) + '</span>',
          '<div class="member-actions">',
            '<button class="btn-edit-member" data-action="edit" data-name="' + esc(name) + '">Edit</button>',
            '<button class="btn-delete-member" data-action="delete" data-name="' + esc(name) + '">✕</button>',
          '</div>',
        '</div>',
        '<div class="member-link-row">',
          '<span class="link-mini">' + esc(pUrl) + '</span>',
          '<button class="btn-micro btn-micro-copy" data-action="copy-link" data-url="' + esc(pUrl) + '" data-name="' + esc(name) + '">📋</button>',
          '<button class="btn-micro btn-micro-wa" data-action="whatsapp" data-name="' + esc(name) + '" data-url="' + esc(pUrl) + '" data-phone="' + esc(c.phone || "") + '">💬</button>',
        '</div>',
      '</div>',
    ].join("");
  }).join("");
}

document.getElementById("admin-member-list").addEventListener("click", async function(ev) {
  var btn    = ev.target.closest("[data-action]");
  if (!btn) return;
  var action = btn.dataset.action;
  var name   = btn.dataset.name;

  if (action === "copy-link") {
    copyText(btn.dataset.url, "Link for " + name + " copied!");
  } else if (action === "whatsapp") {
    sendInvite(name, btn.dataset.phone, btn.dataset.url);
  } else if (action === "edit") {
    var newName = prompt("Rename member:", name);
    if (!newName || newName.trim() === name) return;
    newName = newName.trim();
    var members = getMembers().map(function(m) { return m === name ? newName : m; });
    await updateDoc(doc(db, "trips", currentTripCode), { members: members });
    toast(name + " renamed to " + newName + ".");
  } else if (action === "delete") {
    if (!confirm("Remove " + name + " from trip?")) return;
    var members = getMembers().filter(function(m) { return m !== name; });
    await updateDoc(doc(db, "trips", currentTripCode), { members: members });
    toast(name + " removed.");
  }
});

document.getElementById("admin-add-btn").addEventListener("click", addMember);
document.getElementById("admin-new-name").addEventListener("keydown", function(e) {
  if (e.key === "Enter") { e.preventDefault(); addMember(); }
});

async function addMember() {
  var input = document.getElementById("admin-new-name");
  var name  = input.value.trim();
  if (!name) return;
  var members = getMembers();
  if (members.includes(name)) { toast(name + " already added."); return; }
  members.push(name);
  await updateDoc(doc(db, "trips", currentTripCode), { members: members });
  input.value = "";
  toast(name + " added.");
}

document.getElementById("admin-contacts-btn").addEventListener("click", async function() {
  if (!navigator.contacts || !navigator.contacts.select) {
    toast("Contacts API not available on this device/browser.");
    return;
  }
  try {
    var res = await navigator.contacts.select(["name","tel","email"], { multiple: false });
    if (!res || res.length === 0) return;
    var c    = res[0];
    var name = (c.name && c.name[0]) ? c.name[0].trim() : "";
    if (!name) { toast("No name found for this contact."); return; }
    var phone = (c.tel   && c.tel[0])   ? c.tel[0].replace(/\D/g, "") : "";
    var email = (c.email && c.email[0]) ? c.email[0].trim()            : "";
    saveMemberContact(name, { phone: phone, email: email });
    var members = getMembers();
    if (!members.includes(name)) {
      members.push(name);
      await updateDoc(doc(db, "trips", currentTripCode), { members: members });
    }
    var pUrl = BASE_URL + "?trip=" + encodeURIComponent(currentTripCode) + "&name=" + encodeURIComponent(name);
    sendInvite(name, phone, pUrl);
    toast(name + " added.");
  } catch(e) { toast("Could not access contacts."); }
});

function sendInvite(name, phone, participantUrl) {
  var drive = (latestTripData && latestTripData.driveFolderUrl) ? latestTripData.driveFolderUrl : "";
  var msg   = "Hi " + name + "! You have been invited on a road trip! 🚗\n"
            + "Join Group Travel Buddy with trip code: *" + currentTripCode + "*\n"
            + "Your personal app link: " + participantUrl
            + (drive ? "\n📁 Shared photos folder: " + drive : "");
  if (phone) {
    window.open("https://wa.me/" + phone.replace(/\D/g,"") + "?text=" + encodeURIComponent(msg), "_blank");
  } else if (navigator.share) {
    navigator.share({ title: "Trip invite", text: msg });
  } else {
    copyText(msg, "Invite message copied!");
  }
}

function getMemberContacts() {
  try { return JSON.parse(localStorage.getItem("gtb_contacts") || "{}"); } catch(e) { return {}; }
}
function saveMemberContact(name, info) {
  var c = getMemberContacts();
  c[name] = info;
  localStorage.setItem("gtb_contacts", JSON.stringify(c));
}

// ── NAVIGATION ────────────────────────────────────────────────────────────────
document.getElementById("navigate-btn").addEventListener("click", function() {
  var dest = (latestTripData && latestTripData.destination) ? latestTripData.destination : "";
  if (!dest) { toast("Destination not set yet. Admin needs to save trip details."); return; }
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(function(pos) {
      var url = "https://www.google.com/maps/dir/?api=1"
              + "&origin=" + pos.coords.latitude + "," + pos.coords.longitude
              + "&destination=" + encodeURIComponent(dest)
              + "&travelmode=driving";
      window.open(url, "_blank");
    }, function() { window.open("https://www.google.com/maps/dir/?api=1&destination=" + encodeURIComponent(dest) + "&travelmode=driving", "_blank"); });
  } else {
    window.open("https://www.google.com/maps/dir/?api=1&destination=" + encodeURIComponent(dest) + "&travelmode=driving", "_blank");
  }
});

// ── LOCATION ─────────────────────────────────────────────────────────────────
document.getElementById("open-maps-btn").addEventListener("click", function() {
  window.open("https://maps.google.com/", "_blank");
});

// ── TALK (PTT) ────────────────────────────────────────────────────────────────
document.getElementById("open-ptt-btn").addEventListener("click", function() {
  if (/Android/i.test(navigator.userAgent)) {
    window.location.href = "intent://launch#Intent;package=com.loudtalks;end";
  } else {
    toast("This button launches your push-to-talk app on Android.");
  }
});

// ── DRIVE ────────────────────────────────────────────────────────────────────
document.getElementById("open-drive-btn").addEventListener("click", function() {
  var url = latestTripData && latestTripData.driveFolderUrl;
  if (url) { window.open(url, "_blank"); }
  else     { toast("Drive folder URL not set yet."); }
});

// ── EXPENSES — subscribe ──────────────────────────────────────────────────────
function subscribeExpenses(tripCode) {
  if (unsubExpenses) unsubExpenses();
  var col = collection(db, "trips", tripCode, "expenses");
  unsubExpenses = onSnapshot(col, function(snap) {
    latestExpenses = snap.docs.map(function(d) {
      return Object.assign({ id: d.id }, d.data());
    });
    renderExpenses();
  });
}

// ── EXPENSES — paid-by dropdown / read-only field ─────────────────────────────
function populatePaidByDropdown() {
  var members = getMembers();
  var sel     = document.getElementById("exp-paidby");
  var ro      = document.getElementById("exp-paidby-ro");

  if (currentRole === "admin") {
    sel.innerHTML = members.map(function(m) {
      return '<option value="' + esc(m) + '">' + esc(m) + '</option>';
    }).join("");
    sel.classList.remove("hidden");
    ro.classList.add("hidden");
  } else {
    // Participant: name is read-only
    sel.classList.add("hidden");
    ro.textContent = currentName;
    ro.classList.remove("hidden");
  }
}

// ── EXPENSES — split checkboxes ───────────────────────────────────────────────
function renderSplitCheckboxes(preChecked) {
  var members = getMembers();
  var box     = document.getElementById("split-checkboxes");
  if (members.length === 0) {
    box.innerHTML = '<p class="hint" style="margin:4px 0">No members yet — admin must add them first.</p>';
    return;
  }
  var checked = preChecked || members; // default: all checked
  box.innerHTML = members.map(function(name) {
    var isChecked = checked.includes(name);
    return '<label class="split-cb-label">'
         + '<input type="checkbox" name="split" value="' + esc(name) + '"' + (isChecked ? " checked" : "") + ' />'
         + esc(name) + '</label>';
  }).join("");
}

function getSplitAmong() {
  var cbs = document.querySelectorAll('#split-checkboxes input[name="split"]:checked');
  return Array.from(cbs).map(function(cb) { return cb.value; });
}

document.getElementById("check-all-btn").addEventListener("click", function() {
  document.querySelectorAll('#split-checkboxes input[name="split"]').forEach(function(cb) { cb.checked = true; });
});
document.getElementById("check-none-btn").addEventListener("click", function() {
  document.querySelectorAll('#split-checkboxes input[name="split"]').forEach(function(cb) { cb.checked = false; });
});

// ── EXPENSES — add / update form ──────────────────────────────────────────────
document.getElementById("expense-form").addEventListener("submit", async function(ev) {
  ev.preventDefault();

  var desc      = document.getElementById("exp-desc").value.trim();
  var amount    = parseFloat(document.getElementById("exp-amount").value);
  var paidBy    = currentRole === "admin"
                  ? document.getElementById("exp-paidby").value
                  : currentName;
  var splitAmong = getSplitAmong();

  if (!desc || isNaN(amount) || amount <= 0) { toast("Fill in description and amount."); return; }
  if (!paidBy) { toast("Select who paid."); return; }
  if (splitAmong.length === 0) { toast("Select at least one person to split among."); return; }

  var col = collection(db, "trips", currentTripCode, "expenses");

  if (editingExpenseId) {
    // Update
    var existing = latestExpenses.find(function(e) { return e.id === editingExpenseId; });
    var canEdit  = currentRole === "admin" || (existing && existing.ownerUid === currentUid);
    if (!canEdit) { toast("You can only edit your own expenses."); return; }

    try {
      await updateDoc(doc(db, "trips", currentTripCode, "expenses", editingExpenseId), {
        description:   desc,
        amount:        amount,
        paidByName:    paidBy,
        splitAmong:    splitAmong,
        lastUpdatedBy: currentRole === "admin" ? ("admin/" + (currentName || "Admin")) : currentName,
        lastUpdatedAt: serverTimestamp(),
      });
      toast("Expense updated.");
      cancelEdit();
    } catch(e) { toast("Update failed: " + e.message); }

  } else {
    // Create
    try {
      await addDoc(col, {
        description: desc,
        amount:      amount,
        paidByName:  paidBy,
        splitAmong:  splitAmong,
        ownerUid:    currentUid,
        createdBy:   currentRole === "admin" ? ("admin/" + (currentName || "Admin")) : currentName,
        createdAt:   serverTimestamp(),
        lastUpdatedBy: null,
        lastUpdatedAt: null,
      });
      document.getElementById("exp-desc").value   = "";
      document.getElementById("exp-amount").value = "";
      renderSplitCheckboxes(); // reset to all checked
      toast("Expense added.");
    } catch(e) { toast("Save failed: " + e.message); }
  }
});

function startEdit(expense) {
  editingExpenseId = expense.id;
  document.getElementById("exp-desc").value   = expense.description || "";
  document.getElementById("exp-amount").value = expense.amount || "";
  if (currentRole === "admin") {
    document.getElementById("exp-paidby").value = expense.paidByName || "";
  }
  renderSplitCheckboxes(expense.splitAmong && expense.splitAmong.length > 0
    ? expense.splitAmong : getMembers());
  document.getElementById("edit-mode-banner").classList.remove("hidden");
  document.getElementById("expense-submit-btn").textContent = "Update Expense";
  document.getElementById("expense-cancel-btn").classList.remove("hidden");
  document.getElementById("expense-form").scrollIntoView({ behavior: "smooth" });
}

function cancelEdit() {
  editingExpenseId = null;
  document.getElementById("expense-form").reset();
  renderSplitCheckboxes();
  document.getElementById("edit-mode-banner").classList.add("hidden");
  document.getElementById("expense-submit-btn").textContent = "Add Expense";
  document.getElementById("expense-cancel-btn").classList.add("hidden");
  if (currentRole === "admin") {
    populatePaidByDropdown();
  }
}

document.getElementById("expense-cancel-btn").addEventListener("click", cancelEdit);

// ── EXPENSES — render list ────────────────────────────────────────────────────
function renderExpenses() {
  var list = document.getElementById("expense-list");
  if (latestExpenses.length === 0) {
    list.innerHTML = '<p class="hint" style="text-align:center">No expenses yet.</p>';
    return;
  }

  // Sort by createdAt ascending (oldest first)
  var sorted = latestExpenses.slice().sort(function(a, b) {
    var ta = a.createdAt && a.createdAt.seconds ? a.createdAt.seconds : 0;
    var tb = b.createdAt && b.createdAt.seconds ? b.createdAt.seconds : 0;
    return ta - tb;
  });

  list.innerHTML = sorted.map(function(e) {
    var canEdit   = currentRole === "admin" || e.ownerUid === currentUid;
    var members   = getMembers();
    var among     = (e.splitAmong && e.splitAmong.length > 0) ? e.splitAmong : members;
    var allMembers = members.length > 0 && among.length === members.length
                   && members.every(function(m) { return among.includes(m); });
    var splitStr  = allMembers ? "all" : among.join(", ");
    var auditStr  = "";
    if (e.createdBy) auditStr += "Added by " + e.createdBy + (e.createdAt ? " · " + fmtDate(e.createdAt) : "");
    if (e.lastUpdatedBy) auditStr += " | Edited by " + e.lastUpdatedBy;

    return [
      '<div class="expense-row">',
        '<div style="flex:1">',
          '<div><strong>' + esc(e.description) + '</strong> — &#x20B9;' + Number(e.amount || 0).toFixed(2) + '</div>',
          '<div class="meta">Paid by ' + esc(e.paidByName || "?") + '</div>',
          '<div class="expense-split-info">Split: ' + esc(splitStr) + '</div>',
          auditStr ? '<div class="expense-audit">' + esc(auditStr) + '</div>' : '',
        '</div>',
        canEdit ? [
          '<div class="actions" style="display:flex;gap:4px;flex-shrink:0">',
            '<button class="edit" data-id="' + e.id + '">&#x270F;&#xFE0F;</button>',
            '<button class="delete" data-id="' + e.id + '">&#x1F5D1;&#xFE0F;</button>',
          '</div>',
        ].join("") : '',
      '</div>',
    ].join("");
  }).join("");

  // Always auto-recalculate settlement whenever expenses change
  renderSettlement();
}

document.getElementById("expense-list").addEventListener("click", async function(ev) {
  var editBtn = ev.target.closest("button.edit");
  var delBtn  = ev.target.closest("button.delete");

  if (editBtn) {
    var e = latestExpenses.find(function(x) { return x.id === editBtn.dataset.id; });
    if (e) startEdit(e);
  }

  if (delBtn) {
    var e = latestExpenses.find(function(x) { return x.id === delBtn.dataset.id; });
    if (!e) return;
    var canDel = currentRole === "admin" || e.ownerUid === currentUid;
    if (!canDel) { toast("You can only delete your own expenses."); return; }
    if (!confirm("Delete \"" + e.description + "\"?")) return;
    try {
      await deleteDoc(doc(db, "trips", currentTripCode, "expenses", e.id));
      toast("Expense deleted.");
    } catch(err) { toast("Delete failed: " + err.message); }
  }
});

// ── SEE ALL EXPENSES ──────────────────────────────────────────────────────────
var seeAllOpen = false;
document.getElementById("see-all-btn").addEventListener("click", function() {
  seeAllOpen = !seeAllOpen;
  var view = document.getElementById("all-expenses-view");
  document.getElementById("see-all-btn").textContent = seeAllOpen ? "🔼 Hide Expenses" : "📋 See All Expenses";
  if (!seeAllOpen) { view.classList.add("hidden"); view.innerHTML = ""; return; }

  if (latestExpenses.length === 0) {
    view.innerHTML = '<p class="hint" style="margin-top:8px">No expenses recorded yet.</p>';
    view.classList.remove("hidden");
    return;
  }

  // Group by paidByName
  var grouped = {};
  var totals  = {};
  latestExpenses.forEach(function(e) {
    var n = e.paidByName || "?";
    if (!grouped[n]) { grouped[n] = []; totals[n] = 0; }
    grouped[n].push(e);
    totals[n] += Number(e.amount || 0);
  });

  var grandTotal = latestExpenses.reduce(function(s,e) { return s + Number(e.amount||0); }, 0);
  var members    = getMembers();

  var html = ['<div class="see-all-view">'];
  Object.keys(grouped).sort().forEach(function(name) {
    html.push('<div class="see-all-person">');
    html.push('<div class="see-all-person-header">👤 ' + esc(name) + ' — Total: ₹' + totals[name].toFixed(2) + '</div>');
    grouped[name].forEach(function(e) {
      var among = (e.splitAmong && e.splitAmong.length > 0) ? e.splitAmong : members;
      var allM  = members.length > 0 && among.length === members.length;
      html.push('<div class="see-all-expense-row">');
      html.push('<div>' + esc(e.description) + '<br><span class="see-all-split-tag">split: ' + esc(allM ? "all" : among.join(", ")) + '</span></div>');
      html.push('<div>₹' + Number(e.amount||0).toFixed(2) + '</div>');
      html.push('</div>');
    });
    html.push('</div>');
  });
  html.push('<div style="border-top:1px solid #ddd;padding-top:8px;font-weight:700;text-align:right">Grand Total: ₹' + grandTotal.toFixed(2) + '</div>');
  html.push('</div>');

  view.innerHTML = html.join("");
  view.classList.remove("hidden");
});

// ── SETTLEMENT ────────────────────────────────────────────────────────────────
function renderSettlement() {
  var members = getMembers();
  var el      = document.getElementById("settlement-result");
  if (members.length === 0 || latestExpenses.length === 0) {
    el.innerHTML = "";
    return;
  }

  var result = calculateSettlement(latestExpenses, members);

  // Check if any expense has partial splits
  var hasPartial = latestExpenses.some(function(e) {
    return e.splitAmong && e.splitAmong.length > 0 && e.splitAmong.length !== members.length;
  });

  var html = ['<p><strong>Total: &#x20B9;' + result.total.toFixed(2) + '</strong>'];
  if (!hasPartial) {
    html.push(' &nbsp;(&#x20B9;' + result.perPersonShare.toFixed(2) + ' per person)');
  }
  html.push('</p>');

  if (result.transactions.length === 0) {
    html.push('<div class="settlement-line">&#x2705; All settled up! No payments needed.</div>');
  } else {
    result.transactions.forEach(function(t) {
      html.push('<div class="settlement-line">&#x1F4B8; <strong>' + esc(t.from) + '</strong> pays <strong>' + esc(t.to) + '</strong> &#x20B9;' + t.amount.toFixed(2) + '</div>');
    });
  }

  el.innerHTML = html.join("");
}

document.getElementById("calculate-btn").addEventListener("click", function() {
  var members = getMembers();
  if (members.length === 0) { toast("No members added yet."); return; }
  if (latestExpenses.length === 0) { toast("No expenses recorded yet."); return; }
  renderSettlement();
});

// ── ADMIN DANGER ZONE ─────────────────────────────────────────────────────────
document.getElementById("delete-expenses-btn").addEventListener("click", async function() {
  if (!confirm("Delete ALL expenses? This cannot be undone.")) return;
  try {
    var col   = collection(db, "trips", currentTripCode, "expenses");
    var snap  = await getDocs(col);
    var batch = writeBatch(db);
    snap.docs.forEach(function(d) { batch.delete(d.ref); });
    await batch.commit();
    toast("All expenses deleted.");
  } catch(e) { toast("Error: " + e.message); }
});

document.getElementById("delete-trip-btn").addEventListener("click", async function() {
  if (!confirm("Delete the ENTIRE trip and all its data? This cannot be undone.")) return;
  if (!confirm("Last chance — permanently delete trip \"" + currentTripCode + "\" and all expenses?")) return;
  try {
    var col   = collection(db, "trips", currentTripCode, "expenses");
    var snap  = await getDocs(col);
    var batch = writeBatch(db);
    snap.docs.forEach(function(d) { batch.delete(d.ref); });
    batch.delete(doc(db, "trips", currentTripCode));
    await batch.commit();
    toast("Trip deleted. Redirecting...");
    setTimeout(function() { window.location.href = BASE_URL; }, 2000);
  } catch(e) { toast("Error: " + e.message); }
});

// ── HELPERS ───────────────────────────────────────────────────────────────────
function getMembers() {
  return (latestTripData && Array.isArray(latestTripData.members))
    ? latestTripData.members : [];
}

function esc(s) {
  return String(s || "")
    .replace(/&/g,"&amp;")
    .replace(/</g,"&lt;")
    .replace(/>/g,"&gt;")
    .replace(/"/g,"&quot;");
}

function toast(msg) {
  var t = document.createElement("div");
  t.textContent = msg;
  Object.assign(t.style, {
    position:"fixed", bottom:"20px", left:"50%", transform:"translateX(-50%)",
    background:"rgba(0,0,0,0.75)", color:"#fff", padding:"10px 18px",
    borderRadius:"20px", fontSize:"0.88rem", zIndex:9999, textAlign:"center",
    maxWidth:"90vw", boxShadow:"0 2px 8px rgba(0,0,0,0.3)",
  });
  document.body.appendChild(t);
  setTimeout(function() { t.remove(); }, 2800);
}

function copyText(text, successMsg) {
  navigator.clipboard.writeText(text)
    .then(function() { toast(successMsg || "Copied!"); })
    .catch(function() { toast("Copy failed — please copy manually."); });
}

function fmtDate(ts) {
  if (!ts) return "";
  var d = ts.toDate ? ts.toDate() : new Date((ts.seconds || 0) * 1000);
  return d.toLocaleDateString("en-IN", { day:"numeric", month:"short", hour:"2-digit", minute:"2-digit" });
}

function generateAdminKey() {
  return Math.random().toString(36).slice(2,10) + Math.random().toString(36).slice(2,6);
}

function showError(msg) {
  var main = document.querySelector("main");
  main.innerHTML = '<div class="card" style="text-align:center"><p style="color:var(--danger);font-weight:700">' + esc(msg) + '</p><p class="hint">Contact the trip admin for the correct link.</p></div>';
}
