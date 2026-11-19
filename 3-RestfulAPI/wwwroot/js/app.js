/* SmartStore storefront: hash-routed single page on top of the REST API. */
const $ = (s, el = document) => el.querySelector(s);
const main = $('#main');
const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const fmt = n => money.format(Number(n) || 0);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const dateFmt = d => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
const initials = name => esc(String(name || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase());
// Only allow http(s)/relative image URLs coming from product data.
const safeUrl = u => (u && /^(https?:\/\/|\/)/i.test(u) ? esc(u) : '');

const ORDER_STATUS = ['Pending', 'Confirmed', 'Shipped', 'Out for delivery', 'Delivered', 'Cancelled'];
const SHIP_STATUS = ['Preparing', 'Shipped', 'Out for delivery', 'Delivered'];

const state = {
  products: null,      // all active products, cached for images and fallback search
  categories: [],      // flattened
  cart: null,
  wishlist: new Map(), // productId -> wishlistItemId
  me: null,
};

/* ---------- UI helpers ---------- */
function toast(msg, type = '') {
  const t = document.createElement('div');
  t.className = 'toast ' + type;
  t.textContent = msg;
  $('#toasts').append(t);
  setTimeout(() => t.remove(), 4200);
}
const fail = e => toast(e.message || String(e), 'error');

function productImage(p, cls = 'card-img') {
  const src = safeUrl(p?.imageUrl);
  return `<div class="${cls}">${src
    ? `<img src="${src}" alt="" loading="lazy" data-mono="${initials(p.name)}">`
    : `<span class="monogram">${initials(p?.name)}</span>`}</div>`;
}

// Broken product images fall back to the monogram tile.
document.addEventListener('error', e => {
  const img = e.target;
  if (img.tagName !== 'IMG' || !img.dataset.mono) return;
  const span = document.createElement('span');
  span.className = 'monogram';
  span.textContent = img.dataset.mono;
  img.replaceWith(span);
}, true);

function requireLogin() {
  if (Auth.loggedIn) return true;
  sessionStorage.setItem('ss_after_login', location.hash || '#/');
  toast('Sign in to continue.');
  location.hash = '#/login';
  return false;
}

/* ---------- Data loaders ---------- */
async function loadProducts() {
  if (!state.products) state.products = (await api('/Product')).filter(p => p.isActive !== false);
  return state.products;
}
async function loadCategories() {
  if (state.categories.length) return state.categories;
  const flat = [];
  const walk = list => list.forEach(c => { flat.push(c); walk(c.subCategories || []); });
  walk(await api('/Category'));
  state.categories = [...new Map(flat.map(c => [c.id, c])).values()];
  return state.categories;
}
const productById = id => state.products?.find(p => p.id === id);

async function refreshCart() {
  if (!Auth.loggedIn) { state.cart = null; renderCartBadge(); return; }
  try { state.cart = await api('/Cart'); } catch (e) { if (e.status !== 404) console.warn(e); state.cart = null; }
  renderCartBadge();
  if ($('#cartDrawer').classList.contains('open')) renderCart();
}
async function refreshWishlist() {
  state.wishlist.clear();
  if (!Auth.loggedIn) return;
  try {
    const w = await api('/Wishlist');
    (w?.items || []).forEach(i => state.wishlist.set(i.productId, i.id));
  } catch (e) { if (e.status !== 404) console.warn(e); }
}
async function refreshMe() {
  state.me = null;
  if (Auth.loggedIn) { try { state.me = await api('/Customer/me'); } catch {} }
  const label = $('#accountLabel');
  label.textContent = state.me ? state.me.fullName.split(' ')[0] : (Auth.loggedIn ? 'Account' : 'Sign in');
  $('#accountLink').href = Auth.loggedIn ? '#/account' : '#/login';
}

function renderCartBadge(bump) {
  const n = state.cart?.totalItems || 0;
  const b = $('#cartCount');
  b.hidden = n === 0;
  b.textContent = n;
  if (bump) { b.classList.remove('bump'); void b.offsetWidth; b.classList.add('bump'); }
}

/* ---------- Cart / wishlist actions ---------- */
async function addToCart(productId, quantity = 1) {
  if (!requireLogin()) return;
  try {
    state.cart = await api('/Cart/items', { method: 'POST', body: { productId, quantity } });
    if (!state.cart?.items) await refreshCart();
    renderCartBadge(true);
    toast(`Added ${productById(productId)?.name || 'item'} to cart.`);
  } catch (e) { fail(e); }
}
async function toggleWish(productId, btn) {
  if (!requireLogin()) return;
  try {
    if (state.wishlist.has(productId)) {
      await api(`/Wishlist/items/${state.wishlist.get(productId)}`, { method: 'DELETE' });
      state.wishlist.delete(productId);
      toast('Removed from saved items.');
    } else {
      await api(`/Wishlist/items/${productId}`, { method: 'POST' });
      await refreshWishlist();
      toast('Saved for later.');
    }
    if (btn) btn.setAttribute('aria-pressed', state.wishlist.has(productId));
  } catch (e) { fail(e); }
}

/* ---------- Drawers ---------- */
let lastFocus = null;
function openDrawer(id) {
  closeDrawers();
  lastFocus = document.activeElement;
  const d = $('#' + id);
  d.inert = false;
  d.setAttribute('aria-hidden', 'false');
  d.classList.add('open');
  $('#scrim').hidden = false;
  document.body.style.overflow = 'hidden';
  setTimeout(() => (d.querySelector('input') || d.querySelector('[data-close]')).focus(), 50);
}
function closeDrawers() {
  document.querySelectorAll('.drawer.open').forEach(d => {
    d.classList.remove('open'); d.inert = true; d.setAttribute('aria-hidden', 'true');
  });
  $('#scrim').hidden = true;
  document.body.style.overflow = '';
  lastFocus?.focus?.();
  lastFocus = null;
}

function renderCart() {
  const body = $('#cartBody');
  $('#receiptDate').textContent = new Date().toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
  if (!Auth.loggedIn) {
    body.innerHTML = `<div class="empty"><p>Sign in to see your cart.</p><a class="btn primary" href="#/login" data-go>Sign in</a></div>`;
    return;
  }
  const items = state.cart?.items || [];
  if (!items.length) {
    body.innerHTML = `<div class="empty"><p>Your cart is empty.</p><a class="btn" href="#/" data-go>Browse products</a></div>`;
    return;
  }
  body.innerHTML = items.map(i => `
    <div class="r-line" data-id="${i.id}">
      <span class="name">${esc(i.productName)}</span><span>${fmt(i.subtotal)}</span>
      <div class="meta">
        <button type="button" data-qty="-1" aria-label="Decrease ${esc(i.productName)}">−</button>
        <span>${i.quantity} × ${fmt(i.unitPrice)}</span>
        <button type="button" data-qty="1" aria-label="Increase ${esc(i.productName)}">+</button>
        <button type="button" class="rm" data-remove>Remove</button>
      </div>
    </div>`).join('') + `
    <div class="r-total"><span>Total</span><span>${fmt(state.cart.totalPrice)}</span></div>
    <a class="btn primary block" href="#/checkout" data-go>Check out</a>
    <button class="btn ghost block" type="button" data-clear style="margin-top:8px">Empty cart</button>
    <div class="barcode" aria-hidden="true"></div>`;
}

$('#cartBody').addEventListener('click', async e => {
  if (e.target.closest('[data-go]')) { closeDrawers(); return; }
  const line = e.target.closest('.r-line');
  try {
    if (e.target.closest('[data-clear]')) {
      if (!confirm('Remove every item from your cart?')) return;
      await api('/Cart', { method: 'DELETE' });
    } else if (line && e.target.closest('[data-remove]')) {
      await api(`/Cart/items/${line.dataset.id}`, { method: 'DELETE' });
    } else if (line && e.target.closest('[data-qty]')) {
      const item = state.cart.items.find(i => i.id == line.dataset.id);
      const q = item.quantity + Number(e.target.closest('[data-qty]').dataset.qty);
      if (q < 1) await api(`/Cart/items/${item.id}`, { method: 'DELETE' });
      else await api(`/Cart/items/${item.id}`, { method: 'PUT', body: { quantity: q } });
    } else return;
    await refreshCart();
  } catch (err) { fail(err); }
});

$('#cartBtn').addEventListener('click', async () => { renderCart(); openDrawer('cartDrawer'); await refreshCart(); });
$('#chatBtn').addEventListener('click', () => openDrawer('chatDrawer'));
$('#scrim').addEventListener('click', closeDrawers);
document.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', closeDrawers));
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeDrawers(); });

