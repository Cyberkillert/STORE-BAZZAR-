// Store Bazar — app.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, signInWithPopup, GoogleAuthProvider, signOut, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, collection, addDoc, getDocs, doc, getDoc, setDoc,
  updateDoc, query, where, orderBy, serverTimestamp, onSnapshot, deleteDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// ── CONFIG — PASTE YOUR FIREBASE VALUES BELOW ───────────
const firebaseConfig = {
  apiKey: "AIzaSyCz1RrqPg47qT4oTGa9jZ26E_LICzIXC3I",
  authDomain: "any-name-cbf7a.firebaseapp.com",
  databaseURL: "https://any-name-cbf7a-default-rtdb.firebaseio.com",
  projectId: "any-name-cbf7a",
  storageBucket: "any-name-cbf7a.firebasestorage.app",
  messagingSenderId: "1058241604652",
  appId: "1:1058241604652:web:00d8d3b010adba4b1e7589",
  measurementId: "G-99RKGK70B9"
};
const IMGBB_KEY = "255727ed9cb6df2949755773d660d671255727ed9cb6df2949755773d660d671";

// ── DETECT PLACEHOLDER CONFIG ────────────────────────────
const _isConfigured = !firebaseConfig.apiKey.startsWith("PASTE");

// ── INIT ────────────────────────────────────────────────
let app, auth, db;
if (_isConfigured) {
  try {
    app  = initializeApp(firebaseConfig);
    auth = getAuth(app);
    db   = getFirestore(app);
  } catch(e) {
    console.error("Firebase init failed:", e);
    db = null; auth = null;
  }
} else {
  // Config not yet set — db and auth remain undefined/null
  console.warn("⚠️ Firebase config not set. Paste your config into app.js");
}

let currentUser = null, userDoc = null;
let allProducts = [], allCategories = [];
let cart = []; // [{product, qty}]
let activeCategory = null;
let selectedImages = [];
let uploadsEnabled = true; // controlled by admin

// ── AUTH ─────────────────────────────────────────────────
const googleProvider = new GoogleAuthProvider();
let isGuest = false;          // true when user skipped sign-in
let pendingCheckout = false;  // true when guest tried to checkout

// ── Main sign-in button (on the initial auth screen)
document.getElementById("googleSignInBtn").addEventListener("click", async () => {
  const errEl = document.getElementById("authError");
  errEl.classList.add("hidden");
  try { await signInWithPopup(auth, googleProvider); }
  catch(e) { errEl.textContent = "Sign in failed: " + (e.message||e.code); errEl.classList.remove("hidden"); }
});

// ── Browse as Guest
document.getElementById("browseGuestBtn").addEventListener("click", () => {
  isGuest = true;
  hideAuth(); // immediately hide auth screen and show app
  loadCart("guest");
  setupGuestApp();
});

// ── Sign-in gate modal (shown when guest tries to checkout)
document.getElementById("gateGoogleBtn").addEventListener("click", async () => {
  const errEl = document.getElementById("gateAuthError");
  errEl.classList.add("hidden");
  try {
    await signInWithPopup(auth, googleProvider);
    // onAuthStateChanged will fire and handle merging + proceeding
  } catch(e) {
    errEl.textContent = "Sign in failed: " + (e.message||e.code);
    errEl.classList.remove("hidden");
  }
});
document.getElementById("gateCancelBtn").addEventListener("click", () => {
  pendingCheckout = false;
  hideSignInGate();
});

document.getElementById("blockedLogoutBtn").addEventListener("click", () => doSignOut());
document.getElementById("logoutBtn").addEventListener("click", () => doSignOut());

async function doSignOut() {
  cart = []; saveCart();
  isGuest = false; pendingCheckout = false;
  if (auth) await signOut(auth);
  location.reload();
}

if (auth) {
  onAuthStateChanged(auth, async user => {
    if (!user) {
      hidePageLoading();
      if (!isGuest) showAuth();
      return;
    }

    // ── Session found: hide loader and auth immediately
    currentUser = user;
    isGuest = false;
    hidePageLoading();
    hideSignInGate();
    hideAuth();

    try {
      const guestCart = loadCartRaw("guest");
      await saveUserProfile(user);
      userDoc = await loadUserDoc(user.uid);
      if (userDoc?.blocked) { showBlocked(); return; }

      loadCart(user.uid);
      if (guestCart.length) {
        guestCart.forEach(gi => {
          const existing = cart.find(c => c.productId === gi.productId);
          if (existing) existing.qty = Math.min(existing.qty + gi.qty, gi.maxQty || 999);
          else cart.push(gi);
        });
        saveCart();
        localStorage.removeItem("sb_cart_guest");
        updateCartCount();
        showToast(`🛒 ${guestCart.reduce((s,i)=>s+i.qty,0)} cart item(s) kept`);
      }

      if (!window._appBooted) {
        window._appBooted = true;
        setupApp();
      } else {
        setNavUser();
        updateUploadUI();
        listenForNotification(user.uid);
        listenForSettings();
      }

      if (pendingCheckout) {
        pendingCheckout = false;
        setTimeout(() => openCheckout(), 300);
      }
    } catch(e) {
      console.error("Post-auth setup error:", e);
    }
  });
} else {
  // ── Firebase NOT configured ──────────────────────────
  // Still show the app in "no-firebase" mode so it doesn't appear broken
  hidePageLoading();
  showAuth();
  const errEl = document.getElementById("authError");
  if (errEl) {
    errEl.innerHTML = `⚠️ Firebase not configured.<br/><small>Paste your config into <code>app.js</code> to enable sign-in and data loading.</small>`;
    errEl.classList.remove("hidden");
  }
}

