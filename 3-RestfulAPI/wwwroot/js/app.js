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

/* ---------- Product art ----------
   Products without a photo get a generated poster: a colour pair and shape layout
   picked from the name hash, plus a line icon matched from the name/category. */
const PALETTES = [
  ['#2B4ACB', '#5C78F0', '#FFD23F'], ['#FF7A45', '#E0521F', '#FFD9C2'], ['#1FAE7A', '#13865D', '#C8F5E2'],
  ['#8E7CFF', '#6E5BE8', '#FFD23F'], ['#FF5C8A', '#E03A6A', '#FFE0EA'], ['#2FA8F0', '#1786C9', '#D6F0FF'],
  ['#F2B705', '#D99A00', '#FFF3C4'], ['#243049', '#34436A', '#FFD23F'],
];
const ICONS = [
  [/head(phone|set)|earbud|airpod/, '<path d="M4 15v-3a8 8 0 0 1 16 0v3"/><rect x="3" y="14" width="4" height="7" rx="1.5"/><rect x="17" y="14" width="4" height="7" rx="1.5"/>'],
  [/speaker|audio|sound/, '<rect x="6" y="2" width="12" height="20" rx="2.5"/><circle cx="12" cy="14.5" r="3.5"/><circle cx="12" cy="7" r="1.3"/>'],
  [/monitor|screen|tv|display/, '<rect x="2.5" y="4" width="19" height="12" rx="1.5"/><path d="M9 20h6M12 16v4"/>'],
  [/keyboard/, '<rect x="2" y="7" width="20" height="10" rx="2"/><path d="M6 10.5h1M9.5 10.5h1M13 10.5h1M16.5 10.5h1M7 13.5h10"/>'],
  [/laptop|notebook|computer|macbook/, '<rect x="4" y="5" width="16" height="11" rx="1.5"/><path d="M2 19h20"/>'],
  [/phone|mobile|tablet/, '<rect x="7" y="2" width="10" height="20" rx="2.5"/><path d="M11 18.5h2"/>'],
  [/camera|lens/, '<path d="M3 8h4l2-2.5h6L17 8h4v11H3z"/><circle cx="12" cy="13.5" r="3.5"/>'],
  [/watch|clock/, '<path d="M9 2h6v4H9zM9 18h6v4H9z"/><circle cx="12" cy="12" r="6"/><path d="M12 9.5V12l1.5 1.5"/>'],
  [/game|console|controller/, '<path d="M7 8h10a5 5 0 0 1 0 10l-2.5-2h-5L7 18A5 5 0 0 1 7 8z"/><path d="M8 11.5v3M6.5 13h3M16 12h.01M17.5 14h.01"/>'],
  [/shoe|sneaker|boot|running|trainer/, '<path d="M2.5 16.5c0-3 .8-7 1.8-8.5l4.4 3.2c2 1.3 5 2.1 8.3 2.3 2.3.1 4.5 1 4.5 3.3v.7H2.5z"/><path d="M2.5 19.5h19M9 12l1.5-2M12 13l1.5-2"/>'],
  [/shirt|tee|hoodie|jacket|dress|cloth|wear|sweater/, '<path d="M8.5 3 12 5l3.5-2 5 4-2.8 3.2-1.7-1V21H8V9.2l-1.7 1L3.5 7z"/>'],
  [/skillet|pan|pot|wok/, '<circle cx="9.5" cy="13" r="6.5"/><circle cx="9.5" cy="13" r="3.5"/><path d="M16 13h6"/>'],
  [/cup|mug|coffee|pour|tea|kettle/, '<path d="M4 8h12v5.5a5.5 5.5 0 0 1-5.5 5.5h-1A5.5 5.5 0 0 1 4 13.5z"/><path d="M16 10h1.5a2.5 2.5 0 0 1 0 5H16M8 2.5v3M12 2.5v3"/>'],
  [/mat|yoga/, '<rect x="2" y="9" width="14" height="9" rx="1"/><circle cx="18" cy="13.5" r="4.5"/><circle cx="18" cy="13.5" r="1.5"/>'],
  [/ball|sport|fitness|gym|dumbbell/, '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a13 13 0 0 1 0 18M12 3a13 13 0 0 0 0 18"/>'],
  [/lamp|light|bulb/, '<path d="M8 3h8l3.5 8h-15z"/><path d="M12 11v8M8 21h8"/>'],
  [/chair|sofa|couch|furniture|desk|table/, '<path d="M6 11V5h12v6"/><rect x="4" y="11" width="16" height="5" rx="1"/><path d="M6 16v4M18 16v4"/>'],
  [/plant|garden|flower/, '<path d="M12 21V11"/><path d="M12 11c0-4.5 3-7 7.5-7 0 4.5-3 7-7.5 7zM12 14c0-3.5-2.5-6-6.5-6 0 3.5 2.5 6 6.5 6z"/><path d="M8 21h8"/>'],
  [/book|novel|magazine/, '<path d="M4 4h7a2 2 0 0 1 2 2v14a2 2 0 0 0-2-2H4zM20 4h-5a2 2 0 0 0-2 2v14a2 2 0 0 1 2-2h5z"/>'],
  [/perfume|beauty|cream|bottle|serum|lotion/, '<path d="M9.5 2h5v3.5l2.5 3.5V21H7V9l2.5-3.5z"/><path d="M7 13h10"/>'],
  [/toy|kid|baby|lego/, '<rect x="4" y="9" width="16" height="11" rx="1.5"/><rect x="6.5" y="5.5" width="4" height="3.5" rx="1"/><rect x="13.5" y="5.5" width="4" height="3.5" rx="1"/>'],
  [/food|snack|grocery|fruit/, '<path d="M12 7c-4-3-9 0-8 6 .8 4.5 4 8 6 8 1 0 1.3-.6 2-.6s1 .6 2 .6c2 0 5.2-3.5 6-8 1-6-4-9-8-6z"/><path d="M12 7c0-2 1-4 3-4.5"/>'],
];
const BAG_ICON = '<path d="M4.5 8h15l-1.2 13H5.7z"/><path d="M9 8a3 3 0 0 1 6 0"/>';