/* ---------- Assistant ---------- */
function mdLite(text) {
  // Escape first, then allow **bold** and "- " bullets only.
  const lines = esc(text).split('\n');
  let html = '', inList = false;
  for (const raw of lines) {
    const line = raw.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    const m = line.match(/^\s*[-*]\s+(.*)/);
    if (m) { if (!inList) { html += '<ul>'; inList = true; } html += `<li>${m[1]}</li>`; continue; }
    if (inList) { html += '</ul>'; inList = false; }
    if (line.trim()) html += `<p>${line}</p>`;
  }
  return html + (inList ? '</ul>' : '');
}
async function sendChat(prompt) {
  const log = $('#chatLog');
  $('#chatSuggest').hidden = true;
  log.insertAdjacentHTML('beforeend', `<div class="msg user">${esc(prompt)}</div><div class="msg bot typing">Looking through the catalog…</div>`);
  log.scrollTop = log.scrollHeight;
  const typing = log.lastElementChild;
  try {
    const r = await api('/ProductRag/chat', { method: 'POST', body: { prompt, topK: 5 } });
    const prods = (r.sourceProducts || []).map(p =>
      `<a href="#/product/${Number(p.productId)}"><span>${esc(p.name)}</span><strong>${fmt(p.price)}</strong></a>`).join('');
    typing.classList.remove('typing');
    typing.innerHTML = mdLite(r.answer) + (prods ? `<div class="chat-products">${prods}</div>` : '');
  } catch (e) {
    typing.classList.remove('typing');
    typing.textContent = `The assistant is unavailable right now. ${e.message}`;
  }
  log.scrollTop = log.scrollHeight;
}
$('#chatForm').addEventListener('submit', e => {
  e.preventDefault();
  const input = $('#chatInput');
  const v = input.value.trim();
  if (!v) return;
  input.value = '';
  sendChat(v);
});
$('#chatSuggest').addEventListener('click', e => { if (e.target.tagName === 'BUTTON') sendChat(e.target.textContent); });
$('#chatLog').addEventListener('click', e => { if (e.target.closest('a')) closeDrawers(); });

/* ---------- Search ---------- */
$('#searchForm').addEventListener('submit', e => {
  e.preventDefault();
  const q = $('#searchInput').value.trim();
  location.hash = q ? `#/?q=${encodeURIComponent(q)}` : '#/';
});