// ── Guest app setup (limited — no orders, no upload, no sell nav)
function setNavGuest() {
  // Show guest badge next to brand
  const brand = document.getElementById("navBrandBtn");
  if (brand && !brand.querySelector(".guest-badge")) {
    const badge = document.createElement("span");
    badge.className = "guest-badge";
    badge.textContent = "Guest";
    brand.appendChild(badge);
  }
  // Replace avatar letter with guest icon
  const letter = document.getElementById("navAvatarLetter");
  if (letter) letter.textContent = "👤";
  // Change signout button to sign-in prompt
  const signoutBtn = document.getElementById("logoutBtn");
  if (signoutBtn) {
    signoutBtn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg>`;
    signoutBtn.title = "Sign in";
    signoutBtn.onclick = (e) => { e.stopPropagation(); showSignInGate(false); };
  }
}

async function saveUserProfile(user) {
  if (!db) return;
  const ref = doc(db, "users", user.uid);
  const snap = await getDoc(ref);
  const now = new Date().toISOString();
  if (!snap.exists()) {
    await setDoc(ref, {
      uid: user.uid,
      name: user.displayName || "",
      email: user.email || "",
      photoURL: user.photoURL || "",
      joinedAt: now,
      lastLogin: now,
      blocked: false,
      uploadsEnabled: true
    });
  } else {
    await updateDoc(ref, { lastLogin: now, name: user.displayName||"", photoURL: user.photoURL||"" });
  }
}

async function loadUserDoc(uid) {
  if (!db) return null;
  try { const s = await getDoc(doc(db,"users",uid)); return s.exists()?s.data():null; }
  catch(e){ return null; }
}

function showAuth() {
  document.getElementById("authModal").classList.add("active");
  document.getElementById("authModal").style.display = "";
  document.getElementById("app").classList.add("hidden");
  document.getElementById("blockedModal").classList.remove("active");
  document.getElementById("signInGateModal")?.classList.remove("active");
}
function hideAuth() {
  document.getElementById("authModal").classList.remove("active");
  document.getElementById("authModal").style.display = "none";
  document.getElementById("blockedModal").classList.remove("active");
  document.getElementById("blockedModal").style.display = "none";
  document.getElementById("app").classList.remove("hidden");
}
function showBlocked() {
  document.getElementById("authModal").classList.remove("active");
  document.getElementById("authModal").style.display = "none";
  document.getElementById("app").classList.add("hidden");
  document.getElementById("blockedModal").classList.add("active");
  document.getElementById("blockedModal").style.display = "flex";
}
function showSignInGate(fromCheckout = true) {
  pendingCheckout = fromCheckout;
  document.getElementById("gateAuthError").classList.add("hidden");
  const g = document.getElementById("signInGateModal");
  g.classList.add("active");
  g.classList.remove("hidden");
  g.style.display = "flex";
}
function hideSignInGate() {
  const g = document.getElementById("signInGateModal");
  g.classList.remove("active");
  g.classList.add("hidden");
  g.style.display = "none";
}
function hidePageLoading() {
  const l = document.getElementById("pageLoading");
  if (!l) return;
  l.classList.add("fade-out");
  setTimeout(() => l.classList.add("gone"), 300);
}

// ── SETUP ────────────────────────────────────────────────
// ── Guard flags to prevent duplicate listener registration
let _navSetup = false, _cartSetup = false, _uploadSetup = false;
let _orderTabsSetup = false, _checkoutSetup = false, _searchSetup = false;

function setupApp() {
  setNavUser();
  setupNavigation();
  setupSearch();
  setupCart();
  setupUploadForm();
  setupOrderTabs();
  setupCheckout();
  // Load data — await both so categories get product counts right
  loadProducts().then(() => {
    loadCategories();
  });
}

function setupGuestApp() {
  window._appBooted = true;
  setNavGuest();
  setupNavigation();
  setupSearch();
  setupCart();
  setupUploadForm();
  setupOrderTabs();
  setupCheckout();
  loadProducts().then(() => {
    loadCategories();
  });
}

function setNavUser() {
  const img = document.getElementById("navAvatarImg");
  const letter = document.getElementById("navAvatarLetter");
  if (currentUser?.photoURL) {
    img.src = currentUser.photoURL;
    img.classList.remove("hidden");
    letter.classList.add("hidden");
  } else {
    const name = currentUser?.displayName || currentUser?.email || "U";
    letter.textContent = name[0].toUpperCase();
  }
}

// ── SETTINGS LISTENER ───────────────────────────────────
function listenForSettings() {
  if (!db) return;
  onSnapshot(doc(db, "settings", "global"), snap => {
    if (!snap.exists()) return;
    const d = snap.data();
    uploadsEnabled = d.uploadsEnabled !== false;
    if (d.defaultImgLimit) window._globalImgLimit = d.defaultImgLimit;
    if (userDoc?.uploadsEnabled === false) uploadsEnabled = false;
    updateUploadUI();
    // Update image hint text
    const hint = document.querySelector(".drop-ph small");
    if (hint) hint.textContent = `PNG, JPG · Max ${getImgLimit()} images`;
  });
  // Also watch per-user uploads flag
  if (currentUser) {
    onSnapshot(doc(db,"users",currentUser.uid), snap => {
      if (!snap.exists()) return;
      userDoc = snap.data();
      if (userDoc.blocked) { doSignOut(); return; }
      uploadsEnabled = userDoc.uploadsEnabled !== false;
      updateUploadUI();
      // Check for new notifications
    });
  }
}

function updateUploadUI() {
  const banner = document.getElementById("uploadDisabledBanner");
  const form   = document.getElementById("uploadFormWrap");
  if (!uploadsEnabled) {
    banner?.classList.remove("hidden");
    form?.querySelectorAll("input,select,textarea,button[type=submit]").forEach(el => el.disabled = true);
  } else {
    banner?.classList.add("hidden");
    form?.querySelectorAll("input,select,textarea,button[type=submit]").forEach(el => el.disabled = false);
  }
}

// ── NOTIFICATION LISTENER ────────────────────────────────
function listenForNotification(uid) {
  if (!db) return;
  try {
    const q = query(collection(db,"notifications"), where("userId","==",uid), where("read","==",false), orderBy("createdAt","desc"));
    onSnapshot(q, snap => {
      if (snap.empty) return;
      const latest = snap.docs[0].data();
      showNotifBanner(latest.message, snap.docs[0].id);
    }, err => {
      // Index may not exist yet — try simpler query
      const q2 = query(collection(db,"notifications"), where("userId","==",uid), where("read","==",false));
      onSnapshot(q2, snap => {
        if (snap.empty) return;
        const latest = snap.docs[0].data();
        showNotifBanner(latest.message, snap.docs[0].id);
      }, () => {}); // silently ignore if this also fails
    });
  } catch(e) {}
}

function showNotifBanner(msg, notifId) {
  const banner = document.getElementById("notifBanner");
  document.getElementById("notifText").textContent = msg;
  banner.classList.remove("hidden");
  document.getElementById("notifClose").onclick = async () => {
    banner.classList.add("hidden");
    if (db && notifId) {
      try { await updateDoc(doc(db,"notifications",notifId), { read: true }); } catch(e){}
    }
  };
}

// ── NAVIGATION — Tab system ───────────────────────────────
let currentTab = "home";
let previousTab = "home"; // to return from product view

function switchTab(tab) {
  // Gate sell/orders for guests
  if ((tab === "sell" || tab === "orders") && (isGuest || !currentUser)) {
    const desc = tab === "sell" ? "Sign in to list and sell products." : "Sign in to view your orders.";
    document.getElementById("gateModalDesc").textContent = desc + " Your cart will be saved.";
    showSignInGate(false);
    return;
  }

  if (tab === "orders") loadOrders();
  // Re-render categories every time that tab is opened (so product counts are fresh)
  if (tab === "categories") renderCategories();

  currentTab = tab;

  document.querySelectorAll(".tab-view").forEach(v => { v.classList.remove("active"); v.classList.add("hidden"); });

  const tabMap = {
    home: "homeTab",
    categories: "categoriesTab",
    sell: "sellTab",
    orders: "ordersTab",
    product: "productPage",
    search: "searchPage",
    review: "reviewPage",
    checkout: "checkoutPage"
  };
  const el = document.getElementById(tabMap[tab] || tab + "Tab");
  if (el) { el.classList.remove("hidden"); el.classList.add("active"); }

  document.querySelectorAll(".nav-tab, .mob-btn").forEach(b => b.classList.remove("active"));
  document.querySelectorAll(`[data-tab="${tab}"]`).forEach(b => b.classList.add("active"));

  window.scrollTo({ top: 0, behavior: "smooth" });
}
window.switchTab = switchTab;

// Legacy navigate() alias used elsewhere in code
function navigate(page) { switchTab(page); }
window.navigate = navigate;

function setupNavigation() {
  if (_navSetup) return;
  _navSetup = true;
  // Desktop nav tabs
  document.querySelectorAll(".nav-tab[data-tab]").forEach(btn => {
    btn.addEventListener("click", () => switchTab(btn.dataset.tab));
  });
  // Mobile nav tabs
  document.querySelectorAll(".mob-btn[data-tab]").forEach(btn => {
    btn.addEventListener("click", () => switchTab(btn.dataset.tab));
  });
  // Brand logo → home
  document.getElementById("navBrandBtn")?.addEventListener("click", () => switchTab("home"));
}
window.navigate = navigate;

// ── CATEGORIES ────────────────────────────────────────────
async function loadCategories() {
  if (!db) {
    // No Firebase — show empty state with message
    const grid = document.getElementById("categoriesGrid");
    if (grid) grid.innerHTML = `<div style="color:var(--text3);font-size:13px;padding:24px 0;grid-column:1/-1">Connect Firebase to see categories.</div>`;
    return;
  }
  try {
    let snap;
    // Try simplest query first (no index needed)
    try {
      snap = await getDocs(collection(db, "categories"));
    } catch(e) {
      console.warn("categories load failed:", e.message);
      return;
    }
    allCategories = snap.docs
      .map(d => ({id:d.id, ...d.data()}))
      .filter(c => c.active !== false)
      .sort((a,b) => (a.order||0) - (b.order||0));
    renderCategories();
    populateCategorySelect();
  } catch(e) {
    console.warn("loadCategories error:", e.message);
  }
}

function renderCategories() {
  const grid = document.getElementById("categoriesGrid");
  if (!grid) return;

  if (!allCategories.length) {
    grid.innerHTML = `
      <div class="empty-state">
        📭 No categories yet. Admin can add them.
      </div>`;
    return;
  }

  // product count
  const counts = {};
  allProducts.forEach(p => {
    if (!p.category) return;
    counts[p.category] = (counts[p.category] || 0) + 1;
  });

  grid.innerHTML = allCategories.map(c => {
    const count = counts[c.name] || 0;

    // icon support (emoji + image URL)
    let iconHTML = "📦";
    if (c.icon) {
      if (c.icon.startsWith("http")) {
        iconHTML = `<img src="${c.icon}" alt="${c.name}" loading="lazy">`;
      } else {
        iconHTML = c.icon;
      }
    }

    return `
      <div class="cat-card-full" data-cat="${c.name}">
        <div class="cat-icon">${iconHTML}</div>
        <div class="cat-name">${c.name}</div>
        <div class="cat-count">
          ${count} product${count !== 1 ? "s" : ""}
        </div>
      </div>
    `;
  }).join("");

  // click
  grid.querySelectorAll(".cat-card-full").forEach(card => {
    card.addEventListener("click", () => {
      openCategoryProducts(card.dataset.cat);
    });
  });
}

function openCategoryProducts(cat) {
  // Show products filtered by category within categories tab
  document.getElementById("catProductsSection").classList.remove("hidden");
  document.getElementById("catProductsHeading").textContent = cat;
  document.querySelectorAll(".cat-card-full").forEach(c => c.classList.remove("active"));
  document.querySelector(`.cat-card-full[data-cat="${cat}"]`)?.classList.add("active");
  const filtered = allProducts.filter(p => p.category === cat);
  renderProducts(filtered, "catProductsGrid");
  document.getElementById("catProductsSection").scrollIntoView({ behavior: "smooth", block: "start" });
}

document.getElementById("backToCatsBtn")?.addEventListener("click", () => {
  document.getElementById("catProductsSection").classList.add("hidden");
  document.querySelectorAll(".cat-card-full").forEach(c => c.classList.remove("active"));
});

function populateCategorySelect() {
  const select = document.getElementById("prodCategory");
  const dropdown = document.getElementById("catDropdown");
  const selected = document.getElementById("catSelected");

  if (!select || !dropdown || !selected) return;

  // reset
  dropdown.innerHTML = "";
  select.innerHTML = `<option value="">Select category</option>`;

  allCategories.forEach(c => {
    const icon = c.icon || "📦";

    // add to hidden select
    const opt = document.createElement("option");
    opt.value = c.name;
    opt.textContent = c.name;
    select.appendChild(opt);

    // create dropdown item
    const item = document.createElement("div");
    item.className = "cat-item";

    if (icon.startsWith("http")) {
      item.innerHTML = `<img src="${icon}"><span>${c.name}</span>`;
    } else {
      item.innerHTML = `<span class="icon">${icon}</span><span>${c.name}</span>`;
    }

    item.addEventListener("click", () => {
      // update UI
      selected.querySelector(".cat-text").textContent = c.name;

      if (icon.startsWith("http")) {
        selected.querySelector(".cat-icon").innerHTML = `<img src="${icon}">`;
      } else {
        selected.querySelector(".cat-icon").textContent = icon;
      }

      // update real select
      select.value = c.name;

      // active state
      dropdown.querySelectorAll(".cat-item").forEach(i => i.classList.remove("active"));
      item.classList.add("active");

      dropdown.classList.add("hidden");
    });

    dropdown.appendChild(item);
  });

  // toggle dropdown
  selected.onclick = () => {
    dropdown.classList.toggle("hidden");
  };

  // close on outside click
  document.addEventListener("click", (e) => {
    if (!document.getElementById("catPicker").contains(e.target)) {
      dropdown.classList.add("hidden");
    }
  });
}

// ── PRODUCTS ──────────────────────────────────────────────
async function loadProducts() {
  const grid = document.getElementById("productsGrid");

  if (!db) {
    grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1"><div class="es-icon">🔌</div><h3>Firebase Not Connected</h3><p>Paste your Firebase config into <code>app.js</code> to see products.</p></div>`;
    return;
  }

  grid.innerHTML = `<div class="loading-state" style="grid-column:1/-1"><div class="spinner"></div><p>Loading products…</p></div>`;

  try {
    // Use the simplest possible query — no orderBy (avoids index requirement)
    const snap = await getDocs(collection(db, "products"));
    allProducts = snap.docs
      .map(d => ({id:d.id, ...d.data()}))
      .sort((a,b) => {
        const ta = a.createdAt?.toDate?.()?.getTime() || 0;
        const tb = b.createdAt?.toDate?.()?.getTime() || 0;
        return tb - ta; // newest first
      });

    if (allProducts.length === 0) {
      grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1"><div class="es-icon">📦</div><h3>No products yet</h3><p>Be the first to list a product!</p></div>`;
    } else {
      renderProducts(allProducts);
    }
    // Re-render categories now that we have product counts
    if (allCategories.length) renderCategories();

  } catch(e) {
    console.error("loadProducts error:", e);
    const isPermission = e.code === "permission-denied";
    grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1">
      <div class="es-icon">⚠️</div>
      <h3>${isPermission ? "Permission Denied" : "Could not load products"}</h3>
      <p>${isPermission ? "Set Firestore rules to allow read on products collection." : e.message}</p>
    </div>`;
  }
}

function renderProducts(products, containerId="productsGrid") {
  const grid = document.getElementById(containerId);
  if (!products.length) {
    grid.innerHTML = `<div class="empty-state"><div class="es-icon">🔍</div><h3>No products found</h3><p>Try a different search or category.</p></div>`;
    return;
  }
  grid.innerHTML = products.map(p => prodCardHTML(p)).join("");
  grid.querySelectorAll(".prod-card").forEach(c => {
    c.addEventListener("click", e => { if (!e.target.closest("button")) openProduct(c.dataset.id); });
  });
  grid.querySelectorAll(".btn-cart").forEach(b => {
    b.addEventListener("click", e => { e.stopPropagation(); addToCart(b.dataset.id); });
  });
  grid.querySelectorAll(".btn-buy-now").forEach(b => {
    b.addEventListener("click", e => { e.stopPropagation(); addToCart(b.dataset.id); openCart(); });
  });
}

function availLabel(a) {
  if (a === "Out of Stock") return { cls:"b-out", icon:"✕", text:"Out of Stock" };
  if (a === "Low Stock")    return { cls:"b-low", icon:"⚠", text:"Low Stock" };
  return { cls:"b-in", icon:"✓", text:"In Stock" };
}

function prodCardHTML(p) {
  const img = (p.images||[])[0] || "";
  const av = availLabel(p.availability);
  const outOfStock = p.availability==="Out of Stock";
  return `
    <div class="prod-card" data-id="${p.id}">
      <div class="prod-img">
        ${img?`<img src="${img}" alt="${p.name}" loading="lazy"/>`:`<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;color:var(--text3);font-size:40px">📦</div>`}
        <span class="avail-badge ${av.cls}">${av.icon} ${av.text}</span>
      </div>
      <div class="prod-body">
        <div class="prod-cat">${p.category||""}</div>
        <div class="prod-name">${p.name}</div>
        <div class="prod-desc">${p.description||""}</div>
        <div class="prod-foot">
          <span class="prod-price">₹${Number(p.price).toFixed(2)}</span>
          <div class="prod-btns">
            <button class="btn-cart" data-id="${p.id}" ${outOfStock?"disabled style='opacity:.4;cursor:not-allowed'":""}>🛒</button>
            <button class="btn-buy-now" data-id="${p.id}" ${outOfStock?"disabled style='opacity:.4;cursor:not-allowed'":""}>Buy</button>
          </div>
        </div>
      </div>
    </div>`;
}

// ── PRODUCT VIEW ──────────────────────────────────────────
async function openProduct(id) {
  let p = allProducts.find(x=>x.id===id);
  if (!p && db) {
    try { const s=await getDoc(doc(db,"products",id)); if(s.exists()) p={id:s.id,...s.data()}; } catch(e){}
  }
  if (!p) return;
  previousTab = currentTab;
  window._prevTab = currentTab;
  renderProductView(p);
  switchTab("product");
}
window.openProduct = openProduct;

function renderProductView(p) {
  const imgs = (p.images||[]);
  const av   = availLabel(p.availability);
  const outOfStock = p.availability === "Out of Stock";
  const payChips = (p.payments||["Credit Card"]).map(pm=>`<span class="pay-chip">${pm}</span>`).join("");

  // Size & Colour sections
  const hasSizes   = p.sizes?.length   > 0;
  const hasColours = p.colours?.length > 0;

  const sizeBtns = hasSizes ? `
    <div class="pv-label">Available Sizes</div>
    <div class="pv-size-btns" id="pvSizeBtns">
      ${p.sizes.map(s=>`<button class="pv-size-btn" data-size="${s}">${s}</button>`).join("")}
    </div>` : "";

  const colourBtns = hasColours ? `
    <div class="pv-label">Available Colours</div>
    <div class="pv-colour-label-row" id="pvColourBtns">
      ${p.colours.map(c=>`<button class="pv-colour-label-btn" data-colour="${c}">${c}</button>`).join("")}
    </div>` : "";

  // Meta cards
  const meta = [
    p.brand   ? {l:"Brand",   v:p.brand}      : null,
    p.sku     ? {l:"SKU",     v:p.sku}         : null,
    p.weight  ? {l:"Weight",  v:p.weight+"kg"} : null,
    p.dimensions ? {l:"Dimensions", v:p.dimensions} : null,
    {l:"Min Order", v:`${p.minQty||1} unit${(p.minQty||1)>1?"s":""}`},
    {l:"Max Order", v:p.maxQty ? `${p.maxQty} units` : "Unlimited"},
    {l:"Listed",    v:p.date||"Recently"},
  ].filter(Boolean);

  const metaCards = meta.map(m=>`
    <div class="pv-meta-card">
      <div class="pv-meta-lbl">${m.l}</div>
      <div class="pv-meta-val">${m.v}</div>
    </div>`).join("");

  const sellerDp = p.sellerPhoto
    ? `<img class="pv-seller-dp" src="${p.sellerPhoto}" alt=""/>`
    : `<div class="pv-seller-dp-letter">${(p.sellerName||"S")[0].toUpperCase()}</div>`;

  const tagsHTML = p.tags?.length
    ? `<div class="pv-divider"></div>
       <div class="pv-label">Tags</div>
       <div class="pv-tags-row">${p.tags.map(t=>`<span class="pv-tag">#${t}</span>`).join("")}</div>`
    : "";

  document.getElementById("productView").innerHTML = `
    <div class="pv-wrap">
      <button class="pv-back-btn" onclick="switchTab(window._prevTab||'home')">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="15 18 9 12 15 6"/></svg>
        Back
      </button>

      <div class="pv-layout">
        <!-- LEFT: Gallery -->
        <div class="pv-gallery">
          ${imgs.length
            ? `<img id="pvMainImg" class="pv-main-img" src="${imgs[0]}" alt="${p.name}"/>`
            : `<div class="pv-main-placeholder">📦</div>`}
          ${imgs.length > 1 ? `
            <div class="pv-thumbs-row">
              ${imgs.map((src,i)=>`<img class="pv-thumb${i===0?" active":""}" src="${src}" data-i="${i}" alt=""/>`).join("")}
            </div>` : ""}
        </div>

        <!-- RIGHT: Info -->
        <div class="pv-info-col">
          <div class="pv-cat-tag">${p.category||"Product"}</div>
          <h1 class="pv-title">${p.name}</h1>
          <div class="pv-price-row">
            <div class="pv-price-big">₹${Number(p.price).toFixed(2)}</div>
            <span class="avail-badge ${av.cls}">${av.icon} ${av.text}</span>
          </div>
          <p class="pv-desc-text">${p.description||"No description available."}</p>

          <div class="pv-divider"></div>

          ${sizeBtns}
          ${colourBtns}
          ${hasSizes||hasColours ? '<div class="pv-divider"></div>' : ""}

          <!-- Quantity -->
          <div class="pv-label">Quantity</div>
          <div class="pv-qty-row">
            <div class="pv-qty-ctrl">
              <button id="pvMinus">−</button>
              <input type="number" id="pvQtyInput" value="${p.minQty||1}" min="${p.minQty||1}" max="${p.maxQty||999}"/>
              <button id="pvPlus">+</button>
            </div>
          </div>

          <!-- Actions -->
          <div class="pv-actions-row">
            <button class="btn-primary" id="pvAddCart" ${outOfStock?"disabled":""}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg>
              ${outOfStock ? "Out of Stock" : "Add to Cart"}
            </button>
            <button class="btn-sec" id="pvBuyNow" ${outOfStock?"disabled":""}>Buy Now</button>
          </div>

          <div class="pv-divider"></div>

          <!-- Seller -->
          <div class="pv-seller-card">
            ${sellerDp}
            <div>
              <div class="pv-seller-name">${p.sellerName||"Store Bazar Seller"}</div>
              <div class="pv-seller-sub">Verified Seller</div>
            </div>
          </div>

          <!-- Meta grid -->
          ${meta.length ? `<div class="pv-meta-grid">${metaCards}</div>` : ""}

          <!-- Payments -->
          <div class="pv-divider"></div>
          <div class="pv-label">Accepted Payments</div>
          <div class="pay-chips" style="margin-bottom:16px">${payChips}</div>

          ${tagsHTML}
        </div>
      </div>
    </div>`;

  // ── Gallery interaction
  const mainImg = document.getElementById("pvMainImg");
  document.querySelectorAll(".pv-thumb").forEach(th => {
    th.addEventListener("click", () => {
      if (mainImg) mainImg.src = imgs[parseInt(th.dataset.i)];
      document.querySelectorAll(".pv-thumb").forEach(t=>t.classList.remove("active"));
      th.classList.add("active");
    });
  });

  // ── Size selection
  let selectedSize = null;
  document.querySelectorAll(".pv-size-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".pv-size-btn").forEach(b=>b.classList.remove("active"));
      btn.classList.add("active");
      selectedSize = btn.dataset.size;
    });
  });

  // ── Colour selection
  let selectedColour = null;
  document.querySelectorAll(".pv-colour-label-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".pv-colour-label-btn").forEach(b=>b.classList.remove("active"));
      btn.classList.add("active");
      selectedColour = btn.dataset.colour;
    });
  });

  // ── Qty controls
  const qtyInput = document.getElementById("pvQtyInput");
  document.getElementById("pvMinus").addEventListener("click", () => {
    const v = parseInt(qtyInput.value); if(v > (p.minQty||1)) qtyInput.value = v - 1;
  });
  document.getElementById("pvPlus").addEventListener("click", () => {
    const v = parseInt(qtyInput.value); if(v < (p.maxQty||999)) qtyInput.value = v + 1;
  });
  qtyInput.addEventListener("change", () => {
    let v = parseInt(qtyInput.value)||1;
    v = Math.max(p.minQty||1, Math.min(v, p.maxQty||999));
    qtyInput.value = v;
  });

  // ── Add to Cart
  document.getElementById("pvAddCart").addEventListener("click", () => {
    if (hasSizes && !selectedSize) { showToast("Please select a size"); return; }
    if (hasColours && !selectedColour) { showToast("Please select a colour"); return; }
    addToCart(p.id, parseInt(qtyInput.value), selectedSize, selectedColour);
    showToast("✅ Added to cart!");
    openCart();
  });

  // ── Buy Now → go straight to review page
  document.getElementById("pvBuyNow").addEventListener("click", () => {
    if (hasSizes && !selectedSize) { showToast("Please select a size"); return; }
    if (hasColours && !selectedColour) { showToast("Please select a colour"); return; }
    addToCart(p.id, parseInt(qtyInput.value), selectedSize, selectedColour);
    openCheckout();
  });
}

// ── SEARCH ────────────────────────────────────────────────
function setupSearch() {
  if (_searchSetup) return; _searchSetup = true;
  const inp = document.getElementById("globalSearch");
  let t;
  inp.addEventListener("input", () => {
    clearTimeout(t);
    t = setTimeout(() => {
      const q = inp.value.trim().toLowerCase();
      if (!q) { switchTab("home"); return; }
      const res = allProducts.filter(p =>
        p.name?.toLowerCase().includes(q) ||
        p.description?.toLowerCase().includes(q) ||
        p.category?.toLowerCase().includes(q) ||
        (p.tags||[]).some(x=>x.toLowerCase().includes(q))
      );
      document.getElementById("searchResultsLabel").textContent = `${res.length} result${res.length!==1?"s":""} for "${inp.value.trim()}"`;
      switchTab("search");
      renderProducts(res, "searchGrid");
    }, 280);
  });
}

// ── CART ─────────────────────────────────────────────────
function setupCart() {
  if (_cartSetup) return; _cartSetup = true;
  document.getElementById("cartNavBtn").addEventListener("click", openCart);
  document.getElementById("mobCartBtn").addEventListener("click", openCart);
  document.getElementById("cartCloseBtn").addEventListener("click", closeCart);
  document.getElementById("cartOverlay").addEventListener("click", closeCart);
  document.getElementById("clearCartBtn").addEventListener("click", () => { cart=[]; saveCart(); renderCart(); });
  document.getElementById("checkoutBtn").addEventListener("click", () => { closeCart(); openCheckout(); });
}

function openCart() { document.getElementById("cartDrawer").classList.add("open"); document.getElementById("cartOverlay").classList.remove("hidden"); renderCart(); }
function closeCart() { document.getElementById("cartDrawer").classList.remove("open"); document.getElementById("cartOverlay").classList.add("hidden"); }

function addToCart(productId, qty=1, size=null, colour=null) {
  const p = allProducts.find(x=>x.id===productId);
  if (!p || p.availability==="Out of Stock") return;
  // If size/colour specified, match on those too (separate cart entries per variant)
  const existing = cart.find(item =>
    item.productId===productId &&
    (item.size||null) === (size||null) &&
    (item.colour||null) === (colour||null)
  );
  if (existing) {
    existing.qty = Math.min(existing.qty + qty, p.maxQty||999);
  } else {
    cart.push({
      productId, name:p.name, price:p.price,
      image:(p.images||[])[0]||"",
      qty, maxQty:p.maxQty||999, minQty:p.minQty||1,
      ...(size   ? {size}   : {}),
      ...(colour ? {colour} : {})
    });
  }
  saveCart(); updateCartCount();
}

function renderCart() {
  const el = document.getElementById("cartItems");
  if (!cart.length) {
    el.innerHTML = `<div class="cart-empty"><div class="ce-icon">🛒</div><p>Your cart is empty</p></div>`;
    document.getElementById("cartFoot").classList.add("hidden");
    return;
  }
  document.getElementById("cartFoot").classList.remove("hidden");
  el.innerHTML = cart.map((item,i) => `
    <div class="cart-item">
      <img class="ci-img" src="${item.image}" alt="" onerror="this.style.display='none'"/>
      <div class="ci-info">
        <div class="ci-name">${item.name}</div>
        ${item.size||item.colour ? `<div style="font-size:11px;color:var(--text3);margin-bottom:2px">${[item.size,item.colour].filter(Boolean).join(" · ")}</div>` : ""}
        <div class="ci-price">₹${(item.price * item.qty).toFixed(2)}</div>
        <div class="ci-qty">
          <button class="qty-btn" data-i="${i}" data-action="dec">−</button>
          <span class="qty-val">${item.qty}</span>
          <button class="qty-btn" data-i="${i}" data-action="inc">+</button>
        </div>
      </div>
      <button class="ci-remove" data-i="${i}" title="Remove">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
      </button>
    </div>`).join("");
  el.querySelectorAll(".qty-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const i = parseInt(btn.dataset.i);
      if (btn.dataset.action==="inc") { cart[i].qty = Math.min(cart[i].qty+1, cart[i].maxQty); }
      else { cart[i].qty--; if(cart[i].qty < 1) cart.splice(i,1); }
      saveCart(); updateCartCount(); renderCart();
    });
  });
  el.querySelectorAll(".ci-remove").forEach(btn => {
    btn.addEventListener("click", () => { cart.splice(parseInt(btn.dataset.i),1); saveCart(); updateCartCount(); renderCart(); });
  });
  const total = cart.reduce((s,item)=>s+item.price*item.qty,0);
  document.getElementById("cartTotal").textContent = "₹"+total.toFixed(2);
}

function updateCartCount() {
  const n = cart.reduce((s,i)=>s+i.qty,0);
  ["cartCount","mobCartCount"].forEach(id => {
    const el = document.getElementById(id);
    el.textContent = n;
    n>0 ? el.classList.remove("hidden") : el.classList.add("hidden");
  });
}

function saveCart() {
  const key = currentUser ? currentUser.uid : "guest";
  try { localStorage.setItem("sb_cart_"+key, JSON.stringify(cart)); } catch(e){}
}
function loadCart(key) {
  const k = key || (currentUser ? currentUser.uid : "guest");
  try { cart = JSON.parse(localStorage.getItem("sb_cart_"+k)||"[]"); updateCartCount(); } catch(e){ cart=[]; }
}
function loadCartRaw(key) {
  try { return JSON.parse(localStorage.getItem("sb_cart_"+key)||"[]"); } catch(e){ return []; }
}

// ── CHECKOUT ─────────────────────────────────────────────
function setupCheckout() {
  if (_checkoutSetup) return; _checkoutSetup = true;
  // Back to cart from review page
  document.getElementById("reviewBackBtn").addEventListener("click", () => {
    switchTab("home");
    setTimeout(() => openCart(), 100);
  });
  // Proceed from review to checkout form
  document.getElementById("reviewProceedBtn").addEventListener("click", () => {
    openCheckoutForm();
  });
  // Back to review from checkout form
  document.getElementById("backToCartBtn").addEventListener("click", () => {
    switchTab("review");
  });
  document.getElementById("placeOrderBtn").addEventListener("click", placeOrder);
  // Location button
  document.getElementById("locateBtn").addEventListener("click", detectLocation);
}

// Open the order review page (step 1 of checkout)
function openCheckout() {
  if (!cart.length) { showToast("Your cart is empty"); return; }
  if (isGuest || !currentUser) {
    document.getElementById("gateModalDesc").textContent = "Sign in to place your order. Your cart will be saved.";
    showSignInGate(true);
    return;
  }
  renderReviewPage();
  switchTab("review");
}

function renderReviewPage() {
  const total = cart.reduce((s,i) => s + i.price * i.qty, 0);
  const itemCount = cart.reduce((s,i) => s + i.qty, 0);

  // Item count badge
  document.getElementById("reviewItemCount").textContent = `${itemCount} item${itemCount!==1?"s":""}`;

  // Items list with editable quantities
  const listEl = document.getElementById("reviewItemsList");
  listEl.innerHTML = cart.map((item, idx) => `
    <div class="review-item" data-idx="${idx}">
      ${item.image
        ? `<img class="ri-img" src="${item.image}" alt="${item.name}" onerror="this.style.display='none'"/>`
        : `<div class="ri-img-placeholder">📦</div>`}
      <div class="ri-info">
        <div class="ri-name" title="${item.name}">${item.name}</div>
        <div class="ri-qty-ctrl">
          <button class="ri-qty-btn" onclick="reviewChangeQty(${idx},-1)">−</button>
          <span class="ri-qty-val">${item.qty}</span>
          <button class="ri-qty-btn" onclick="reviewChangeQty(${idx},1)">+</button>
        </div>
      </div>
      <div class="ri-price-col">
        <div class="ri-unit-price">₹${Number(item.price).toFixed(2)} each</div>
        <div class="ri-total-price">₹${(item.price * item.qty).toFixed(2)}</div>
      </div>
      <button class="ri-remove" onclick="reviewRemoveItem(${idx})" title="Remove">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
      </button>
    </div>`).join("");

  // Price rows
  document.getElementById("reviewPriceRows").innerHTML = `
    <div class="review-price-row"><span>Subtotal (${itemCount} items)</span><span>₹${total.toFixed(2)}</span></div>
    <div class="review-price-row"><span>Delivery</span><span style="color:var(--green)">FREE</span></div>`;

  document.getElementById("reviewTotal").textContent = "₹"+total.toFixed(2);

  // Collect all accepted payment methods from cart items
  const payMethods = [...new Set(cart.flatMap(i => {
    const p = allProducts.find(x=>x.id===i.productId);
    return p?.payments || ["Credit Card"];
  }))];
  document.getElementById("reviewPayMethods").innerHTML =
    payMethods.map(m => `<span class="review-pay-chip">${m}</span>`).join("");
}

// Called from inline onclick in review items
window.reviewChangeQty = function(idx, delta) {
  const item = cart[idx];
  if (!item) return;
  const newQty = item.qty + delta;
  if (newQty < 1) { reviewRemoveItem(idx); return; }
  if (newQty > (item.maxQty || 999)) { showToast("Max quantity reached"); return; }
  cart[idx].qty = newQty;
  saveCart(); updateCartCount(); renderReviewPage();
};
window.reviewRemoveItem = function(idx) {
  cart.splice(idx, 1);
  saveCart(); updateCartCount();
  if (cart.length === 0) {
    showToast("Cart is empty");
    switchTab("home");
  } else {
    renderReviewPage();
  }
};

// Open the checkout form (step 2)
function openCheckoutForm() {
  document.getElementById("coName").value = currentUser?.displayName || "";
  const items = document.getElementById("checkoutItems");
  items.innerHTML = cart.map(item => `
    <div class="co-item">
      ${item.image ? `<img class="co-img" src="${item.image}" alt="" onerror="this.style.display='none'"/>` : `<div class="co-img" style="display:flex;align-items:center;justify-content:center;font-size:24px">📦</div>`}
      <div class="co-name">${item.name} <span style="color:var(--text3)">× ${item.qty}</span></div>
      <div class="co-price">₹${(item.price * item.qty).toFixed(2)}</div>
    </div>`).join("");
  const total = cart.reduce((s,i) => s+i.price*i.qty, 0);
  document.getElementById("coTotal").textContent = "₹"+total.toFixed(2);
  switchTab("checkout");
}

// ── LOCATION DETECTION ───────────────────────────────────
async function detectLocation() {
  const btn  = document.getElementById("locateBtn");
  const text = document.getElementById("locateBtnText");
  const status = document.getElementById("locationStatus");

  if (!navigator.geolocation) {
    showLocationStatus("error", "❌ Geolocation is not supported by your browser.");
    return;
  }

  btn.disabled = true;
  text.textContent = "Detecting…";
  showLocationStatus("loading", `<span class="loc-spin"></span> Detecting your location…`);

  navigator.geolocation.getCurrentPosition(
    async (pos) => {
      const { latitude, longitude, accuracy } = pos.coords;
      showLocationStatus("loading", `<span class="loc-spin"></span> Getting address from coordinates…`);
      try {
        // Use OpenStreetMap Nominatim (free, no API key needed)
        const res = await fetch(
          `https://nominatim.openstreetmap.org/reverse?lat=${latitude}&lon=${longitude}&format=json&addressdetails=1`,
          { headers: { "Accept-Language": "en" } }
        );
        const data = await res.json();
        const a = data.address || {};
        // Build a clean address string
        const parts = [
          a.house_number && a.road ? `${a.house_number} ${a.road}` : a.road || a.pedestrian || "",
          a.suburb || a.neighbourhood || a.hamlet || "",
          a.city || a.town || a.village || a.county || "",
          a.state || a.state_district || "",
          a.postcode || "",
          a.country || ""
        ].filter(Boolean);
        const address = parts.join(", ");
        document.getElementById("coAddress").value = address;
        showLocationStatus("success", `✅ Location detected (±${Math.round(accuracy)}m)`);
      } catch(e) {
        // Fallback: just show coordinates
        document.getElementById("coAddress").value = `Lat: ${latitude.toFixed(5)}, Lon: ${longitude.toFixed(5)}`;
        showLocationStatus("success", "✅ Coordinates filled (address lookup failed)");
      }
      btn.disabled = false;
      text.textContent = "Detect Location";
    },
    (err) => {
      btn.disabled = false;
      text.textContent = "Detect Location";
      const msgs = {
        1: "❌ Location access denied. Please allow location in browser settings.",
        2: "❌ Location unavailable. Check your device settings.",
        3: "❌ Location request timed out. Please try again."
      };
      showLocationStatus("error", msgs[err.code] || "❌ Could not detect location.");
    },
    { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 }
  );
}

