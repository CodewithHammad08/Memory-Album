/* =================================================================
   OUR STORY — FULL-SCREEN DIGITAL MEMORY ALBUM
   Main Application JavaScript
   ================================================================= */

'use strict';

// ----------------------------------------------------------------
// 1. UTILITIES
// ----------------------------------------------------------------
const $ = (sel, ctx = document) => ctx.querySelector(sel);
const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];

function esc(str) {
  return String(str ?? '').replace(/[&<>'"]/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c])
  );
}

function formatDate(d, opts = { year: 'numeric', month: 'long', day: 'numeric' }) {
  if (!d) return '';
  const dt = new Date(d);
  return isNaN(dt) ? String(d) : dt.toLocaleDateString(undefined, opts);
}

function formatDateShort(d) {
  return formatDate(d, { year: 'numeric', month: 'short', day: 'numeric' });
}

let _toastTimer;
function toast(msg, duration = 3200) {
  const el = $('#toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => el.classList.remove('show'), duration);
}

// ----------------------------------------------------------------
// 2. CRYPTO VAULT (optional note encryption)
// ----------------------------------------------------------------
const CryptoVault = {
  key: null,
  async unlock(phrase) {
    if (!phrase) { this.key = null; return; }
    const material = await crypto.subtle.importKey(
      'raw', new TextEncoder().encode(phrase), 'PBKDF2', false, ['deriveKey']
    );
    this.key = await crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: new TextEncoder().encode('our-story-v1'), iterations: 100000, hash: 'SHA-256' },
      material,
      { name: 'AES-GCM', length: 256 },
      false, ['encrypt', 'decrypt']
    );
  },
  async seal(text) {
    if (!text) return '';
    if (!this.key) return text;
    try {
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const enc = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv }, this.key, new TextEncoder().encode(text)
      );
      return JSON.stringify({ iv: Array.from(iv), data: btoa(String.fromCharCode(...new Uint8Array(enc))) });
    } catch { return text; }
  },
  async open(stored) {
    if (!stored) return '';
    try {
      const obj = JSON.parse(stored);
      if (obj?.iv && obj?.data) {
        if (!this.key) return '🔒 Encrypted — unlock with your private phrase.';
        const bytes = Uint8Array.from(atob(obj.data), c => c.charCodeAt(0));
        const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: new Uint8Array(obj.iv) }, this.key, bytes);
        return new TextDecoder().decode(plain);
      }
    } catch { /* fall through */ }
    return stored;
  }
};

// ----------------------------------------------------------------
// 3. API CLIENT
// ----------------------------------------------------------------
const state = {
  csrf: '',
  user: null,
  chapters: [],
  currentIdx: -1,
  photos: [],
  entries: [],
  mediaPage: 0,
  lightList: [],
  lightIdx: 0,
  isMobile: window.innerWidth < 768,
  showingRight: false, // mobile only: showing right page?
  isAnimating: false
};

async function api(path, opts = {}) {
  const isForm = opts.body instanceof FormData;
  const headers = { ...(opts.headers || {}) };
  if (!isForm && opts.body && typeof opts.body === 'object') {
    headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(opts.body);
  }
  if (!['GET', 'HEAD'].includes(opts.method || 'GET') && state.csrf) {
    headers['x-csrf-token'] = state.csrf;
  }
  const res = await fetch('/api' + path, { credentials: 'same-origin', ...opts, headers });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Something went wrong.');
  return data;
}

// ----------------------------------------------------------------
// 4. AUTH
// ----------------------------------------------------------------
async function initApp() {
  try {
    const session = await api('/auth/session');
    state.csrf = session.csrfToken;
    if (session.authenticated) {
      state.user = session.user;
      await onAuthenticated();
    } else {
      showLock();
      await loadUserChips();
    }
  } catch (err) {
    console.warn('Session init error:', err.message);
    showLock();
    await loadUserChips();
  }
}