/* ---------- Views ---------- */
function productCard(p) {
  const out = p.stock <= 0;
  return `<article class="card">
    ${productImage(p)}
    ${out ? '<span class="sold-out">Sold out</span>' : ''}
    <button class="heart" type="button" data-wish="${p.id}" aria-pressed="${state.wishlist.has(p.id)}" aria-label="Save ${esc(p.name)}">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/></svg>
    </button>
    <div class="card-body">
      <span class="card-cat">${esc(p.categoryName)}</span>
      <h3><a href="#/product/${p.id}">${esc(p.name)}</a></h3>
      ${!out && p.stock < 6 ? `<span class="stock-low">Only ${p.stock} left</span>` : ''}
      <div class="card-foot">
        <span class="price">${fmt(p.price)}</span>
        <button class="btn small" type="button" data-add="${p.id}" ${out ? 'disabled' : ''}>Add to cart</button>
      </div>
    </div>
  </article>`;
}

// Delegated handlers for product cards anywhere on the page.
main.addEventListener('click', e => {
  const add = e.target.closest('[data-add]');
  if (add) { addToCart(Number(add.dataset.add)); return; }
  const wish = e.target.closest('[data-wish]');
  if (wish) toggleWish(Number(wish.dataset.wish), wish);
});

async function viewShop(params) {
  const q = params.get('q') || '';
  const cat = Number(params.get('cat')) || null;
  const sort = params.get('sort') || 'featured';
  $('#searchInput').value = q;
  main.innerHTML = `
    <section class="hero">
      <h1>Everything for the week, in one cart.</h1>
      <div class="hero-side">
        <p>Browse by category, search the full catalog, or ask the assistant to pick products for you.</p>
        <div class="chips" id="chips" aria-label="Categories"></div>
      </div>
    </section>
    <div class="toolbar">
      <h2 id="listTitle">All products</h2>
      <label><span class="sr">Sort by</span>
        <select id="sort">
          <option value="featured">Featured</option>
          <option value="price-asc">Price: low to high</option>
          <option value="price-desc">Price: high to low</option>
          <option value="name">Name</option>
        </select>
      </label>
    </div>
    <div class="grid" id="grid">${'<div class="skeleton"></div>'.repeat(8)}</div>`;
  $('#sort').value = sort;
  $('#sort').addEventListener('change', e => {
    params.set('sort', e.target.value);
    location.hash = '#/?' + params.toString();
  });

  try {
    const [cats, all] = await Promise.all([loadCategories(), loadProducts()]);
    const chips = $('#chips');
    chips.innerHTML = `<button class="chip" type="button" data-cat="" aria-pressed="${!cat && !q}">All</button>` +
      cats.filter(c => c.productCount !== 0).map(c =>
        `<button class="chip" type="button" data-cat="${c.id}" aria-pressed="${c.id === cat}">${esc(c.name)}</button>`).join('');
    chips.addEventListener('click', e => {
      const b = e.target.closest('[data-cat]');
      if (b) location.hash = b.dataset.cat ? `#/?cat=${b.dataset.cat}` : '#/';
    });

    let list = all, title = 'All products';
    if (q) {
      title = `Results for "${q}"`;
      try { list = (await api('/Product/search?query=' + encodeURIComponent(q))).filter(p => p.isActive !== false); }
      catch { const s = q.toLowerCase(); list = all.filter(p => (p.name + ' ' + p.categoryName).toLowerCase().includes(s)); }
    } else if (cat) {
      title = cats.find(c => c.id === cat)?.name || 'Category';
      try { list = (await api(`/Product/category/${cat}`)).filter(p => p.isActive !== false); }
      catch { list = all.filter(p => p.categoryId === cat); }
    }
    const sorters = {
      'price-asc': (a, b) => a.price - b.price,
      'price-desc': (a, b) => b.price - a.price,
      name: (a, b) => a.name.localeCompare(b.name),
      featured: (a, b) => (b.stock > 0) - (a.stock > 0),
    };
    list = [...list].sort(sorters[sort] || sorters.featured);
    $('#listTitle').textContent = `${title} (${list.length})`;
    $('#grid').innerHTML = list.length ? list.map(productCard).join('')
      : `<div class="empty" style="grid-column:1/-1"><h3>Nothing matches that yet</h3><p>Try a shorter search, or ask the assistant to suggest something close.</p><a class="btn" href="#/">Show all products</a></div>`;
  } catch (e) {
    $('#grid').innerHTML = `<div class="empty" style="grid-column:1/-1"><h3>Products didn't load</h3><p>${esc(e.message)}</p><button class="btn" onclick="route()">Try again</button></div>`;
  }
}

async function viewProduct(id) {
  main.innerHTML = '<div class="skeleton" style="min-height:420px"></div>';
  let p;
  try { p = await api(`/Product/${id}`); } catch (e) {
    main.innerHTML = `<div class="empty"><h2>Product not found</h2><p>${esc(e.message)}</p><a class="btn" href="#/">Back to the shop</a></div>`;
    return;
  }
  document.title = `${p.name} | SmartStore`;
  const out = p.stock <= 0;
  main.innerHTML = `
    <nav class="crumbs" aria-label="Breadcrumb"><a href="#/">Shop</a> / <a href="#/?cat=${p.categoryId}">${esc(p.categoryName)}</a> / ${esc(p.name)}</nav>
    <div class="product">
      ${productImage(p, 'product-img')}
      <div class="product-info">
        <h1>${esc(p.name)}</h1>
        <span class="price big">${fmt(p.price)}</span>
        <p class="muted" style="margin-top:14px">${out ? 'Out of stock' : p.stock < 6 ? `Only ${p.stock} left in stock` : 'In stock, ships in 3 to 5 days'}</p>
        <div class="buy">
          <div class="qty">
            <button type="button" data-step="-1" aria-label="Decrease quantity">−</button>
            <input id="qty" type="number" min="1" max="${Math.max(1, p.stock)}" value="1" aria-label="Quantity" />
            <button type="button" data-step="1" aria-label="Increase quantity">+</button>
          </div>
          <button class="btn primary" id="addBtn" type="button" ${out ? 'disabled' : ''}>Add to cart</button>
          <button class="btn" type="button" data-wish="${p.id}" aria-pressed="${state.wishlist.has(p.id)}">Save</button>
        </div>
      </div>
    </div>
    <section class="reviews" id="reviews"><h2>Reviews</h2><p class="muted">Loading reviews…</p></section>`;
  const qty = $('#qty');
  main.querySelectorAll('[data-step]').forEach(b => b.addEventListener('click', () => {
    qty.value = Math.min(Math.max(1, Number(qty.value) + Number(b.dataset.step)), Math.max(1, p.stock));
  }));
  $('#addBtn').addEventListener('click', () => {
    const n = Math.floor(Number(qty.value));
    if (!(n >= 1 && n <= p.stock)) { toast(`Choose a quantity between 1 and ${p.stock}.`, 'error'); return; }
    addToCart(p.id, n);
  });
  renderReviews(p.id);
}