function showLocationStatus(type, html) {
  const el = document.getElementById("locationStatus");
  el.className = `location-status ${type}`;
  el.innerHTML = html;
  el.classList.remove("hidden");
  if (type === "success") setTimeout(() => el.classList.add("hidden"), 4000);
}

async function placeOrder() {
  // Safety net: guest should not reach here but guard anyway
  if (isGuest || !currentUser) { showSignInGate(true); return; }
  const name    = document.getElementById("coName").value.trim();
  const phone   = document.getElementById("coPhone").value.trim();
  const address = document.getElementById("coAddress").value.trim();
  const payment = document.getElementById("coPayment").value;
  const notes   = document.getElementById("coNotes").value.trim();
  const errEl   = document.getElementById("coError");
  errEl.classList.add("hidden");
  if (!name||!phone||!address) { errEl.textContent="Please fill in name, phone, and address."; errEl.classList.remove("hidden"); return; }

  const btn = document.getElementById("placeOrderBtn");
  btn.disabled = true; btn.textContent = "Placing order…";
  const total = cart.reduce((s,i)=>s+i.price*i.qty,0);
  const orderData = {
    buyerId: currentUser.uid,
    buyerName: name,
    buyerEmail: currentUser.email,
    buyerPhone: phone,
    buyerPhoto: currentUser.photoURL||"",
    address, payment, notes,
    items: cart.map(i=>({productId:i.productId,name:i.name,price:i.price,qty:i.qty,image:i.image})),
    total, status:"Pending",
    createdAt: serverTimestamp()
  };
  try {
    if (db) await addDoc(collection(db,"orders"), orderData);
    cart=[]; saveCart(); updateCartCount();
    btn.disabled=false; btn.innerHTML="✔ Place Order";
    showToast("🎉 Order placed successfully!");
    switchTab("orders");
  } catch(e) {
    errEl.textContent="Failed to place order: "+e.message; errEl.classList.remove("hidden");
    btn.disabled=false; btn.innerHTML="✔ Place Order";
  }
}