async function loadUserChips() {
  try {
    const users = await api('/auth/users');
    const container = $('#userChips');
    if (!container || !users?.length) return;
    container.innerHTML = users.map(u =>
      `<button type="button" class="user-chip" data-chip-user="${esc(u)}">${esc(u)}</button>`
    ).join('');
    container.addEventListener('click', e => {
      const chip = e.target.closest('[data-chip-user]');
      if (!chip) return;
      $$('.user-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      $('#loginUsername').value = chip.dataset.chipUser;
    });
  } catch { /* ignore */ }
}

function showLock() {
  const lock = $('#lockScreen');
  const app = $('#albumApp');
  if (lock) {
    lock.removeAttribute('hidden');
    lock.style.display = 'grid';
  }
  if (app) {
    app.setAttribute('hidden', '');
    app.style.display = 'none';
  }
}

async function onAuthenticated() {
  const lock = $('#lockScreen');
  const app = $('#albumApp');
  if (lock) {
    lock.setAttribute('hidden', '');
    lock.style.display = 'none';
  }
  if (app) {
    app.removeAttribute('hidden');
    app.style.display = 'flex';
  }
  if (state.user) $('#hudPosition') && ($('#hudPosition').dataset.username = state.user.username);
  await loadChapters();
  await renderCoverSpread();
}

// Login form
$('#loginForm')?.addEventListener('submit', async e => {
  e.preventDefault();
  const err = $('#loginError');
  err.textContent = '';
  const username = $('#loginUsername').value.trim();
  const password = $('#loginPassword').value;
  try {
    const r = await api('/auth/login', { method: 'POST', body: { username, password } });
    state.csrf = r.csrfToken;
    state.user = r.user;
    await onAuthenticated();
    toast(`Welcome, ${r.user.username}! ♥`);
  } catch (ex) { err.textContent = ex.message; }
});

// Password toggle
$('#pwToggle')?.addEventListener('click', () => {
  const inp = $('#loginPassword');
  inp.type = inp.type === 'password' ? 'text' : 'password';
});

// Lock
$('#lockBtn')?.addEventListener('click', async () => {
  try { await api('/auth/logout', { method: 'POST' }); } catch { /* ignore */ }
  finally {
    state.user = null;
    CryptoVault.key = null;
    state.chapters = [];
    state.currentIdx = -1;
    showLock();
    toast('Album locked. ♥');
  }
});

// Auto-lock after 10 min inactivity
let _lastActivity = Date.now();
['pointerdown', 'keydown', 'touchstart'].forEach(ev =>
  document.addEventListener(ev, () => { _lastActivity = Date.now(); }, { passive: true })
);
setInterval(() => {
  if (!$('#albumApp').hidden && Date.now() - _lastActivity > 10 * 60 * 1000) {
    $('#lockBtn')?.click();
  }
}, 30000);

// ----------------------------------------------------------------
// 5. DATA LOADING
// ----------------------------------------------------------------
async function loadChapters() {
  state.chapters = await api('/chapters');
  buildIndexEntries();
}

async function loadChapterData(idx) {
  const chapter = state.chapters[idx];
  if (!chapter) return;
  const [photos, entries] = await Promise.all([
    api(`/photos/chapter/${chapter._id}`),
    api(`/entries/chapter/${chapter._id}`)
  ]);
  state.photos  = photos;
  state.entries = entries;
  state.mediaPage = 0;
}

function scrapbookItems() {
  const textPages = state.entries.filter(en => ['before', 'between', 'after'].includes(en.pagePosition));
  const before = textPages.filter(en => en.pagePosition === 'before').map(entry => ({ type: 'text', entry }));
  const between = textPages.filter(en => en.pagePosition === 'between').map(entry => ({ type: 'text', entry }));
  const after = textPages.filter(en => en.pagePosition === 'after').map(entry => ({ type: 'text', entry }));
  const media = state.photos.map((photo, index) => ({ type: 'media', photo, index }));

  // Text pages are part of the same physical scrapbook sequence, so they
  // occupy one of the six available places on a page.
  return [
    ...before,
    ...(media.length ? [media[0]] : []),
    ...between,
    ...media.slice(1),
    ...after
  ];
}

function mediaPageCount() {
  return Math.max(1, Math.ceil(scrapbookItems().length / 6));
}

// ----------------------------------------------------------------
// 6. SPREAD RENDERING — THE OPEN PAGES
// ----------------------------------------------------------------
async function renderCoverSpread() {
  state.currentIdx = -1;
  updateHudPosition('The Cover');
  updateNav();

  // Show cover book closed
  const cover = $('#bookCover');
  if (cover) {
    cover.style.display = 'flex';
    cover.classList.remove('is-open', 'is-opening', 'is-closing');
  }

  // Pre-load and render Chapter 1 directly onto the pages underneath the cover!
  if (state.chapters.length > 0) {
    await loadChapterData(0);
    renderLeftPage(state.chapters[0]);
    renderRightPage(state.chapters[0]);
    $('#pageNumLeft').textContent  = '01';
    $('#pageNumRight').textContent = '02';
  } else {
    renderEmptySpread();
  }
}

async function renderChapterSpread(idx, direction = 'next') {
  if (state.isAnimating) return;

  const chapter = state.chapters[idx];
  if (!chapter) return;

  // Animate page turn
  if (state.currentIdx >= 0) {
    await animatePageTurn(direction);
  }

  state.currentIdx = idx;
  await loadChapterData(idx);
  syncMobilePageForCurrentChapter();

  renderLeftPage(chapter);
  renderRightPage(chapter);
  updateHudPosition(`Chapter ${String(chapter.chapterNumber || idx + 1).padStart(2,'0')} · ${esc(chapter.title)}`);
  updateNav();
  buildIndexEntries();
}

function syncMobilePageForCurrentChapter() {
  if (!state.isMobile) return;
  const hasMediaPage = state.photos.length > 0 || state.entries.some(en => ['before', 'between', 'after'].includes(en.pagePosition));
  state.showingRight = hasMediaPage;
  $('#bookSpread')?.classList.toggle('show-right', hasMediaPage);
  $('#pageRight')?.classList.toggle('mobile-media-active', hasMediaPage);
}

function renderLeftPage(chapter) {
  const idx = state.currentIdx;
  const num  = String(chapter.chapterNumber || idx + 1).padStart(2, '0');
  const entries = state.entries.filter(en => !en.pagePosition || en.pagePosition === 'notes');

  const noteHtml = entries.length
    ? entries.map(en => `
        <div class="entry-card" data-entry-id="${en._id}">
          <div class="entry-card-tools">
            <button class="entry-tool-btn" data-edit-entry="${en._id}" title="Edit">✎</button>
            <button class="entry-tool-btn" data-del-entry="${en._id}" title="Delete">×</button>
          </div>
          <div class="entry-card-title">${esc(en.title)}</div>
          <div class="entry-card-content entry-content-async" data-raw="${esc(en.encryptedContent || en.content || '')}"></div>
          ${en.encryptedQuote || en.quote
            ? `<div class="entry-card-quote entry-quote-async" data-raw="${esc(en.encryptedQuote || en.quote || '')}"></div>`
            : ''
          }
        </div>
      `).join('')
    : `<div style="font-family:var(--script);font-size:20px;color:var(--muted);opacity:0.7;margin-top:10px;">Nothing written yet…</div>`;

  $('#pageLeftContent').innerHTML = `
    <div class="chapter-left" style="position:relative;">
      <div class="chapter-num" aria-hidden="true">${num}</div>
      <p class="chapter-eyebrow">CHAPTER ${num}</p>
      <h2 class="chapter-title-left">${esc(chapter.title)}</h2>

      <div class="chapter-date-loc">
        <span class="chapter-date-badge">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
          ${formatDateShort(chapter.date)}
        </span>
        ${chapter.location ? `<span class="chapter-loc-badge">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
          ${esc(chapter.location)}
        </span>` : ''}
        ${chapter.mood ? `<span class="chapter-mood-stamp">♥ ${esc(chapter.mood)}</span>` : ''}
      </div>

      <div class="chapter-divider"></div>

      ${chapter.description
        ? `<p class="chapter-desc">${esc(chapter.description)}</p>`
        : ''}

      <div class="chapter-note-area">
        <div class="chapter-note-label">Little things I remember…</div>
        <div class="chapter-entries">${noteHtml}</div>
        <button class="chapter-add-note-btn" data-add-note="${chapter._id}">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
          Write a note
        </button>
      </div>

      <div class="chapter-tools-row">
        <button class="chapter-tool-btn" data-edit-chapter="${chapter._id}">Edit Chapter</button>
        <button class="chapter-tool-btn chapter-tool-btn--danger" data-del-chapter="${chapter._id}">Delete</button>
      </div>
    </div>
  `;

  $('#pageNumLeft').textContent = String(idx * 2 + 1).padStart(2, '0');

  // Decrypt entry content asynchronously
  decryptEntryContents();
}

async function decryptEntryContents() {
  const contentEls = $$('.entry-content-async');
  const quoteEls   = $$('.entry-quote-async');
  for (const el of contentEls) {
    el.textContent = await CryptoVault.open(el.dataset.raw);
    el.classList.remove('entry-content-async');
  }
  for (const el of quoteEls) {
    el.textContent = `"${await CryptoVault.open(el.dataset.raw)}"`;
    el.classList.remove('entry-quote-async');
  }
}

function renderRightPage(chapter) {
  const idx    = state.currentIdx;
  const allPhotos = state.photos;
  const allItems = scrapbookItems();
  const totalMediaPages = mediaPageCount();
  state.mediaPage = Math.max(0, Math.min(state.mediaPage, totalMediaPages - 1));
  const pageItems = allItems.slice(state.mediaPage * 6, state.mediaPage * 6 + 6);
  const photos = pageItems.filter(item => item.type === 'media').map(item => item.photo);
  const content = $('#pageRightContent');

  if (!allItems.length) {
    // Empty right page — upload zone
    content.innerHTML = `
      <div class="photo-upload-zone" id="dropZone" data-chapter-id="${chapter._id}">
        <div class="upload-zone-icon">📷</div>
        <div class="upload-zone-title">Memories belong here</div>
        <div class="upload-zone-sub">Drag & drop or click to add photos and videos</div>
        <button class="upload-zone-btn" id="dropZoneBtn">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
          Add Media
        </button>
        <div class="swipe-hint" aria-hidden="true">← swipe to go back</div>
      </div>
    `;
    attachDropZone(content, chapter._id);
  } else {
    const layout = getLayout(photos.length);
    const pageMarkup = pageItems.map(item =>
      item.type === 'media' ? buildPolaroid(item.photo, item.index) : buildTextPage(item.entry)
    ).join('');
    content.innerHTML = `
      <div class="photo-composition layout-${layout}${photos.filter(p => p.resourceType === 'video').length === 2 ? ' layout-videos' : ''}" id="photoComposition">
        ${pageMarkup}
        ${totalMediaPages > 1 ? `<div class="media-page-indicator">Scrapbook ${state.mediaPage + 1} of ${totalMediaPages}</div>` : ''}
      </div>
    `;
    attachDropZone(content, chapter._id);
    decryptEntryContents();
  }

  $('#pageNumRight').textContent = String(idx * 2 + 2).padStart(2, '0');

  // Rendering the media last guarantees the phone view lands on the page
  // that actually contains the photographs, even after an async upload.
  if (state.isMobile && allItems.length) {
    state.showingRight = true;
    $('#bookSpread')?.classList.add('show-right');
    $('#pageRight')?.classList.add('mobile-media-active');
    updateNav();
  }
}

function getLayout(n) {
  if (n === 0)             return '1';
  if (n === 1)             return '1';
  if (n === 2)             return '2';
  if (n === 3)             return '3';
  if (n === 4)             return '4';
  return 'many';
}

function buildPolaroid(photo, idx) {
  const url   = photo.secureUrl || photo.url || '';
  const cap   = photo.caption || '';
  const isFav = photo.isFavourite;
  const frameSize = ['small', 'standard', 'large'].includes(photo.frameSize) ? photo.frameSize : 'standard';
  const frameSizeLabel = { small: 'Small', standard: 'Standard', large: 'Large' }[frameSize];
  const isVideo = photo.resourceType === 'video';
  const media = isVideo
    ? `<video class="polaroid-video" controls playsinline preload="metadata" aria-label="${esc(cap || 'Memory video')}"><source src="${esc(url)}"></video>`
    : `<img src="${esc(url)}" alt="${esc(cap || 'Memory photograph')}" loading="lazy">`;

  return `
    <figure class="polaroid polaroid--${frameSize}${isVideo ? ' polaroid--video' : ''}" data-photo-idx="${idx}" data-photo-id="${photo._id}">
      <div class="washi-tape" aria-hidden="true"></div>
      <span class="polaroid-size-tag" aria-hidden="true">${frameSizeLabel}</span>
      <div class="polaroid-img-wrap">
        ${media}
      </div>
      <div class="polaroid-actions" role="group" aria-label="Photo actions">
        <button class="polaroid-action ${isFav ? 'fav-active' : ''}" data-fav="${photo._id}" title="${isFav ? 'Remove from favourites' : 'Add to favourites'}">
          ${isFav
            ? '<svg width="13" height="13" viewBox="0 0 24 24" fill="#d81159" stroke="#d81159" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>'
            : '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>'
          }
        </button>
        <button class="polaroid-action polaroid-size-action" data-cycle-size="${photo._id}" title="Frame size: ${frameSizeLabel}. Click to change size" aria-label="Change photo size, currently ${frameSizeLabel}">⤢</button>
        <button class="polaroid-action" data-caption-btn="${photo._id}" title="Edit caption">✎</button>
        <button class="polaroid-action" data-del-photo="${photo._id}" title="Delete photo" style="color:#c0392b;">×</button>
      </div>
      <figcaption class="polaroid-caption" data-caption-label="${photo._id}">${esc(cap) || '&nbsp;'}</figcaption>
    </figure>
  `;
}

function buildTextPage(entry) {
  const quote = entry.encryptedQuote || entry.quote || '';
  return `
    <article class="scrapbook-text-page" data-entry-id="${entry._id}">
      <div class="text-page-flourish">♥</div>
      <div class="entry-card-tools">
        <button class="entry-tool-btn" data-edit-entry="${entry._id}" title="Edit text page">✎</button>
        <button class="entry-tool-btn" data-del-entry="${entry._id}" title="Delete text page">×</button>
      </div>
      <p class="text-page-kicker">A LITTLE NOTE</p>
      <h3>${esc(entry.title)}</h3>
      <p class="text-page-content entry-content-async" data-raw="${esc(entry.encryptedContent || entry.content || '')}"></p>
      ${quote ? `<p class="text-page-quote entry-quote-async" data-raw="${esc(quote)}"></p>` : ''}
    </article>
  `;
}

// ----------------------------------------------------------------
// 7. PAGE TURNING ANIMATION
// ----------------------------------------------------------------
async function animatePageTurn(direction = 'next') {
  const overlay = $('#pageTurnOverlay');
  if (!overlay || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  state.isAnimating = true;
  overlay.classList.add('turning');

  const front = overlay.querySelector('.turn-page-front');
  const back  = overlay.querySelector('.turn-page-back');

  if (direction === 'next') {
    front.style.animation = 'pageTurnForward 0.55s cubic-bezier(0.3,0.9,0.3,1) forwards';
    back.style.animation  = 'pageTurnForward 0.55s cubic-bezier(0.3,0.9,0.3,1) forwards';
    back.style.animationDelay = '0.1s';
  } else {
    front.style.animation = 'pageTurnBackward 0.55s cubic-bezier(0.3,0.9,0.3,1) forwards';
    back.style.animation  = 'pageTurnBackward 0.55s cubic-bezier(0.3,0.9,0.3,1) forwards';
    back.style.animationDelay = '0.1s';
  }

  await new Promise(r => setTimeout(r, 600));
  overlay.classList.remove('turning');
  front.style.animation = '';
  back.style.animation  = '';
  state.isAnimating = false;
}

// ----------------------------------------------------------------
// 8. COVER OPEN ANIMATION
// ----------------------------------------------------------------
function openAlbumCover(targetIdx = 0) {
  const cover = $('#bookCover');
  if (!cover || cover.classList.contains('is-open') || cover.classList.contains('is-opening')) return;

  cover.classList.remove('is-closing');
  cover.classList.add('is-opening');

  if (state.chapters.length > 0) {
    const ch = state.chapters[targetIdx] || state.chapters[0];
    updateHudPosition(`Chapter ${String(ch.chapterNumber || targetIdx + 1).padStart(2,'0')} · ${esc(ch.title)}`);
  } else {
    updateHudPosition('Our Story ♥');
  }

  const duration = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 50 : 1000;

  setTimeout(async () => {
    cover.classList.remove('is-opening');
    cover.classList.add('is-open');
    cover.style.display = 'none';

    if (state.chapters.length > 0) {
      if (targetIdx !== 0 || state.currentIdx !== 0) {
        state.currentIdx = 0;
        await renderChapterSpread(Math.max(0, Math.min(targetIdx, state.chapters.length - 1)), 'next');
      } else {
        state.currentIdx = 0;
        syncMobilePageForCurrentChapter();
        updateNav();
        buildIndexEntries();
      }
    } else {
      renderEmptySpread();
    }
  }, duration);
}

function closeAlbumCover() {
  const cover = $('#bookCover');
  if (!cover) return;
  cover.style.display = 'flex';
  void cover.offsetWidth;
  cover.classList.remove('is-open', 'is-opening');
  cover.classList.add('is-closing');

  const duration = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 50 : 1000;
  setTimeout(() => {
    cover.classList.remove('is-closing');
    state.currentIdx = -1;
    updateHudPosition('The Cover');
    updateNav();
  }, duration);
}

// Click anywhere on the book cover to open
$('#bookCover')?.addEventListener('click', () => {
  if (!$('#bookCover').classList.contains('is-open') && !$('#bookCover').classList.contains('is-opening')) {
    openAlbumCover(0);
  }
});

// Click the dedicated "Open Our Album" button
$('#coverOpenBtn')?.addEventListener('click', e => {
  e.stopPropagation();
  openAlbumCover(0);
});

function renderEmptySpread() {
  state.currentIdx = 0;
  updateHudPosition('Our First Page');
  updateNav();

  $('#pageLeftContent').innerHTML = `
    <div class="spread-cover-left" style="text-align:center;">
      <div class="empty-spread-icon">✦</div>
      <div class="empty-spread-title">Your story begins here</div>
      <div class="empty-spread-sub">Add your first chapter to begin filling these pages with memories.</div>
      <button class="chapter-add-note-btn" onclick="openChapterModal()" style="margin-top:16px;">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        Add First Chapter
      </button>
    </div>
  `;
  $('#pageRightContent').innerHTML = `
    <div class="empty-spread">
      <div class="empty-spread-icon">📷</div>
      <div class="empty-spread-title">Photographs await</div>
      <div class="empty-spread-sub">Every great story needs pictures. Add a chapter first, then fill it with photos.</div>
    </div>
  `;
}

// ----------------------------------------------------------------
// 9. NAVIGATION
// ----------------------------------------------------------------
function updateNav() {
  const prev = $('#navPrev');
  const next = $('#navNext');
  const idx  = state.currentIdx;
  const len  = state.chapters.length;
  const hasPreviousMediaPage = state.mediaPage > 0;
  const hasNextMediaPage = state.mediaPage < mediaPageCount() - 1;
  // On phones the right-hand page is a separate view. Keep Next available
  // even on the final chapter so its photos/videos are never inaccessible.
  const hasMobileMediaPage = state.isMobile && !state.showingRight && (
    state.photos.length > 0 || state.entries.some(en => ['before', 'between', 'after'].includes(en.pagePosition))
  );

  if (prev) prev.disabled = !hasPreviousMediaPage && (idx <= -1 || (idx === 0 && !$('#bookCover').classList.contains('is-open')));
  if (next) next.disabled = idx >= len - 1 && !hasMobileMediaPage && !hasNextMediaPage;
}

function updateHudPosition(text) {
  const el = $('#hudPosition');
  if (el) el.textContent = text;
}

$('#navPrev')?.addEventListener('click', async () => {
  if (state.isAnimating) return;
  const idx = state.currentIdx;
  if (state.mediaPage > 0) {
    state.mediaPage--;
    renderRightPage(state.chapters[idx]);
    updateNav();
    return;
  }
  if (state.isMobile && state.showingRight) {
    // Mobile: show left page of current chapter
    state.showingRight = false;
    $('#bookSpread').classList.remove('show-right');
    $('#pageRight')?.classList.remove('mobile-media-active');
    updateNav();
    return;
  }
  if (idx === 0) {
    // Close book smoothly back to cover
    closeAlbumCover();
    return;
  }
  if (idx > 0) {
    await renderChapterSpread(idx - 1, 'prev');
  }
});

$('#navNext')?.addEventListener('click', async () => {
  if (state.isAnimating) return;
  const idx = state.currentIdx;

  // If cover is still visible (not opened), open it first
  if (!$('#bookCover').classList.contains('is-open')) {
    openAlbumCover();
    return;
  }

  if (state.mediaPage < mediaPageCount() - 1) {
    state.mediaPage++;
    renderRightPage(state.chapters[idx]);
    updateNav();
    return;
  }

  if (state.isMobile && !state.showingRight && state.photos.length > 0) {
    // Mobile: show right (photos) page
    state.showingRight = true;
    $('#bookSpread').classList.add('show-right');
    $('#pageRight')?.classList.add('mobile-media-active');
    updateNav();
    return;
  }

  if (idx < state.chapters.length - 1) {
    state.showingRight = false;
    $('#bookSpread').classList.remove('show-right');
    $('#pageRight')?.classList.remove('mobile-media-active');
    await renderChapterSpread(idx + 1, 'next');
  }
});

// Keyboard navigation
document.addEventListener('keydown', e => {
  if ($('#albumApp').hidden) return;
  if (document.querySelector('.modal-overlay.is-open, .index-panel.is-open, .favs-panel.is-open, .lightbox.is-open')) return;
  if (e.key === 'ArrowLeft')  $('#navPrev')?.click();
  if (e.key === 'ArrowRight') $('#navNext')?.click();
});

// Corner nav
$('#cornerPrev')?.addEventListener('click', () => $('#navPrev')?.click());
$('#cornerNext')?.addEventListener('click', () => $('#navNext')?.click());
$('#cornerPrev')?.addEventListener('keydown', e => e.key === 'Enter' && $('#navPrev')?.click());
$('#cornerNext')?.addEventListener('keydown', e => e.key === 'Enter' && $('#navNext')?.click());

// Mobile swipe gesture
let _touchStartX = 0, _touchStartY = 0;
document.addEventListener('touchstart', e => {
  _touchStartX = e.touches[0].clientX;
  _touchStartY = e.touches[0].clientY;
}, { passive: true });

document.addEventListener('touchend', e => {
  if ($('#albumApp').hidden) return;
  if (document.querySelector('.modal-overlay.is-open, .index-panel.is-open, .favs-panel.is-open, .lightbox.is-open')) return;
  const dx = e.changedTouches[0].clientX - _touchStartX;
  const dy = e.changedTouches[0].clientY - _touchStartY;
  if (Math.abs(dx) < 50 || Math.abs(dy) > 80) return; // ignore small or vertical swipes
  if (dx < 0) $('#navNext')?.click();
  else        $('#navPrev')?.click();
}, { passive: true });

// ----------------------------------------------------------------
// 10. INDEX PANEL
// ----------------------------------------------------------------
function buildIndexEntries(filter = '') {
  const container = $('#indexEntries');
  if (!container) return;

  const term = filter.toLowerCase().trim();
  const chapters = state.chapters.filter(c =>
    !term || [c.title, c.location, c.description, c.mood, c.date].join(' ').toLowerCase().includes(term)
  );

  if (!chapters.length) {
    container.innerHTML = `
      <div style="padding:32px; text-align:center; color:var(--muted);">
        <div style="font-family:var(--script);font-size:24px;color:var(--deep);margin-bottom:8px;">No chapters found</div>
        <div style="font-size:12px;">Try a different search, or add a new chapter.</div>
      </div>
    `;
    return;
  }

  container.innerHTML = chapters.map((c, i) => {
    const globalIdx = state.chapters.indexOf(c);
    const isActive  = globalIdx === state.currentIdx;
    const num       = String(c.chapterNumber || i + 1).padStart(2, '0');
    const coverUrl  = c.coverPhotoId?.secureUrl || c.coverPhotoId?.url || '';

    return `
      <div class="index-entry ${isActive ? 'active' : ''}" data-go-chapter="${globalIdx}" role="button" tabindex="0">
        <div class="index-entry-num">${num}</div>
        <div class="index-entry-info">
          <div class="index-entry-title">${esc(c.title)}</div>
          <div class="index-entry-meta">
            ${formatDateShort(c.date)}${c.location ? ' · ' + esc(c.location) : ''}${c.mood ? ' · ' + esc(c.mood) : ''}
          </div>
        </div>
        <div class="index-entry-thumb">
          ${coverUrl
            ? `<img src="${esc(coverUrl)}" alt="${esc(c.title)}" loading="lazy">`
            : '♥'
          }
        </div>
      </div>
    `;
  }).join('');
}

$('#indexBtn')?.addEventListener('click', openIndex);
$('#indexAddChapter')?.addEventListener('click', () => { closeIndex(); openChapterModal(); });

function openIndex() {
  $('#indexPanel').classList.add('is-open');
  $('#indexPanel').removeAttribute('aria-hidden');
  $('#indexSearch')?.focus();
}

function closeIndex() {
  $('#indexPanel').classList.remove('is-open');
  $('#indexPanel').setAttribute('aria-hidden', 'true');
}

$('#indexClose')?.addEventListener('click', closeIndex);
$('#indexBackdrop')?.addEventListener('click', closeIndex);
$('#indexSearch')?.addEventListener('input', e => buildIndexEntries(e.target.value));

$('#indexEntries')?.addEventListener('click', async e => {
  const entry = e.target.closest('[data-go-chapter]');
  if (!entry) return;
  const idx = parseInt(entry.dataset.goChapter, 10);
  closeIndex();
  if (!$('#bookCover').classList.contains('is-open')) {
    openAlbumCover(idx);
  } else {
    await renderChapterSpread(idx, idx > state.currentIdx ? 'next' : 'prev');
  }
});

// ----------------------------------------------------------------
// 11. FAVOURITES PANEL
// ----------------------------------------------------------------
$('#favBtn')?.addEventListener('click', openFavs);
$('#favsClose')?.addEventListener('click', closeFavs);
$('#favsBackdrop')?.addEventListener('click', closeFavs);

async function openFavs() {
  const grid = $('#favsGrid');
  if (!grid) return;

  $('#favsPanel').classList.add('is-open');
  $('#favsPanel').removeAttribute('aria-hidden');

  grid.innerHTML = `<div style="grid-column:1/-1;padding:32px;text-align:center;"><div class="skeleton" style="width:100%;height:160px;border-radius:4px;"></div></div>`;

  try {
    const favs = await api('/photos/favourites');
    if (!favs.length) {
      grid.innerHTML = `
        <div class="favs-empty">
          <div class="favs-empty-title">No favourites yet</div>
          <p style="font-size:12px;">Tap the ♥ on any photo to keep it here.</p>
        </div>
      `;
      return;
    }
    grid.innerHTML = favs.map(p => {
      const url   = p.secureUrl || p.url || '';
      const title = typeof p.chapterId === 'object' ? (p.chapterId?.title || '') : '';
      return `
        <figure class="fav-polaroid" data-fav-photo="${p._id}">
          <div class="fav-img-wrap">
            ${p.resourceType === 'video'
              ? `<video controls playsinline preload="metadata" aria-label="${esc(p.caption || 'Favourite video')}"><source src="${esc(url)}"></video>`
              : `<img src="${esc(url)}" alt="${esc(p.caption || 'Favourite')}" loading="lazy">`
            }
          </div>
          <div class="fav-caption">${esc(p.caption || 'A favourite moment')}</div>
          ${title ? `<div class="fav-chapter">${esc(title)}</div>` : ''}
        </figure>
      `;
    }).join('');
  } catch (err) {
    grid.innerHTML = `<div class="favs-empty"><div class="favs-empty-title">Could not load favourites</div></div>`;
  }
}

function closeFavs() {
  $('#favsPanel').classList.remove('is-open');
  $('#favsPanel').setAttribute('aria-hidden', 'true');
}

// ----------------------------------------------------------------
// 12. PHOTO UPLOAD
// ----------------------------------------------------------------
function attachDropZone(container, chapterId) {
  const zone = container.querySelector(`[data-chapter-id="${chapterId}"]`);
  if (!zone) return;

  zone.addEventListener('dragover', e => {
    e.preventDefault();
    zone.classList.add('drag-over');
  });
  zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
  zone.addEventListener('drop', e => {
    e.preventDefault();
    zone.classList.remove('drag-over');
    const files = [...e.dataTransfer.files].filter(f => f.type.startsWith('image/') || f.type.startsWith('video/'));
    if (files.length) uploadPhotos(files, chapterId);
  });
  zone.addEventListener('click', () => triggerPhotoInput(chapterId));

  // Also attach to ".photo-composition" if it already exists (add more photos)
  const comp = container.querySelector('.photo-composition');
  if (comp) {
    comp.addEventListener('dragover', e => {
      e.preventDefault();
      comp.style.outline = '2px dashed var(--deep)';
    });
    comp.addEventListener('dragleave', () => comp.style.outline = '');
    comp.addEventListener('drop', e => {
      e.preventDefault();
      comp.style.outline = '';
      const files = [...e.dataTransfer.files].filter(f => f.type.startsWith('image/') || f.type.startsWith('video/'));
      if (files.length) uploadPhotos(files, chapterId);
    });
  }
}

function triggerPhotoInput(chapterId) {
  const inp = $('#globalPhotoInput');
  inp.dataset.chapterId = chapterId;
  inp.click();
}

$('#globalPhotoInput')?.addEventListener('change', e => {
  const files      = Array.from(e.target.files);
  const chapterId  = e.target.dataset.chapterId;
  if (files.length && chapterId) uploadPhotos(files, chapterId);
  e.target.value = '';
});

$('#navAddPhotos')?.addEventListener('click', () => {
  const chapter = state.chapters[state.currentIdx];
  if (!chapter) { toast('Open a chapter first, then add media.'); return; }
  triggerPhotoInput(chapter._id);
});

async function uploadPhotos(files, chapterId) {
  const chapter = state.chapters.find(c => c._id === chapterId);
  if (!chapter) { toast('Chapter not found.'); return; }

  // Show progress in right page
  const rightContent = $('#pageRightContent');
  rightContent.innerHTML = `
    <div class="upload-progress" style="margin:20px; flex-direction:column; align-items:center; justify-content:center; height:calc(100% - 40px); gap:16px;">
      <div class="upload-progress-spinner" style="width:40px;height:40px;border-width:4px;"></div>
      <div class="upload-progress-text" id="uploadStatusText">
        Uploading ${files.length} ${files.length === 1 ? 'memory' : 'memories'} to Cloudinary…
      </div>
      <div style="font-family:var(--script);font-size:20px;color:var(--deep);">Please wait ♥</div>
    </div>
  `;

  try {
    const formData = new FormData();
    formData.append('chapterId', chapterId);
    files.forEach(f => formData.append('photos', f));

    const result = await api('/photos/upload', { method: 'POST', body: formData });
    state.photos = await api(`/photos/chapter/${chapterId}`);

    // Refresh chapters (cover photo may have been auto-set)
    await loadChapters();

    renderRightPage(chapter);
    toast(`✓ ${result.length} ${result.length === 1 ? 'memory' : 'memories'} added to this page! ♥`);
  } catch (err) {
    renderRightPage(chapter);
    toast(`Upload failed: ${err.message}`);
  }
}

// ----------------------------------------------------------------
// 13. PHOTO INTERACTIONS
// ----------------------------------------------------------------

// ---- DELETE CONFIRMATION MODAL ----
// Replaces browser confirm() with a styled password-gated modal
function confirmDelete(message, onConfirm) {
  const overlay = $('#deleteConfirmOverlay');
  const msgEl   = $('#deleteConfirmMsg');
  const pwdEl   = $('#deleteConfirmPassword');
  const errEl   = $('#deleteConfirmError');
  const btn     = $('#deleteConfirmBtn');

  if (!overlay || !btn) {
    // Fallback: plain confirm (should never happen in production)
    if (window.confirm(message)) onConfirm();
    return;
  }

  msgEl.textContent = message;
  pwdEl.value       = '';
  errEl.textContent = '';
  openModal('deleteConfirmOverlay');

  // Clone-replace button to remove old listeners
  const freshBtn = btn.cloneNode(true);
  btn.parentNode.replaceChild(freshBtn, freshBtn); // no-op guard
  const targetBtn = $('#deleteConfirmBtn');

  function handler() {
    const typed = pwdEl.value;
    if (typed !== 'hamiya@2410') {
      errEl.textContent = 'Incorrect password. Please try again.';
      pwdEl.value = '';
      pwdEl.focus();
      return;
    }
    closeModal('deleteConfirmOverlay');
    targetBtn.removeEventListener('click', handler);
    onConfirm();
  }
  targetBtn.addEventListener('click', handler);

  // Also allow Enter key inside password input
  function enterHandler(ev) {
    if (ev.key === 'Enter') { ev.preventDefault(); handler(); }
  }
  pwdEl.addEventListener('keydown', enterHandler);
  overlay.addEventListener('modal-close', () => {
    targetBtn.removeEventListener('click', handler);
    pwdEl.removeEventListener('keydown', enterHandler);
  }, { once: true });
}

// Delegated click on page-right content
document.addEventListener('click', async e => {

  // ---- OPEN LIGHTBOX ----
  const polaroid = e.target.closest('.polaroid');
  if (polaroid && !polaroid.classList.contains('polaroid--video') && !e.target.closest('.polaroid-action') && !e.target.closest('.polaroid-caption')) {
    const idx = parseInt(polaroid.dataset.photoIdx, 10);
    if (!isNaN(idx)) openLightbox(idx);
    return;
  }

  // ---- TOGGLE FAVOURITE ----
  const favBtn = e.target.closest('[data-fav]');
  if (favBtn && !favBtn.closest('.lightbox')) {
    e.stopPropagation();
    await toggleFav(favBtn.dataset.fav, favBtn);
    return;
  }

  // ---- CYCLE POLAROID SIZE ----
  const sizeBtn = e.target.closest('[data-cycle-size]');
  if (sizeBtn) {
    e.stopPropagation();
    await cyclePhotoSize(sizeBtn.dataset.cycleSize);
    return;
  }

  // ---- CAPTION BUTTON OR CAPTION TEXT ----
  const capBtn = e.target.closest('[data-caption-btn]');
  if (capBtn) {
    e.stopPropagation();
    openCaptionModal(capBtn.dataset.captionBtn);
    return;
  }

  const capText = e.target.closest('[data-caption-label]');
  if (capText) {
    e.stopPropagation();
    openCaptionModal(capText.dataset.captionLabel);
    return;
  }

  // ---- DELETE PHOTO ----
  const delBtn = e.target.closest('[data-del-photo]');
  if (delBtn && !delBtn.closest('.lightbox')) {
    e.stopPropagation();
    confirmDelete('This will permanently remove this photograph from the album and Cloudinary. This cannot be undone.', async () => {
      try {
        await api(`/photos/${delBtn.dataset.delPhoto}`, { method: 'DELETE' });
        toast('Photograph removed.');
        state.photos = await api(`/photos/chapter/${state.chapters[state.currentIdx]._id}`);
        renderRightPage(state.chapters[state.currentIdx]);
        await loadChapters();
      } catch (err) { toast(err.message); }
    });
    return;
  }

  // ---- ADD NOTE ----
  const addNote = e.target.closest('[data-add-note]');
  if (addNote) {
    openEntryModal(addNote.dataset.addNote);
    return;
  }

  // ---- EDIT ENTRY ----
  const editEntry = e.target.closest('[data-edit-entry]');
  if (editEntry) {
    const entry = state.entries.find(en => en._id === editEntry.dataset.editEntry);
    if (entry) openEntryModal(state.chapters[state.currentIdx]._id, entry);
    return;
  }

  // ---- DELETE ENTRY ----
  const delEntry = e.target.closest('[data-del-entry]');
  if (delEntry) {
    confirmDelete('This will permanently delete this memory note. It cannot be recovered.', async () => {
      try {
        await api(`/entries/${delEntry.dataset.delEntry}`, { method: 'DELETE' });
        state.entries = state.entries.filter(en => en._id !== delEntry.dataset.delEntry);
        renderLeftPage(state.chapters[state.currentIdx]);
        renderRightPage(state.chapters[state.currentIdx]);
        toast('Note deleted.');
      } catch (err) { toast(err.message); }
    });
    return;
  }

  // ---- EDIT CHAPTER ----
  const editCh = e.target.closest('[data-edit-chapter]');
  if (editCh) {
    openChapterModal(editCh.dataset.editChapter);
    return;
  }

  // ---- DELETE CHAPTER ----
  const delCh = e.target.closest('[data-del-chapter]');
  if (delCh) {
    confirmDelete('This will permanently delete this entire chapter and ALL its photographs and notes. This cannot be undone.', async () => {
      try {
        await api(`/chapters/${delCh.dataset.delChapter}`, { method: 'DELETE' });
        await loadChapters();
        toast('Chapter removed.');
        if (state.chapters.length > 0) {
          const newIdx = Math.min(state.currentIdx, state.chapters.length - 1);
          await renderChapterSpread(Math.max(0, newIdx), 'prev');
        } else {
          renderEmptySpread();
        }
      } catch (err) { toast(err.message); }
    });
    return;
  }

  // ---- MODAL CLOSE ----
  const closeBtn = e.target.closest('[data-modal-close]');
  if (closeBtn) {
    closeModal(closeBtn.dataset.modalClose);
    return;
  }

  // ---- UPLOAD ZONE BTN ----
  if (e.target.closest('#dropZoneBtn')) {
    const zone = e.target.closest('[data-chapter-id]');
    if (zone) triggerPhotoInput(zone.dataset.chapterId);
    return;
  }
});

async function toggleFav(photoId, btn) {
  try {
    const updated = await api(`/photos/${photoId}/favourite`, { method: 'POST' });
    // Update local state
    const p = state.photos.find(ph => ph._id === photoId);
    if (p) p.isFavourite = updated.isFavourite;
    // Re-render polaroid actions inline
    if (btn) {
      btn.classList.toggle('fav-active', updated.isFavourite);
      btn.innerHTML = updated.isFavourite
        ? '<svg width="13" height="13" viewBox="0 0 24 24" fill="#d81159" stroke="#d81159" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>'
        : '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>';
    }
    toast(updated.isFavourite ? '♥ Added to Favourites!' : 'Removed from Favourites');
  } catch (err) { toast(err.message); }
}

async function cyclePhotoSize(photoId) {
  const photo = state.photos.find(ph => ph._id === photoId);
  if (!photo) return;
  const sizes = ['small', 'standard', 'large'];
  const current = sizes.includes(photo.frameSize) ? photo.frameSize : 'standard';
  const next = sizes[(sizes.indexOf(current) + 1) % sizes.length];
  try {
    const updated = await api(`/photos/${photoId}`, { method: 'PUT', body: { frameSize: next } });
    Object.assign(photo, updated);
    renderRightPage(state.chapters[state.currentIdx]);
    toast(`Polaroid size: ${next} ♥`);
  } catch (err) { toast(err.message); }
}

// ----------------------------------------------------------------
// 14. LIGHTBOX
// ----------------------------------------------------------------
function openLightbox(idx) {
  state.lightList = state.photos;
  state.lightIdx  = Math.max(0, Math.min(idx, state.photos.length - 1));
  renderLightbox();
  $('#lightbox').classList.add('is-open');
  $('#lightbox').removeAttribute('aria-hidden');
  document.body.style.overflow = 'hidden';
}

function closeLightbox() {
  $('#lightbox').classList.remove('is-open');
  $('#lightbox').setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
}

function renderLightbox() {
  const p   = state.lightList[state.lightIdx];
  if (!p) return;
  const url = p.secureUrl || p.url || '';
  $('#lightboxImg').src = url;
  $('#lightboxImg').alt = p.caption || 'Memory photograph';
  $('#lightboxCaption').textContent = p.caption || '';
  $('#lightboxPrev').disabled = state.lightIdx <= 0;
  $('#lightboxNext').disabled = state.lightIdx >= state.lightList.length - 1;
  const favBtn = $('#lightboxFav');
  favBtn.innerHTML = p.isFavourite
    ? `<svg width="16" height="16" viewBox="0 0 24 24" fill="#ff6b8a" stroke="#ff6b8a" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg> Favourited`
    : `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg> Favourite`;
}

$('#lightboxClose')?.addEventListener('click', closeLightbox);
$('#lightboxBackdrop')?.addEventListener('click', closeLightbox);

$('#lightboxPrev')?.addEventListener('click', () => {
  if (state.lightIdx > 0) { state.lightIdx--; renderLightbox(); }
});
$('#lightboxNext')?.addEventListener('click', () => {
  if (state.lightIdx < state.lightList.length - 1) { state.lightIdx++; renderLightbox(); }
});

$('#lightboxFav')?.addEventListener('click', async () => {
  const p = state.lightList[state.lightIdx];
  if (!p) return;
  await toggleFav(p._id, null);
  renderLightbox();
});

$('#lightboxCapEdit')?.addEventListener('click', () => {
  const p = state.lightList[state.lightIdx];
  if (!p) return;
  closeLightbox();
  openCaptionModal(p._id);
});

$('#lightboxDelete')?.addEventListener('click', async () => {
  const p = state.lightList[state.lightIdx];
  if (!p) return;
  confirmDelete('This will permanently delete this photograph from Cloudinary and your album. It cannot be recovered.', async () => {
    try {
      await api(`/photos/${p._id}`, { method: 'DELETE' });
      closeLightbox();
      toast('Photograph removed.');
      state.photos = await api(`/photos/chapter/${state.chapters[state.currentIdx]._id}`);
      renderRightPage(state.chapters[state.currentIdx]);
      await loadChapters();
    } catch (err) { toast(err.message); }
  });
});

document.addEventListener('keydown', e => {
  if (!$('#lightbox').classList.contains('is-open')) return;
  if (e.key === 'Escape')     closeLightbox();
  if (e.key === 'ArrowLeft')  $('#lightboxPrev')?.click();
  if (e.key === 'ArrowRight') $('#lightboxNext')?.click();
});

// ----------------------------------------------------------------
// 15. CAPTION MODAL
// ----------------------------------------------------------------
function openCaptionModal(photoId) {
  const p = state.photos.find(ph => ph._id === photoId);
  $('#captionPhotoId').value  = photoId;
  $('#captionText').value     = p?.caption || '';
  $('#captionFrameSize').value = ['small', 'standard', 'large'].includes(p?.frameSize) ? p.frameSize : 'standard';
  openModal('captionModalOverlay');
  setTimeout(() => $('#captionText')?.focus(), 100);
}

$('#captionForm')?.addEventListener('submit', async e => {
  e.preventDefault();
  const photoId = $('#captionPhotoId').value;
  const caption = $('#captionText').value.trim();
  const frameSize = $('#captionFrameSize').value;
  try {
    const updated = await api(`/photos/${photoId}`, { method: 'PUT', body: { caption, frameSize } });
    // Update local
    const p = state.photos.find(ph => ph._id === photoId);
    if (p) Object.assign(p, updated);
    renderRightPage(state.chapters[state.currentIdx]);
    closeModal('captionModalOverlay');
    toast('Memory styling saved! ♥');
  } catch (err) { toast(err.message); }
});

// ----------------------------------------------------------------
// 16. CHAPTER MODAL
// ----------------------------------------------------------------
$('#navAddChapter')?.addEventListener('click', () => openChapterModal());

function openChapterModal(chapterId = null) {
  const form = $('#chapterForm');
  form.reset();
  $('#chapterFormId').value = chapterId || '';
  $('#chapterCoverName').textContent = 'No file chosen';

  const heading = $('#chapterModalHeading');

  if (chapterId) {
    const c = state.chapters.find(ch => ch._id === chapterId);
    if (c) {
      $('#chapterTitle').value    = c.title || '';
      $('#chapterDate').value     = c.date ? new Date(c.date).toISOString().split('T')[0] : '';
      $('#chapterLocation').value = c.location || '';
      $('#chapterDesc').value     = c.description || '';
      $('#chapterMood').value     = c.mood || '';
      if (heading) heading.innerHTML = 'Edit a <em>Chapter</em>';
    }
  } else {
    $('#chapterDate').value = new Date().toISOString().split('T')[0];
    if (heading) heading.innerHTML = 'Add a <em>Chapter</em>';
  }

  openModal('chapterModalOverlay');
  setTimeout(() => $('#chapterTitle')?.focus(), 100);
}

$('#chapterCover')?.addEventListener('change', e => {
  const f = e.target.files[0];
  $('#chapterCoverName').textContent = f ? f.name : 'No file chosen';
});

$('#chapterForm')?.addEventListener('submit', async e => {
  e.preventDefault();
  const id       = $('#chapterFormId').value;
  const title    = $('#chapterTitle').value.trim();
  const date     = $('#chapterDate').value;
  const location = $('#chapterLocation').value.trim();
  const desc     = $('#chapterDesc').value.trim();
  const mood     = $('#chapterMood').value;
  const cover    = $('#chapterCover')?.files?.[0];

  if (!title || !date) { toast('Please fill in the title and date.'); return; }

  try {
    let saved;
    if (id) {
      saved = await api(`/chapters/${id}`, { method: 'PUT', body: { title, date, location, description: desc, mood } });
      toast('Chapter updated! ♥');
    } else {
      saved = await api('/chapters', { method: 'POST', body: { title, date, location, description: desc, mood } });
      toast('New chapter added! ♥');
    }

    if (cover) {
      toast('Uploading cover photo to Cloudinary…');
      const fd = new FormData();
      fd.append('chapterId', saved._id);
      fd.append('photos', cover);
      await api('/photos/upload', { method: 'POST', body: fd });
      toast('Cover photo saved! ♥');
    }

    closeModal('chapterModalOverlay');
    await loadChapters();

    // Navigate to this chapter
    const newIdx = state.chapters.findIndex(c => c._id === saved._id);
    if (newIdx >= 0) {
      if (!$('#bookCover').classList.contains('is-open')) openAlbumCover();
      await new Promise(r => setTimeout(r, 1500));
      await renderChapterSpread(newIdx, 'next');
    }
  } catch (err) { toast(err.message); }
});

// ----------------------------------------------------------------
// 17. ENTRY / JOURNAL MODAL
// ----------------------------------------------------------------
$('#navAddNote')?.addEventListener('click', () => {
  const chapter = state.chapters[state.currentIdx];
  if (!chapter) { toast('Open a chapter first, then write a note.'); return; }
  openEntryModal(chapter._id);
});

$('#navAddTextPage')?.addEventListener('click', () => {
  const chapter = state.chapters[state.currentIdx];
  if (!chapter) { toast('Open a chapter first, then add a text page.'); return; }
  openEntryModal(chapter._id, null, 'between');
});

function openEntryModal(chapterId, entry = null, defaultPosition = 'notes') {
  const form = $('#entryForm');
  form.reset();
  $('#entryFormId').value         = entry?._id || '';
  $('#entryFormChapterId').value  = chapterId;
  $('#entryPagePosition').value   = entry?.pagePosition || defaultPosition;

  const heading = $('#entryModalHeading');

  if (entry) {
    $('#entryTitle').value = entry.title || '';
    // Content/quote may be encrypted; set raw for now, user can see it
    CryptoVault.open(entry.encryptedContent || entry.content || '').then(v => {
      $('#entryContent').value = v;
    });
    CryptoVault.open(entry.encryptedQuote || entry.quote || '').then(v => {
      $('#entryQuote').value = v;
    });
    if (heading) heading.innerHTML = 'Edit a <em>Memory</em>';
  } else {
    if (heading) heading.innerHTML = 'Write a <em>Memory</em>';
  }

  openModal('entryModalOverlay');
  setTimeout(() => $('#entryTitle')?.focus(), 100);
}

$('#entryForm')?.addEventListener('submit', async e => {
  e.preventDefault();
  const id        = $('#entryFormId').value;
  const chapterId = $('#entryFormChapterId').value;
  const title     = $('#entryTitle').value.trim();
  const content   = $('#entryContent').value.trim();
  const quote     = $('#entryQuote').value.trim();
  const pagePosition = $('#entryPagePosition').value;

  if (!title || !content) { toast('Title and content are required.'); return; }

  try {
    const encryptedContent = await CryptoVault.seal(content);
    const encryptedQuote   = await CryptoVault.seal(quote);
    const payload = { title, encryptedContent, encryptedQuote, pagePosition };

    if (id) {
      const updated = await api(`/entries/${id}`, { method: 'PUT', body: payload });
      state.entries = state.entries.map(en => en._id === id ? updated : en);
      toast('Memory note updated! ♥');
    } else {
      const created = await api(`/entries/chapter/${chapterId}`, { method: 'POST', body: payload });
      state.entries.push(created);
      toast('Memory note written! ♥');
    }

    closeModal('entryModalOverlay');
    renderLeftPage(state.chapters[state.currentIdx]);
    renderRightPage(state.chapters[state.currentIdx]);
  } catch (err) { toast(err.message); }
});

// ----------------------------------------------------------------
// 18. MODAL HELPERS
// ----------------------------------------------------------------
function openModal(id) {
  const el = $(`#${id}`);
  if (!el) return;
  el.classList.add('is-open');
  el.removeAttribute('aria-hidden');
  el.addEventListener('click', e => {
    if (e.target === el) closeModal(id);
  }, { once: true });
}

function closeModal(id) {
  const el = $(`#${id}`);
  if (!el) return;
  el.classList.remove('is-open');
  el.setAttribute('aria-hidden', 'true');
  el.dispatchEvent(new CustomEvent('modal-close'));
}

// All [data-modal-close] clicks handled by delegated listener above
// Escape key closes any open modal
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  ['chapterModalOverlay', 'entryModalOverlay', 'captionModalOverlay', 'backupModalOverlay', 'deleteConfirmOverlay'].forEach(id => {
    if ($(`#${id}`)?.classList.contains('is-open')) closeModal(id);
  });
  if ($('#indexPanel')?.classList.contains('is-open'))  closeIndex();
  if ($('#favsPanel')?.classList.contains('is-open'))   closeFavs();
  if ($('#lightbox')?.classList.contains('is-open'))    closeLightbox();
});