async function renderReviews(productId) {
  const box = $('#reviews');
  let reviews = [];
  try { reviews = await api(`/Review/product/${productId}`) || []; } catch (e) { if (e.status !== 404) fail(e); }
  const avg = reviews.length ? reviews.reduce((s, r) => s + r.rating, 0) / reviews.length : 0;
  const stars = n => '★'.repeat(n) + '☆'.repeat(5 - n);
  const myId = Number(Auth.claims()?.sub ?? Auth.claims()?.['http://schemas.xmlsoap.org/ws/2005/05/identity/claims/nameidentifier'] ?? state.me?.id);
  box.innerHTML = `
    <h2>Reviews</h2>
    <p class="muted">${reviews.length ? `<span class="stars" aria-hidden="true">${stars(Math.round(avg))}</span> ${avg.toFixed(1)} out of 5, ${reviews.length} review${reviews.length > 1 ? 's' : ''}` : 'No reviews yet. Bought this? Tell other shoppers how it was.'}</p>
    ${reviews.map(r => `<div class="review">
      <div class="review-head"><strong>${esc(r.customerName)}</strong><span class="muted">${dateFmt(r.createdAt)}</span></div>
      <div class="stars" aria-label="${r.rating} out of 5 stars">${stars(r.rating)}</div>
      ${r.comment ? `<p>${esc(r.comment)}</p>` : ''}
      ${r.customerId === myId ? `<button class="btn small danger" type="button" data-del-review="${r.id}">Delete review</button>` : ''}
    </div>`).join('')}
    ${Auth.loggedIn ? `<form class="panel" id="reviewForm" style="margin-top:24px">
      <h3>Write a review</h3>
      <fieldset class="rating-input"><legend>Rating</legend><div class="star-row">
        ${[5, 4, 3, 2, 1].map(n => `<input type="radio" name="rating" id="r${n}" value="${n}" ${n === 5 ? 'required' : ''}><label for="r${n}" title="${n} star${n > 1 ? 's' : ''}">★<span class="sr">${n} stars</span></label>`).join('')}
      </div></fieldset>
      <div class="field"><label for="comment">Comment</label><textarea id="comment" maxlength="1000"></textarea></div>
      <p class="form-error" id="reviewErr"></p>
      <button class="btn primary" type="submit">Post review</button>
    </form>` : `<p><a href="#/login">Sign in</a> to write a review.</p>`}`;
  box.querySelectorAll('[data-del-review]').forEach(b => b.addEventListener('click', async () => {
    if (!confirm('Delete your review?')) return;
    try { await api(`/Review/${b.dataset.delReview}`, { method: 'DELETE' }); toast('Review deleted.'); renderReviews(productId); } catch (e) { fail(e); }
  }));
  $('#reviewForm')?.addEventListener('submit', async e => {
    e.preventDefault();
    const rating = Number(new FormData(e.target).get('rating'));
    if (!rating) { $('#reviewErr').textContent = 'Pick a star rating.'; return; }
    try {
      await api('/Review', { method: 'POST', body: { productId, rating, comment: $('#comment').value.trim() || null } });
      toast('Review posted.');
      renderReviews(productId);
    } catch (err) { $('#reviewErr').textContent = err.message; }
  });
}

/* ---------- Auth views ---------- */
function authShell(title, sub, form, foot = '') {
  main.innerHTML = `<div class="panel narrow"><h1 style="font-size:2rem">${title}</h1><p class="muted">${sub}</p>${form}${foot}</div>`;
}
function bindForm(id, handler, focus = true) {
  const f = $('#' + id);
  f.addEventListener('submit', async e => {
    e.preventDefault();
    const btn = f.querySelector('[type=submit]');
    const err = f.querySelector('.form-error');
    err.textContent = '';
    btn.disabled = true;
    try { await handler(Object.fromEntries(new FormData(f))); }
    catch (ex) { err.textContent = ex.message; }
    finally { btn.disabled = false; }
  });
  if (focus) f.querySelector('input')?.focus();
}

function viewLogin() {
  authShell('Sign in', "We'll email you a 6-digit code to confirm it's you.", `
    <form id="loginForm" novalidate>
      <div class="field"><label for="email">Email</label><input id="email" name="email" type="email" autocomplete="email" required /></div>
      <div class="field"><label for="password">Password</label><input id="password" name="password" type="password" autocomplete="current-password" required /></div>
      <p class="form-error"></p>
      <button class="btn primary block" type="submit">Send sign-in code</button>
    </form>`, `<p style="margin-top:18px"><a href="#/forgot">Forgot your password?</a></p><p>New here? <a href="#/register">Create an account</a></p>`);
  bindForm('loginForm', async d => {
    if (!d.email || !d.password) throw new Error('Enter your email and password.');
    const r = await api('/Auth/login', { method: 'POST', body: d });
    sessionStorage.setItem('ss_verify', r.verificationId);
    sessionStorage.setItem('ss_verify_email', d.email);
    toast(r.message || 'Code sent. Check your email.');
    location.hash = '#/verify';
  });
}