// ── ORDERS ────────────────────────────────────────────────
function setupOrderTabs() {
  if (_orderTabsSetup) return; _orderTabsSetup = true;
  document.querySelectorAll(".tab-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab-btn").forEach(b=>b.classList.remove("active"));
      btn.classList.add("active");
      const tab = btn.dataset.otab;
      document.getElementById("purchasesTab").classList.toggle("hidden", tab!=="purchases");
      document.getElementById("listingsTab").classList.toggle("hidden", tab!=="listings");
    });
  });
}

async function loadOrders() {
  if (!db || !currentUser) { renderEmptyOrders(); return; }
  // Purchases — simple where query, sort in JS
  try {
    const snap = await getDocs(query(collection(db,"orders"), where("buyerId","==",currentUser.uid)));
    const orders = snap.docs.map(d=>({id:d.id,...d.data()}))
      .sort((a,b)=>{
        const ta = a.createdAt?.toDate?.()?.getTime()||0;
        const tb = b.createdAt?.toDate?.()?.getTime()||0;
        return tb-ta;
      });
    renderOrders(orders);
  } catch(e) { renderEmptyOrders(); }
  // Listings — simple where query
  try {
    const snap2 = await getDocs(query(collection(db,"products"), where("sellerId","==",currentUser.uid)));
    const listings = snap2.docs.map(d=>({id:d.id,...d.data()}))
      .sort((a,b)=>{
        const ta = a.createdAt?.toDate?.()?.getTime()||0;
        const tb = b.createdAt?.toDate?.()?.getTime()||0;
        return tb-ta;
      });
    renderListings(listings);
  } catch(e) { renderListings([]); }
}