// ----------------------------------------------------------------
// 19. BACKUP & RESTORE
// ----------------------------------------------------------------
function openBackupModal() {
  openModal('backupModalOverlay');
}

$('#backupBtn')?.addEventListener('click', openBackupModal);
$('#indexBackupBtn')?.addEventListener('click', () => {
  closeIndex();
  openBackupModal();
});

$('#exportBackupBtn')?.addEventListener('click', async () => {
  try {
    toast('Preparing memory archive…');
    const res = await fetch('/api/backup', { credentials: 'same-origin' });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Backup download failed.');
    }
    const data = await res.json();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `our-story-backup-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast('✓ Memory archive downloaded! Keep it safe ♥');
  } catch (err) {
    toast(`Backup export error: ${err.message}`);
  }
});

$('#runRestoreBtn')?.addEventListener('click', async () => {
  const fileInput = $('#restoreFileInput');
  const file = fileInput?.files?.[0];
  if (!file) {
    toast('Please select a .json backup file first.');
    return;
  }

  const isReplace = $('#restoreReplaceMode')?.checked;

  async function doRestore(replaceMode) {
    try {
      toast('Restoring memories…');
      const text = await file.text();
      const backupData = JSON.parse(text);
      if (!backupData.data || !Array.isArray(backupData.data.chapters)) {
        throw new Error('Invalid backup file format.');
      }

      const res = await api('/backup/restore', {
        method: 'POST',
        body: { ...backupData, mode: replaceMode ? 'replace' : 'merge' }
      });

      closeModal('backupModalOverlay');
      fileInput.value = '';
      toast(`✓ ${res.message || 'Memories restored!'} ♥`);
      await loadChapters();
      if (state.chapters.length > 0) {
        await renderChapterSpread(0, 'next');
      } else {
        renderEmptySpread();
      }
    } catch (err) {
      toast(`Restore error: ${err.message}`);
    }
  }

  if (isReplace) {
    confirmDelete('WARNING: Replace mode will overwrite ALL your current chapters with the backup. This cannot be undone. Only proceed if you are sure.', () => {
      doRestore(true);
    });
  } else {
    await doRestore(false);
  }
});

// ----------------------------------------------------------------
// 19. RESIZE HANDLER
// ----------------------------------------------------------------
window.addEventListener('resize', () => {
  state.isMobile = window.innerWidth < 768;
  if (!state.isMobile) {
    // Reset mobile state
    state.showingRight = false;
    $('#bookSpread')?.classList.remove('show-right');
    $('#pageRight')?.classList.remove('mobile-media-active');
  }
  updateNav();
});

// ----------------------------------------------------------------
// 20. EXPOSE GLOBAL HELPER (used by inline onclick in emptySpread)
// ----------------------------------------------------------------
window.openChapterModal = openChapterModal;

// ----------------------------------------------------------------
// 21. BOOT
// ----------------------------------------------------------------
initApp().catch(err => {
  console.error('App boot error:', err);
  $('#loginError') && ($('#loginError').textContent = 'Could not connect. Please refresh.');
});