function viewVerify() {
  const vid = sessionStorage.getItem('ss_verify');
  if (!vid) { location.hash = '#/login'; return; }
  authShell('Enter your code', `We sent a code to ${esc(sessionStorage.getItem('ss_verify_email') || 'your email')}.`, `
    <form id="otpForm">
      <div class="field"><label for="otp">Verification code</label><input id="otp" name="otp" inputmode="numeric" autocomplete="one-time-code" maxlength="8" required /></div>
      <p class="form-error"></p>
      <button class="btn primary block" type="submit">Verify and sign in</button>
    </form>`, `<p style="margin-top:18px">No code? <a href="#/login">Send a new one</a></p>`);
  bindForm('otpForm', async d => {
    const r = await api('/Auth/verify-email', { method: 'POST', body: { verificationId: vid, otp: d.otp.trim() } });
    Auth.save(r.accessToken, r.refreshToken);
    sessionStorage.removeItem('ss_verify');
    await Promise.all([refreshMe(), refreshCart(), refreshWishlist()]);
    toast(`Welcome back${state.me ? ', ' + state.me.fullName.split(' ')[0] : ''}.`);
    location.hash = sessionStorage.getItem('ss_after_login') || '#/';
    sessionStorage.removeItem('ss_after_login');
  });
}

function viewRegister() {
  authShell('Create an account', 'Save items, track orders, and check out faster.', `
    <form id="regForm">
      <div class="field"><label for="fullName">Full name</label><input id="fullName" name="fullName" autocomplete="name" minlength="4" maxlength="100" required /></div>
      <div class="field"><label for="email">Email</label><input id="email" name="email" type="email" autocomplete="email" required /></div>
      <div class="field"><label for="phone">Phone</label><input id="phone" name="phone" type="tel" autocomplete="tel" required /></div>
      <div class="field"><label for="password">Password</label><input id="password" name="password" type="password" autocomplete="new-password" minlength="5" maxlength="100" required /><span class="hint">At least 5 characters.</span></div>
      <p class="form-error"></p>
      <button class="btn primary block" type="submit">Create account</button>
    </form>`, `<p style="margin-top:18px">Already have an account? <a href="#/login">Sign in</a></p>`);
  bindForm('regForm', async d => {
    await api('/Customer', { method: 'POST', body: d });
    toast('Account created. Sign in to continue.');
    location.hash = '#/login';
  });
}

function viewForgot() {
  authShell('Reset your password', "Enter your email and we'll send a reset code.", `
    <form id="forgotForm">
      <div class="field"><label for="email">Email</label><input id="email" name="email" type="email" autocomplete="email" required /></div>
      <p class="form-error"></p>
      <button class="btn primary block" type="submit">Send reset code</button>
    </form>`, `<p style="margin-top:18px"><a href="#/login">Back to sign in</a></p>`);
  bindForm('forgotForm', async d => {
    const r = await api('/Auth/forgot-password', { method: 'POST', body: d });
    if (r?.verificationId) sessionStorage.setItem('ss_reset', r.verificationId);
    toast(r?.message || 'If that email has an account, a code is on its way.');
    location.hash = '#/reset';
  });
}

function viewReset() {
  const vid = sessionStorage.getItem('ss_reset');
  if (!vid) { location.hash = '#/forgot'; return; }
  authShell('Choose a new password', 'Enter the code from your email and a new password.', `
    <form id="resetForm">
      <div class="field"><label for="otp">Reset code</label><input id="otp" name="otp" inputmode="numeric" autocomplete="one-time-code" required /></div>
      <div class="field"><label for="newPassword">New password</label><input id="newPassword" name="newPassword" type="password" autocomplete="new-password" minlength="6" required /><span class="hint">At least 6 characters.</span></div>
      <p class="form-error"></p>
      <button class="btn primary block" type="submit">Save new password</button>
    </form>`);
  bindForm('resetForm', async d => {
    await api('/Auth/reset-password', { method: 'POST', body: { verificationId: vid, otp: d.otp.trim(), newPassword: d.newPassword } });
    sessionStorage.removeItem('ss_reset');
    toast('Password saved. Sign in with your new password.');
    location.hash = '#/login';
  });
}

/* ---------- Wishlist ---------- */
async function viewWishlist() {
  if (!requireLogin()) return;
  main.innerHTML = '<h1>Saved items</h1><div class="grid" id="grid"><div class="skeleton"></div></div>';
  try {
    await Promise.all([loadProducts(), refreshWishlist()]);
    const list = [...state.wishlist.keys()].map(productById).filter(Boolean);
    $('#grid').innerHTML = list.length ? list.map(productCard).join('')
      : `<div class="empty" style="grid-column:1/-1"><h3>Nothing saved yet</h3><p>Tap the heart on any product to keep it here.</p><a class="btn" href="#/">Browse products</a></div>`;
  } catch (e) { fail(e); }
}