function renderOrders(orders) {
  const el = document.getElementById("purchasesList");
  if (!orders.length) { el.innerHTML=`<div class="empty-state"><div class="es-icon">🛍️</div><h3>No purchases yet</h3><p>Start shopping!</p><button class="btn-primary" onclick="switchTab('home')">Browse Products</button></div>`; return; }
  el.innerHTML = orders.map(o => {
    const img = (o.items||[])[0]?.image||"";
    const names = (o.items||[]).map(i=>i.name).join(", ");
    const st = o.status||"Pending";
    const stClass = st==="Delivered"?"st-confirmed":st==="Pending"?"st-pending":"st-active";

    // OTP block — shown when a delivery partner has been assigned
    const otpBlock = o.deliveryOtp && st !== "Delivered" ? `
      <div class="order-otp-block">
        <div class="otp-label">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
          Delivery OTP — Share with your delivery partner
        </div>
        <div class="otp-digits">
          ${o.deliveryOtp.split("").map(d=>`<span class="otp-digit">${d}</span>`).join("")}
        </div>
        <div class="otp-note">🛵 ${o.deliveryPartnerName||"Partner"} is delivering your order</div>
      </div>` : o.otpVerified && st === "Delivered" ? `
      <div class="otp-verified-tag">✅ OTP Verified · Delivered</div>` : "";

    return `<div class="order-card" style="flex-direction:column;align-items:stretch;gap:12px">
      <div style="display:flex;align-items:center;gap:14px">
        ${img?`<img class="oc-img" src="${img}" alt="" onerror="this.style.display='none'"/>`:`<div class="oc-img" style="display:flex;align-items:center;justify-content:center;font-size:24px">📦</div>`}
        <div class="oc-info">
          <div class="oc-name">${names||"Order"}</div>
          <div class="oc-meta"><span>${o.payment||""}</span><span>${formatDate(o.createdAt)}</span></div>
        </div>
        <div style="display:flex;flex-direction:column;align-items:flex-end;gap:8px;flex-shrink:0">
          <div class="oc-price">₹${Number(o.total).toFixed(2)}</div>
          <span class="oc-status ${stClass}">${st}</span>
        </div>
      </div>
      ${otpBlock}
    </div>`;
  }).join("");
}