function hashStr(s) { let h = 2166136261; for (const c of String(s)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; }

function artSvg(name, category = '') {
  const h = hashStr(name);
  const [bg, deep, light] = PALETTES[h % PALETTES.length];
  const text = `${name} ${category}`.toLowerCase();
  const icon = (ICONS.find(([re]) => re.test(text)) || [, BAG_ICON])[1];
  const layouts = [
    `<circle cx="168" cy="168" r="92" fill="${deep}"/><path d="M0 0h70a70 70 0 0 1-70 70z" fill="${light}" opacity=".9"/>`,
    `<path d="M0 200V110a90 90 0 0 1 90 90z" fill="${deep}"/><rect x="128" y="18" width="54" height="54" rx="27" fill="${light}" opacity=".9"/><path d="M200 90v110h-60a60 60 0 0 1 60-110z" fill="${deep}" opacity=".6"/>`,
    `<rect x="110" y="-30" width="140" height="140" transform="rotate(30 180 40)" fill="${deep}"/><circle cx="34" cy="172" r="18" fill="${light}"/>`,
    `<path d="M30 200V120a70 70 0 0 1 140 0v80z" fill="${deep}"/><circle cx="170" cy="34" r="14" fill="${light}"/>`,
    `<g fill="${deep}"><rect x="0" y="22" width="200" height="14"/><rect x="0" y="50" width="200" height="14"/><rect x="0" y="78" width="200" height="14"/></g><circle cx="40" cy="160" r="26" fill="${light}" opacity=".9"/>`,
  ];
  return `<svg class="art" viewBox="0 0 200 200" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
    <rect width="200" height="200" fill="${bg}"/>${layouts[(h >>> 4) % layouts.length]}
    <ellipse cx="100" cy="150" rx="46" ry="7" fill="#000" opacity=".18"/>
    <g transform="translate(100 104) scale(3.4) translate(-12 -12)" fill="#fff" stroke="#141A28" stroke-width="1.15" stroke-linejoin="round" stroke-linecap="round">${icon}</g>
  </svg>`;
}

function productImage(p, cls = 'card-img') {
  const src = safeUrl(p?.imageUrl);
  return `<div class="${cls}">${artSvg(p?.name, p?.categoryName)}${src ? `<img src="${src}" alt="" loading="lazy">` : ''}</div>`;
}
// Small square art for cart/order rows; uses the cached product when available.
const thumb = (productId, name) => productImage(productById(productId) || { name }, 'thumb');

// Broken product photos are removed so the generated art underneath shows.
document.addEventListener('error', e => { if (e.target.tagName === 'IMG' && e.target.closest('.card-img,.product-img,.thumb')) e.target.remove(); }, true);

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
const HEART = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/></svg>';
const PLUS = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>';

// Weekday the order arrives by, from the 3–5 day shipping promise.
function arrivalDay(days = 5) {
  const d = new Date(); d.setDate(d.getDate() + days);
  return d.toLocaleDateString('en-US', { weekday: 'long' });
}

function productCard(p) {
  const out = p.stock <= 0;
  return `<article class="card${out ? ' is-out' : ''}">
    <div class="card-media">
      ${productImage(p)}
      <span class="price tag-on-art">${fmt(p.price)}</span>
      ${out ? '<span class="sold-out">Sold out</span>' : ''}
      <button class="heart" type="button" data-wish="${p.id}" aria-pressed="${state.wishlist.has(p.id)}" aria-label="Save ${esc(p.name)}">${HEART}</button>
    </div>
    <div class="card-body">
      <div class="card-text">
        <span class="card-cat">${esc(p.categoryName)}</span>
        <h3><a href="#/product/${p.id}">${esc(p.name)}</a></h3>
        ${!out && p.stock < 6 ? `<span class="stock-low">Only ${p.stock} left</span>` : ''}
      </div>
      <button class="add-round" type="button" data-add="${p.id}" ${out ? 'disabled' : ''} aria-label="Add ${esc(p.name)} to cart" title="Add to cart">${PLUS}</button>
    </div>
  </article>`;
}

// Delegated handlers for product cards anywhere on the page.
main.addEventListener('click', e => {
  const add = e.target.closest('[data-add]');
  if (add) { addToCart(Number(add.dataset.add)); return; }
  const wish = e.target.closest('[data-wish]');
  if (wish) { toggleWish(Number(wish.dataset.wish), wish); return; }
  const ask = e.target.closest('[data-ask]');
  if (ask) { openDrawer('chatDrawer'); sendChat(ask.dataset.ask); }
});

function renderCatNav(active) {
  const nav = $('#catnav');
  nav.innerHTML = `<a href="#/" ${!active ? 'aria-current="page"' : ''}>All products</a>` +
    state.categories.filter(c => c.productCount !== 0).map(c =>
      `<a href="#/?cat=${c.id}" ${c.id === active ? 'aria-current="page"' : ''}>${esc(c.name)}</a>`).join('');
}

async function viewShop(params) {
  const q = params.get('q') || '';
  const cat = Number(params.get('cat')) || null;
  const sort = params.get('sort') || 'featured';
  const home = !q && !cat;
  $('#searchInput').value = q;
  main.innerHTML = `
    ${home ? `<section class="hero">
      <div class="hero-copy">
        <h1>Order today. Unpack it by ${arrivalDay()}.</h1>
        <p>Everyday tech, kitchen and sports gear from one cart, with delivery in 3 to 5 days.</p>
        <div class="hero-cta">
          <a class="btn primary big" href="#all">Shop the catalog</a>
          <button class="btn big" type="button" data-ask="What are your best products right now?">Ask the assistant</button>
        </div>
      </div>
      <div class="collage" id="collage" aria-hidden="true"></div>
    </section>
    <ul class="perks">
      <li><svg viewBox="0 0 24 24"><path d="M3 7h11v9H3zM14 10h4l3 3v3h-7"/><circle cx="7" cy="18" r="1.8"/><circle cx="17" cy="18" r="1.8"/></svg><span><strong>Delivered in 3 to 5 days</strong>Track every order from your account</span></li>
      <li><svg viewBox="0 0 24 24"><rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18M7 15h3"/></svg><span><strong>Card or cash on delivery</strong>Pick at checkout, coupons welcome</span></li>
      <li><svg viewBox="0 0 24 24"><path d="M4 5h16v11H9l-5 4z"/><path d="M8 9h8M8 12h5"/></svg><span><strong>An assistant that knows the shelves</strong>Ask for anything by budget or use</span></li>
    </ul>
    <section class="section" id="catSection"><div class="section-head"><h2>Shop by category</h2></div><div class="cat-tiles" id="catTiles"></div></section>
    <section class="section" id="lowSection" hidden><div class="section-head"><h2>Almost gone</h2><p class="muted">Low stock. Once they're out, they're out.</p></div><div class="rail" id="lowRail"></div></section>` : ''}
    <section class="section" id="all">
      <div class="toolbar">
        <h2 id="listTitle">${home ? 'Everything in the store' : 'Loading…'}</h2>
        <label class="sort"><span>Sort</span>
          <select id="sort">
            <option value="featured">Featured</option>
            <option value="price-asc">Price, low to high</option>
            <option value="price-desc">Price, high to low</option>
            <option value="name">Name</option>
          </select>
        </label>
      </div>
      <div class="grid" id="grid">${'<div class="skeleton"></div>'.repeat(8)}</div>
    </section>`;
  $('#sort').value = sort;
  $('#sort').addEventListener('change', e => {
    params.set('sort', e.target.value);
    location.hash = '#/?' + params.toString();
  });
  main.querySelector('a[href="#all"]')?.addEventListener('click', e => { e.preventDefault(); $('#all').scrollIntoView({ behavior: 'smooth' }); });

  try {
    const [cats, all] = await Promise.all([loadCategories(), loadProducts()]);
    renderCatNav(cat);

    if (home) {
      const featured = [...all].filter(p => p.stock > 0).sort((a, b) => b.price - a.price).slice(0, 3);
      $('#collage').innerHTML = featured.map((p, i) => `<div class="collage-card c${i}">${productImage(p)}<span class="price">${fmt(p.price)}</span><span class="collage-name">${esc(p.name)}</span></div>`).join('');
      const shown = cats.filter(c => c.productCount !== 0);
      $('#catTiles').innerHTML = shown.map(c => {
        const count = all.filter(p => p.categoryId === c.id).length || c.productCount || 0;
        const sample = all.find(p => p.categoryId === c.id);
        return `<a class="cat-tile" href="#/?cat=${c.id}">${artSvg(sample?.name || c.name, c.name)}<span class="cat-label"><strong>${esc(c.name)}</strong><span>${count} product${count === 1 ? '' : 's'}</span></span></a>`;
      }).join('');
      $('#catSection').hidden = !shown.length;
      const low = all.filter(p => p.stock > 0 && p.stock < 6);
      if (low.length) { $('#lowSection').hidden = false; $('#lowRail').innerHTML = low.map(productCard).join(''); }
    }

    let list = all, title = 'Everything in the store';
    if (q) {
      title = `Results for “${q}”`;
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
    $('#listTitle').innerHTML = `${esc(title)} <span class="count">${list.length}</span>`;
    $('#grid').innerHTML = list.length ? list.map(productCard).join('')
      : `<div class="empty" style="grid-column:1/-1"><h3>Nothing matches that yet</h3><p>Try a shorter search, or ask the assistant to suggest something close.</p><a class="btn" href="#/">Show all products</a></div>`;
  } catch (e) {
    $('#grid').innerHTML = `<div class="empty" style="grid-column:1/-1"><h3>Products didn't load</h3><p>${esc(e.message)}</p><button class="btn" type="button" onclick="route()">Try again</button></div>`;
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
  loadCategories().then(() => renderCatNav(p.categoryId)).catch(() => {});
  const out = p.stock <= 0;
  const stockPct = Math.min(100, Math.round(p.stock / 20 * 100));
  main.innerHTML = `
    <nav class="crumbs" aria-label="Breadcrumb"><a href="#/">Shop</a><span>/</span><a href="#/?cat=${p.categoryId}">${esc(p.categoryName)}</a></nav>
    <div class="product">
      ${productImage(p, 'product-img')}
      <div class="product-info">
        <a class="card-cat" href="#/?cat=${p.categoryId}">${esc(p.categoryName)}</a>
        <h1>${esc(p.name)}</h1>
        <span class="price big">${fmt(p.price)}</span>
        <div class="stock">
          <div class="meter" role="img" aria-label="${out ? 'Out of stock' : `${p.stock} in stock`}"><span style="width:${out ? 0 : Math.max(stockPct, 6)}%" class="${p.stock < 6 ? 'low' : ''}"></span></div>
          <p>${out ? 'Out of stock right now.' : p.stock < 6 ? `Only ${p.stock} left in stock.` : `${p.stock} in stock.`}</p>
        </div>
        <div class="buy">
          <div class="qty">
            <button type="button" data-step="-1" aria-label="Decrease quantity">−</button>
            <input id="qty" type="number" min="1" max="${Math.max(1, p.stock)}" value="1" aria-label="Quantity" />
            <button type="button" data-step="1" aria-label="Increase quantity">+</button>
          </div>
          <button class="btn primary big grow" id="addBtn" type="button" ${out ? 'disabled' : ''}>Add to cart</button>
          <button class="heart inline" type="button" data-wish="${p.id}" aria-pressed="${state.wishlist.has(p.id)}" aria-label="Save ${esc(p.name)}">${HEART}</button>
        </div>
        <ul class="facts">
          <li><strong>Arrives by ${arrivalDay()}</strong><span>if you order today</span></li>
          <li><strong>Card or cash</strong><span>choose at checkout</span></li>
        </ul>
        <button class="ask-link" type="button" data-ask="Tell me about ${esc(p.name)} and suggest anything that goes well with it.">Ask the assistant about this product</button>
      </div>
    </div>
    <section class="section" id="related" hidden><div class="section-head"><h2>More in ${esc(p.categoryName)}</h2></div><div class="rail" id="relatedRail"></div></section>
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
  loadProducts().then(all => {
    const rel = all.filter(x => x.categoryId === p.categoryId && x.id !== p.id).slice(0, 4);
    if (rel.length) { $('#related').hidden = false; $('#relatedRail').innerHTML = rel.map(productCard).join(''); }
  }).catch(() => {});
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
        ${items.map(i => `<div class="list-row">${thumb(i.productId, i.productName)}<div class="grow"><strong>${esc(i.productName)}</strong><br><span class="muted">${i.quantity} × ${fmt(i.unitPrice)}</span></div><span>${fmt(i.subtotal)}</span></div>`).join('')}
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
        ${o.items.map(i => `<div class="list-row">${thumb(i.productId, i.productName)}
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
  if (!['', 'product'].includes(parts[0] || '')) renderCatNav(-1);
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