/* ---------- Addresses (shared by checkout and account) ---------- */
function addressForm(a = {}) {
  return `
    <div class="row2">
      <div class="field"><label for="a-title">Label</label><input id="a-title" name="title" placeholder="Home" value="${esc(a.title)}" maxlength="100" required /></div>
      <div class="field"><label for="a-name">Recipient</label><input id="a-name" name="recipientName" autocomplete="name" value="${esc(a.recipientName)}" maxlength="150" required /></div>
      <div class="field"><label for="a-phone">Phone</label><input id="a-phone" name="phone" type="tel" autocomplete="tel" value="${esc(a.phone)}" maxlength="50" required /></div>
      <div class="field"><label for="a-city">City</label><input id="a-city" name="city" autocomplete="address-level2" value="${esc(a.city)}" maxlength="100" required /></div>
      <div class="field"><label for="a-street">Street</label><input id="a-street" name="street" autocomplete="address-line1" value="${esc(a.street)}" maxlength="200" required /></div>
      <div class="field"><label for="a-bld">Building</label><input id="a-bld" name="buildingNumber" value="${esc(a.buildingNumber)}" maxlength="50" /></div>
      <div class="field"><label for="a-zip">Postal code</label><input id="a-zip" name="postalCode" autocomplete="postal-code" value="${esc(a.postalCode)}" maxlength="20" /></div>
    </div>
    <label class="check"><input type="checkbox" name="isDefault" ${a.isDefault ? 'checked' : ''} /> Use as my default address</label>`;
}
const addressBody = d => ({ ...d, buildingNumber: d.buildingNumber || '', postalCode: d.postalCode || null, isDefault: d.isDefault === 'on' });
const addressLine = a => `${esc(a.street)}${a.buildingNumber ? ', ' + esc(a.buildingNumber) : ''}, ${esc(a.city)}${a.postalCode ? ' ' + esc(a.postalCode) : ''}`;

/* ---------- Checkout ---------- */
async function viewCheckout() {
  if (!requireLogin()) return;
  main.innerHTML = '<div class="skeleton"></div>';
  let addresses = [];
  await refreshCart();
  try { addresses = await api('/customers/addresses') || []; } catch (e) { if (e.status !== 404) fail(e); }
  const items = state.cart?.items || [];
  if (!items.length) {
    main.innerHTML = `<div class="empty"><h2>Your cart is empty</h2><p>Add something before checking out.</p><a class="btn primary" href="#/">Browse products</a></div>`;
    return;
  }
  let coupon = null;
  const def = addresses.find(a => a.isDefault) || addresses[0];
  main.innerHTML = `
    <h1>Checkout</h1>
    <div class="two-col">
      <form id="orderForm" class="stack">
        <section class="panel">
          <h2>Delivery address</h2>
          <div id="addrList">${addresses.map(a => `
            <label class="addr"><input type="radio" name="addr" value="${a.id}" ${a.id === def?.id ? 'checked' : ''} required />
              <strong>${esc(a.title)}</strong> <span class="muted">${esc(a.recipientName)}, ${esc(a.phone)}</span><br>${addressLine(a)}</label>`).join('')
            || '<p class="muted">Add an address so we know where to deliver.</p>'}</div>
          <details id="newAddr" ${addresses.length ? '' : 'open'}>
            <summary class="btn small" style="margin-top:6px">Add a new address</summary>
            <div style="margin-top:16px" id="addrFields">${addressForm()}</div>
            <button class="btn" type="button" id="saveAddr">Save address</button>
          </details>
        </section>
        <section class="panel">
          <h2>Payment</h2>
          <label class="addr"><input type="radio" name="pay" value="CashOnDelivery" checked /> Cash on delivery</label>
          <label class="addr"><input type="radio" name="pay" value="Card" /> Card <span class="muted">(pay when the order is confirmed)</span></label>
        </section>
      </form>
      <aside class="panel">
        <h2>Order summary</h2>
        ${items.map(i => `<div class="list-row"><div class="thumb">${initials(i.productName)}</div><div class="grow"><strong>${esc(i.productName)}</strong><br><span class="muted">${i.quantity} × ${fmt(i.unitPrice)}</span></div><span>${fmt(i.subtotal)}</span></div>`).join('')}
        <form id="couponForm" style="display:flex;gap:8px;margin:16px 0">
          <label class="sr" for="coupon">Coupon code</label>
          <input id="coupon" placeholder="Coupon code" maxlength="50" style="flex:1;min-width:0;min-height:44px;padding:0 14px;border:1.5px solid var(--line);border-radius:999px;background:var(--surface)" />
          <button class="btn" type="submit">Apply</button>
        </form>
        <div class="totals" id="totals"></div>
        <p class="form-error" id="orderErr" style="margin-top:14px"></p>
        <button class="btn primary block" id="placeBtn" type="button">Place order</button>
      </aside>
    </div>`;

  const sub = state.cart.totalPrice;
  const renderTotals = () => {
    let disc = 0;
    if (coupon) disc = coupon.discountType === 0 ? sub * coupon.discountValue / 100 : Math.min(sub, coupon.discountValue);
    $('#totals').innerHTML = `<span>Subtotal</span><span>${fmt(sub)}</span>
      ${coupon ? `<span>Coupon ${esc(coupon.code)}</span><span>−${fmt(disc)}</span>` : ''}
      <span>Delivery</span><span>Free</span>
      <span class="grand">Total</span><span class="grand">${fmt(sub - disc)}</span>`;
  };
  renderTotals();

  $('#couponForm').addEventListener('submit', async e => {
    e.preventDefault();
    const code = $('#coupon').value.trim();
    if (!code) { coupon = null; renderTotals(); return; }
    try {
      coupon = await api('/Coupon/validate', { method: 'POST', body: { code } });
      toast(`Coupon ${coupon.code} applied.`);
    } catch (err) { coupon = null; fail(err); }
    renderTotals();
  });

  $('#saveAddr').addEventListener('click', async () => {
    const box = $('#addrFields');
    const inputs = [...box.querySelectorAll('input')];
    if (!inputs.every(i => i.reportValidity())) return;
    const d = Object.fromEntries(inputs.map(i => [i.name, i.type === 'checkbox' ? (i.checked ? 'on' : '') : i.value.trim()]));
    try {
      await api('/customers/addresses', { method: 'POST', body: addressBody(d) });
      toast('Address saved.');
      viewCheckout();
    } catch (err) { fail(err); }
  });

  $('#placeBtn').addEventListener('click', async () => {
    const form = $('#orderForm');
    const addr = form.querySelector('[name=addr]:checked');
    if (!addr) { $('#orderErr').textContent = 'Choose or add a delivery address.'; return; }
    const btn = $('#placeBtn');
    btn.disabled = true;
    $('#orderErr').textContent = '';
    try {
      const order = await api('/Order', { method: 'POST', body: {
        customerAddressId: Number(addr.value),
        paymentMethod: form.querySelector('[name=pay]:checked').value,
        couponCode: coupon?.code || null,
      } });
      await refreshCart();
      toast('Order placed.');
      location.hash = `#/orders/${order.id}`;
    } catch (err) { $('#orderErr').textContent = err.message; }
    finally { btn.disabled = false; }
  });
}