function renderListings(products) {
  const el = document.getElementById("listingsList");
  if (!products.length) { el.innerHTML=`<div class="empty-state"><div class="es-icon">📦</div><h3>No listings yet</h3><p>List your first product!</p><button class="btn-primary" onclick="navigate('sell')">Sell Now</button></div>`; return; }
  el.innerHTML = products.map(p => {
    const img=(p.images||[])[0]||"";
    const bc=p.availability==="Out of Stock"?"st-pending":p.availability==="Low Stock"?"st-active":"st-confirmed";
    return `<div class="order-card" style="cursor:pointer" onclick="openProduct('${p.id}')">
      ${img?`<img class="oc-img" src="${img}" alt=""/>`:`<div class="oc-img" style="display:flex;align-items:center;justify-content:center;font-size:24px">📦</div>`}
      <div class="oc-info">
        <div class="oc-name">${p.name}</div>
        <div class="oc-meta"><span>${p.category||""}</span><span>Qty: ${p.minQty||1}–${p.maxQty||"∞"}</span><span>${p.date||""}</span></div>
      </div>
      <div style="display:flex;flex-direction:column;align-items:flex-end;gap:8px">
        <div class="oc-price">₹${Number(p.price).toFixed(2)}</div>
        <span class="oc-status ${bc}">${p.availability||"In Stock"}</span>
      </div>
    </div>`;
  }).join("");
}