/* ---------- Orders ---------- */
const statusPill = s => `<span class="pill ${s === 4 ? 'ok' : s === 5 ? 'bad' : ''}">${ORDER_STATUS[s] ?? 'Unknown'}</span>`;

async function viewOrders() {
  if (!requireLogin()) return;
  main.innerHTML = '<h1>Your orders</h1><div class="panel" id="orders"><div class="skeleton" style="min-height:120px"></div></div>';
  try {
    const orders = (await api('/Order') || []).sort((a, b) => new Date(b.orderDate) - new Date(a.orderDate));
    $('#orders').innerHTML = orders.length ? orders.map(o => `
      <a class="list-row" href="#/orders/${o.id}" style="text-decoration:none;color:inherit">
        <div class="grow"><strong>Order #${o.id}</strong><br><span class="muted">${dateFmt(o.orderDate)}, ${o.items?.length || 0} item${o.items?.length === 1 ? '' : 's'}</span></div>
        ${statusPill(o.orderStatus)}
        <strong>${fmt(o.totalPrice)}</strong>
      </a>`).join('')
      : `<div class="empty"><h3>No orders yet</h3><p>When you place an order, you can track it here.</p><a class="btn" href="#/">Start shopping</a></div>`;
  } catch (e) { $('#orders').innerHTML = `<p class="form-error">${esc(e.message)}</p>`; }
}

async function viewOrder(id) {
  if (!requireLogin()) return;
  main.innerHTML = '<div class="skeleton"></div>';
  let o;
  try { o = await api(`/Order/${id}`); } catch (e) {
    main.innerHTML = `<div class="empty"><h2>Order not found</h2><p>${esc(e.message)}</p><a class="btn" href="#/orders">Back to orders</a></div>`;
    return;
  }
  const a = o.shippingAddress;
  const cancelled = o.orderStatus === 5;
  main.innerHTML = `
    <nav class="crumbs"><a href="#/orders">Orders</a> / #${o.id}</nav>
    <h1>Order #${o.id}</h1>
    <p class="muted">Placed ${dateFmt(o.orderDate)} ${statusPill(o.orderStatus)}</p>
    ${cancelled ? '' : `<div class="track" aria-label="Delivery progress: ${SHIP_STATUS[o.shipmentStatus] ?? ''}">
      ${SHIP_STATUS.map((s, i) => `<div class="${i <= o.shipmentStatus ? 'done' : ''}">${s}</div>`).join('')}</div>`}
    <div class="two-col">
      <section class="panel">
        <h2>Items</h2>
        ${o.items.map(i => `<div class="list-row"><div class="thumb">${initials(i.productName)}</div>
          <div class="grow"><a href="#/product/${i.productId}"><strong>${esc(i.productName)}</strong></a><br><span class="muted">${i.quantity} × ${fmt(i.unitPrice)}</span></div>
          <span>${fmt(i.subtotal)}</span></div>`).join('')}
      </section>
      <aside class="panel stack">
        <div><h3>Delivery</h3>${a ? `<p>${esc(a.shippingRecipientName)}<br>${esc(a.shippingStreet)}${a.shippingBuildingNumber ? ', ' + esc(a.shippingBuildingNumber) : ''}<br>${esc(a.shippingCity)} ${esc(a.shippingPostalCode || '')}<br>${esc(a.shippingPhone)}</p>` : '<p class="muted">No address on file.</p>'}</div>
        <div><h3>Payment</h3><p>${esc(o.paymentMethod === 'CashOnDelivery' ? 'Cash on delivery' : o.paymentMethod || 'Not set')}${o.couponCode ? `<br>Coupon ${esc(o.couponCode)}` : ''}</p></div>
        <div class="totals"><span class="grand">Total</span><span class="grand">${fmt(o.totalPrice)}</span></div>
      </aside>
    </div>`;
}

/* ---------- Account ---------- */
async function viewAccount() {
  if (!requireLogin()) return;
  main.innerHTML = '<div class="skeleton"></div>';
  await refreshMe();
  let addresses = [];
  try { addresses = await api('/customers/addresses') || []; } catch (e) { if (e.status !== 404) fail(e); }
  const me = state.me || {};
  main.innerHTML = `
    <div class="toolbar"><h1 style="margin:0">Your account</h1><div style="display:flex;gap:8px"><a class="btn" href="#/orders">Your orders</a><button class="btn danger" id="logoutBtn" type="button">Sign out</button></div></div>
    <div class="two-col">
      <div class="stack">
        <section class="panel">
          <h2>Addresses</h2>
          ${addresses.map(a => `<div class="list-row">
            <div class="grow"><strong>${esc(a.title)}</strong> ${a.isDefault ? '<span class="pill">Default</span>' : ''}<br><span class="muted">${esc(a.recipientName)}, ${esc(a.phone)}</span><br>${addressLine(a)}</div>
            <button class="btn small" type="button" data-edit-addr="${a.id}">Edit</button>
            <button class="btn small danger" type="button" data-del-addr="${a.id}">Delete</button>
          </div>`).join('') || '<p class="muted">No saved addresses yet.</p>'}
          <form id="addrForm" class="panel" style="margin-top:16px;box-shadow:none;border:1.5px dashed var(--line)" hidden></form>
          <button class="btn" type="button" id="addAddr" style="margin-top:12px">Add address</button>
        </section>
      </div>
      <div class="stack">
        <form class="panel" id="profileForm">
          <h2>Profile</h2>
          <div class="field"><label for="p-name">Full name</label><input id="p-name" name="fullName" value="${esc(me.fullName)}" required /></div>
          <div class="field"><label for="p-email">Email</label><input id="p-email" name="email" type="email" value="${esc(me.email)}" required /></div>
          <div class="field"><label for="p-phone">Phone</label><input id="p-phone" name="phone" type="tel" value="${esc(me.phone)}" required /></div>
          <p class="form-error"></p>
          <button class="btn primary" type="submit">Save profile</button>
        </form>
        <form class="panel" id="pwForm">
          <h2>Password</h2>
          <div class="field"><label for="pw-cur">Current password</label><input id="pw-cur" name="currentPassword" type="password" autocomplete="current-password" required /></div>
          <div class="field"><label for="pw-new">New password</label><input id="pw-new" name="newPassword" type="password" autocomplete="new-password" minlength="5" required /></div>
          <p class="form-error"></p>
          <button class="btn" type="submit">Change password</button>
        </form>
      </div>
    </div>`;

  $('#logoutBtn').addEventListener('click', async () => {
    try { await api('/Auth/logout', { method: 'POST', body: { refreshToken: Auth.refresh } }); } catch {}
    Auth.clear();
    state.cart = null; state.wishlist.clear();
    await refreshMe(); renderCartBadge();
    toast('Signed out.');
    location.hash = '#/';
  });

  const showAddrForm = a => {
    const f = $('#addrForm');
    f.hidden = false;
    f.innerHTML = `<h3>${a ? 'Edit address' : 'New address'}</h3>${addressForm(a)}<p class="form-error"></p>
      <div style="display:flex;gap:8px"><button class="btn primary" type="submit">Save address</button><button class="btn ghost" type="button" id="cancelAddr">Cancel</button></div>`;
    f.dataset.id = a?.id || '';
    $('#cancelAddr').onclick = () => { f.hidden = true; };
    f.querySelector('input').focus();
  };
  $('#addAddr').addEventListener('click', () => showAddrForm());
  $('#addrForm').addEventListener('submit', async e => {
    e.preventDefault();
    const f = e.target, id = f.dataset.id;
    try {
      await api(id ? `/customers/addresses/${id}` : '/customers/addresses', { method: id ? 'PUT' : 'POST', body: addressBody(Object.fromEntries(new FormData(f))) });
      toast('Address saved.');
      viewAccount();
    } catch (err) { f.querySelector('.form-error').textContent = err.message; }
  });
  main.querySelectorAll('[data-edit-addr]').forEach(b => b.addEventListener('click', () => showAddrForm(addresses.find(a => a.id == b.dataset.editAddr))));
  main.querySelectorAll('[data-del-addr]').forEach(b => b.addEventListener('click', async () => {
    if (!confirm('Delete this address?')) return;
    try { await api(`/customers/addresses/${b.dataset.delAddr}`, { method: 'DELETE' }); toast('Address deleted.'); viewAccount(); } catch (e) { fail(e); }
  }));

  bindForm('profileForm', async d => { state.me = await api('/Customer/me', { method: 'PUT', body: d }) || state.me; await refreshMe(); toast('Profile saved.'); }, false);
  bindForm('pwForm', async d => { await api('/Customer/change-password', { method: 'POST', body: d }); $('#pwForm').reset(); toast('Password changed.'); }, false);
}

/* ---------- Router ---------- */
async function route() {
  const [path, query = ''] = (location.hash.slice(1) || '/').split('?');
  const params = new URLSearchParams(query);
  const parts = path.split('/').filter(Boolean);
  document.title = 'SmartStore';
  closeDrawers();
  window.scrollTo(0, 0);
  const views = {
    '': () => viewShop(params),
    product: () => viewProduct(Number(parts[1])),
    login: viewLogin, verify: viewVerify, register: viewRegister, forgot: viewForgot, reset: viewReset,
    wishlist: viewWishlist, checkout: viewCheckout, account: viewAccount,
    orders: () => (parts[1] ? viewOrder(Number(parts[1])) : viewOrders()),
    assistant: () => { viewShop(params); openDrawer('chatDrawer'); },
  };
  await (views[parts[0] || ''] || (() => {
    main.innerHTML = `<div class="empty"><h2>Page not found</h2><p>That link doesn't go anywhere.</p><a class="btn" href="#/">Go to the shop</a></div>`;
  }))();
  if (!['login', 'verify', 'register', 'forgot', 'reset', 'assistant'].includes(parts[0])) main.focus({ preventScroll: true });
}
window.addEventListener('hashchange', route);

(async function init() {
  await Promise.all([refreshMe(), refreshCart(), refreshWishlist()]);
  route();
})();