function renderEmptyOrders() {
  document.getElementById("purchasesList").innerHTML=`<div class="empty-state"><div class="es-icon">🛍️</div><h3>No orders yet</h3><p>Browse and shop!</p><button class="btn-primary" onclick="switchTab('home')">Browse</button></div>`;
}

// ── UPLOAD FORM ───────────────────────────────────────────
function setupUploadForm() {
  if (_uploadSetup) return; _uploadSetup = true;
  document.getElementById("prodDate").valueAsDate = new Date();
  setupImageUpload();
  setupFashionFields();

  document.getElementById("uploadForm").addEventListener("submit", async e => {
    e.preventDefault();
    if (!uploadsEnabled) { showToast("Uploads are disabled by the administrator"); return; }
    const errEl = document.getElementById("uploadError");
    const sucEl = document.getElementById("uploadSuccess");
    errEl.classList.add("hidden"); sucEl.classList.add("hidden");

    const name    = document.getElementById("prodName").value.trim();
    const cat     = document.getElementById("prodCategory").value;
    const desc    = document.getElementById("prodDescription").value.trim();
    const price   = parseFloat(document.getElementById("prodPrice").value);
    const minQty  = parseInt(document.getElementById("prodMinQty").value);
    const maxQty  = parseInt(document.getElementById("prodMaxQty").value);
    const avail   = document.querySelector('input[name="avail"]:checked')?.value||"In Stock";
    const payments= [...document.querySelectorAll('input[name="payment"]:checked')].map(c=>c.value);

    // Collect selected sizes/colours
    const sizes   = [...document.querySelectorAll(".size-chip.selected")].map(c=>c.dataset.value);
    const colours = [...document.querySelectorAll(".colour-chip.selected")].map(c=>c.dataset.value);

    if (!name||!cat||!desc||isNaN(price)||isNaN(minQty)||isNaN(maxQty)) {
      errEl.textContent="Please fill in all required fields."; errEl.classList.remove("hidden"); return;
    }
    if (minQty>maxQty) { errEl.textContent="Min qty cannot exceed max qty."; errEl.classList.remove("hidden"); return; }
    if (!payments.length) { errEl.textContent="Select at least one payment method."; errEl.classList.remove("hidden"); return; }

    const btn = document.getElementById("submitProduct");
    btn.disabled=true; btn.textContent="Publishing…";

    let imageUrls = [];
    if (selectedImages.length) imageUrls = await uploadImages(selectedImages);

    const productData = {
      name, category:cat, description:desc, price, minQty, maxQty,
      availability:avail, payments, images:imageUrls,
      brand:document.getElementById("prodBrand").value.trim(),
      sku:document.getElementById("prodSku").value.trim(),
      weight:parseFloat(document.getElementById("prodWeight").value)||null,
      dimensions:document.getElementById("prodDimensions").value.trim(),
      tags:document.getElementById("prodTags").value.split(",").map(t=>t.trim()).filter(Boolean),
      date:document.getElementById("prodDate").value,
      ...(sizes.length   ? {sizes}   : {}),
      ...(colours.length ? {colours} : {}),
      sellerId:currentUser.uid,
      sellerName:currentUser.displayName||currentUser.email||"Seller",
      sellerPhoto:currentUser.photoURL||"",
      createdAt:serverTimestamp()
    };

    try {
      if (db) { const ref = await addDoc(collection(db,"products"),productData); productData.id=ref.id; }
      else productData.id="local_"+Date.now();
      allProducts.unshift(productData);
      sucEl.textContent="✅ Product published successfully!"; sucEl.classList.remove("hidden");
      document.getElementById("uploadForm").reset();
      selectedImages=[]; renderPreviews();
      document.getElementById("prodDate").valueAsDate=new Date();
      // Reset fashion fields
      document.querySelectorAll(".size-chip,.colour-chip").forEach(c=>c.classList.remove("selected"));
      showToast("Product published!");
      setTimeout(()=>switchTab("home"),2000);
      renderProducts(allProducts);
    } catch(err) {
      errEl.textContent="Failed to publish: "+err.message; errEl.classList.remove("hidden");
    } finally {
      btn.disabled=false; btn.innerHTML='<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg> Publish Product';
    }
  });
}

// ── FASHION FIELDS (Size & Colour) ───────────────────────
const FASHION_CATEGORIES = ["fashion","clothing","clothes","footwear","shoes","apparel","garments","accessories"];
const PRESET_SIZES_CLOTHING = ["XS","S","M","L","XL","XXL","XXXL"];
const PRESET_SIZES_FOOTWEAR = ["5","6","7","8","9","10","11","12","UK 6","UK 7","UK 8","UK 9","UK 10"];
const PRESET_COLOURS = ["Black","White","Red","Blue","Green","Yellow","Pink","Purple","Orange","Grey","Brown","Navy","Beige"];

function setupFashionFields() {
  const catSel = document.getElementById("prodCategory");
  if (!catSel) return;
  catSel.addEventListener("change", () => {
    const cat = catSel.value.toLowerCase();
    const isFashion = FASHION_CATEGORIES.some(f => cat.includes(f));
    const section = document.getElementById("fashionSection");
    if (section) section.style.display = isFashion ? "flex" : "none";
    if (isFashion) renderFashionChips(cat);
  });

  // Custom size add
  document.getElementById("addCustomSizeBtn")?.addEventListener("click", () => {
    const inp = document.getElementById("customSizeInput");
    const val = inp.value.trim();
    if (!val) return;
    addChip("sizeChipsWrap", val, "size-chip");
    inp.value = "";
  });
  document.getElementById("customSizeInput")?.addEventListener("keydown", e => {
    if (e.key === "Enter") { e.preventDefault(); document.getElementById("addCustomSizeBtn").click(); }
  });

  // Custom colour add
  document.getElementById("addCustomColourBtn")?.addEventListener("click", () => {
    const inp = document.getElementById("customColourInput");
    const val = inp.value.trim();
    if (!val) return;
    addChip("colourChipsWrap", val, "colour-chip");
    inp.value = "";
  });
  document.getElementById("customColourInput")?.addEventListener("keydown", e => {
    if (e.key === "Enter") { e.preventDefault(); document.getElementById("addCustomColourBtn").click(); }
  });
}

function renderFashionChips(catLower) {
  const isFootwear = catLower.includes("foot") || catLower.includes("shoe");
  const sizes = isFootwear ? PRESET_SIZES_FOOTWEAR : PRESET_SIZES_CLOTHING;
  const wrap = document.getElementById("sizeChipsWrap");
  if (wrap) {
    wrap.innerHTML = "";
    sizes.forEach(s => addChip("sizeChipsWrap", s, "size-chip"));
  }
  const cwrap = document.getElementById("colourChipsWrap");
  if (cwrap) {
    cwrap.innerHTML = "";
    PRESET_COLOURS.forEach(c => addChip("colourChipsWrap", c, "colour-chip"));
  }
}

function addChip(wrapperId, value, chipClass) {
  const wrap = document.getElementById(wrapperId);
  if (!wrap) return;
  // Don't add duplicate
  if ([...wrap.querySelectorAll("[data-value]")].some(c=>c.dataset.value===value)) return;
  const chip = document.createElement("span");
  chip.className = chipClass + " removable";
  chip.dataset.value = value;
  chip.textContent = value;
  chip.addEventListener("click", () => chip.classList.toggle("selected"));
  wrap.appendChild(chip);
}

// ── IMAGE UPLOAD ──────────────────────────────────────────
function setupImageUpload() {
  const area     = document.getElementById("imageUploadArea");
  const input    = document.getElementById("imageInput");
  const addMoreBtn = document.getElementById("addMoreImgsBtn");

  // The file input is position:absolute inset:0 — it naturally catches clicks on the area.
  // When previews are showing, pointer-events:none is set on the input,
  // so we use the "Add more" button instead.

  // Drag and drop
  area.addEventListener("dragover",  e=>{ e.preventDefault(); area.style.borderColor="var(--accent)"; });
  area.addEventListener("dragleave", ()=>{ area.style.borderColor=""; });
  area.addEventListener("drop", e=>{
    e.preventDefault(); area.style.borderColor="";
    handleFiles([...e.dataTransfer.files]);
  });

  // "Add more" button (shown after first images selected)
  addMoreBtn?.addEventListener("click", e=>{
    e.stopPropagation();
    input.click();
  });

  input.addEventListener("change", () => {
    if (input.files.length > 0) handleFiles([...input.files]);
    // Always reset so the same file can be re-selected
    input.value = "";
  });
}

function getImgLimit() {
  // Use per-user limit if set, else Firestore global default, else 4
  return userDoc?.imgUploadLimit || window._globalImgLimit || 4;
}

function handleFiles(files) {
  const limit = getImgLimit();
  const valid = files.filter(f=>f.type.startsWith("image/")).slice(0, limit - selectedImages.length);
  selectedImages = [...selectedImages, ...valid].slice(0, limit);
  renderPreviews();
  if (files.length > valid.length || selectedImages.length >= limit) {
    showToast(`Max ${limit} images per product`);
  }
}

function renderPreviews() {
  const ph      = document.getElementById("uploadPlaceholder");
  const grid    = document.getElementById("imagePreviewGrid");
  const area    = document.getElementById("imageUploadArea");
  const addMore = document.getElementById("addMoreImgsBtn");
  const limit   = getImgLimit();

  if (!selectedImages.length) {
    ph.classList.remove("hidden");
    grid.classList.add("hidden");
    grid.innerHTML = "";
    area.classList.remove("has-previews");
    if (addMore) addMore.style.display = "none";
    return;
  }

  ph.classList.add("hidden");
  grid.classList.remove("hidden");
  area.classList.add("has-previews"); // disables pointer-events on the bg input

  grid.innerHTML = selectedImages.map((f,i)=>`
    <div class="prev-item">
      <img src="${URL.createObjectURL(f)}" alt=""/>
      <button class="prev-rm" data-i="${i}" title="Remove">✕</button>
    </div>`).join("");

  grid.querySelectorAll(".prev-rm").forEach(btn=>{
    btn.addEventListener("click", e=>{
      e.stopPropagation();
      selectedImages.splice(parseInt(btn.dataset.i), 1);
      renderPreviews();
    });
  });

  // Show add-more only if under limit
  if (addMore) {
    addMore.style.display = selectedImages.length < limit ? "flex" : "none";
    if (selectedImages.length >= limit) showToast(`Max ${limit} images reached`);
  }
}

async function uploadImages(files) {
  const urls=[]; const fill=document.getElementById("progressFill");
  const prog=document.getElementById("uploadProgress"); const txt=document.getElementById("progressText");
  prog.classList.remove("hidden");
  for (let i=0;i<files.length;i++) {
    txt.textContent=`Uploading ${i+1}/${files.length}…`;
    fill.style.width=`${(i/files.length)*100}%`;
    try {
      const fd=new FormData(); fd.append("image",files[i]);
      const res=await fetch(`https://api.imgbb.com/1/upload?key=${IMGBB_KEY}`,{method:"POST",body:fd});
      const data=await res.json();
      if (data.success) urls.push(data.data.url);
      else urls.push(URL.createObjectURL(files[i]));
    } catch(e) { urls.push(URL.createObjectURL(files[i])); }
  }
  fill.style.width="100%"; txt.textContent="Done!";
  setTimeout(()=>prog.classList.add("hidden"),1800);
  return urls;
}

// ── HELPERS ───────────────────────────────────────────────
function formatDate(ts) {
  if (!ts) return "";
  try { const d=ts.toDate?ts.toDate():new Date(ts); return d.toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"}); }
  catch(e){ return ""; }
}

function showToast(msg, ms=3000) {
  const t=document.getElementById("toast"); t.textContent=msg; t.classList.remove("hidden");
  clearTimeout(t._timer); t._timer=setTimeout(()=>t.classList.add("hidden"),ms);
}
window.showToast=showToast;