// Our Story — Private Love Journal Frontend
const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];

const state = {
  csrf: '',
  user: null,
  chapters: [],
  currentChapterId: null,
  photos: [],
  favourites: [],
  lightboxList: [],
  lightboxIndex: 0,
  key: null
};

// API Client Helper
async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  const isFormData = options.body instanceof FormData;
  
  if (!isFormData && options.body && typeof options.body === 'object') {
    headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(options.body);
  }
  
  if (!['GET', 'HEAD'].includes(options.method || 'GET')) {
    if (state.csrf) {
      headers['x-csrf-token'] = state.csrf;
    }
  }

  const res = await fetch('/api' + path, {
    credentials: 'same-origin',
    ...options,
    headers
  });

  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(data.error || 'Something went wrong. Please try again.');
  }
  return data;
}

// Toast notification helper
function toast(message) {
  const el = $('#toast');
  if (!el) return;
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(el._timer);
  el._timer = setTimeout(() => el.classList.remove('show'), 3200);
}

// HTML escape helper
function esc(str) {
  return String(str || '').replace(/[&<>'"]/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  }[c]));
}

// Date formatter
function formatDate(d) {
  if (!d) return '';
  const date = new Date(d);
  if (isNaN(date.getTime())) return String(d);
  return date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
}

// CryptoVault (Optional client-side AES-256-GCM encryption for notes)
const CryptoVault = {
  async unlock(phrase) {
    if (!phrase) {
      state.key = null;
      return;
    }
    const material = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(phrase),
      'PBKDF2',
      false,
      ['deriveKey']
    );
    state.key = await crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: new TextEncoder().encode('our-story-v1'),
        iterations: 100000,
        hash: 'SHA-256'
      },
      material,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  },
  async seal(text) {
    if (!text) return '';
    if (!state.key) return text;
    try {
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const bytes = new TextEncoder().encode(text);
      const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, state.key, bytes);
      return JSON.stringify({
        iv: Array.from(iv),
        data: btoa(String.fromCharCode(...new Uint8Array(encrypted)))
      });
    } catch {
      return text;
    }
  },
  async open(stored) {
    if (!stored) return '';
    try {
      const parsed = JSON.parse(stored);
      if (parsed && parsed.iv && parsed.data) {
        if (!state.key) return '🔒 Encrypted memory — unlock with your private phrase.';
        const bytes = Uint8Array.from(atob(parsed.data), c => c.charCodeAt(0));
        const plain = await crypto.subtle.decrypt(
          { name: 'AES-GCM', iv: new Uint8Array(parsed.iv) },
          state.key,
          bytes
        );
        return new TextDecoder().decode(plain);
      }
    } catch {
      // not encrypted or plain text
    }
    return stored;
  }
};

// Navigation
function showSection(name) {
  const sections = ['cover', 'contents', 'journal', 'favourites', 'timeline'];
  sections.forEach(s => {
    const page = $(`#${s}Page`);
    if (page) page.hidden = (s !== name);
  });

  $$('.top-nav .nav-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.nav === name);
  });

  // Smooth scroll to top of section
  window.scrollTo({ top: 0, behavior: 'smooth' });

  if (name === 'favourites') {
    loadFavourites();
  } else if (name === 'timeline') {
    renderTimeline();
  } else if (name === 'contents') {
    renderContents($('#searchInput')?.value || '');
  }
}

// -------------------------------------------------------------
// Initialization & Authentication
// -------------------------------------------------------------
async function init() {
  try {
    const session = await api('/auth/session');
    state.csrf = session.csrfToken;
    if (session.authenticated) {
      state.user = session.user;
      await onUnlock();
    } else {
      showLock();
      loadUserChips();
    }
  } catch (err) {
    console.warn('Session init:', err.message);
    showLock();
  }
}

async function loadUserChips() {
  try {
    const users = await api('/auth/users');
    const container = $('#userChips');
    if (container && users && users.length) {
      container.innerHTML = users.map(u => 
        `<button type="button" class="chip" data-user="${esc(u)}">${esc(u)}</button>`
      ).join('');
    }
  } catch (e) {
    // ignore
  }
}

function showLock() {
  $('#lockScreen').hidden = false;
  $('#albumApp').hidden = true;
  $('#topbar').hidden = true;
  $('#appFooter').hidden = true;
}

async function onUnlock() {
  $('#lockScreen').hidden = true;
  $('#albumApp').hidden = false;
  $('#topbar').hidden = false;
  $('#appFooter').hidden = false;

  if (state.user) {
    $('#userPill').textContent = `♥ ${state.user.username}`;
  }

  await loadChapters();
  showSection('cover');
}

// Quick user chips click
document.addEventListener('click', e => {
  const chip = e.target.closest('[data-user]');
  if (chip) {
    const input = $('#loginUsername');
    if (input) input.value = chip.dataset.user;
  }
});

// Login Form Submit
$('#loginForm')?.addEventListener('submit', async e => {
  e.preventDefault();
  const errorEl = $('#loginError');
  errorEl.textContent = '';
  
  const username = $('#loginUsername').value.trim();
  const password = $('#loginPassword').value;
  const phrase = $('#loginPhrase')?.value;

  try {
    if (phrase) {
      await CryptoVault.unlock(phrase);
    }
    const res = await api('/auth/login', {
      method: 'POST',
      body: { username, password }
    });
    state.csrf = res.csrfToken;
    state.user = res.user;
    await onUnlock();
    toast(`Welcome back, ${res.user.username}! ♥`);
  } catch (err) {
    errorEl.textContent = err.message;
  }
});

// Quick Unlock Button (instant 1-click unlock)
$('#quickUnlockBtn')?.addEventListener('click', async () => {
  const errorEl = $('#loginError');
  errorEl.textContent = '';
  try {
    const res = await api('/auth/quick-unlock', { method: 'POST' });
    state.csrf = res.csrfToken;
    state.user = res.user;
    await onUnlock();
    toast('Unlocked Our Story album! ♥');
  } catch (err) {
    errorEl.textContent = err.message;
  }
});

// Toggle register form
$('#toggleRegisterBtn')?.addEventListener('click', () => {
  $('#loginForm').hidden = true;
  $('#registerForm').hidden = false;
});

$('#cancelRegisterBtn')?.addEventListener('click', () => {
  $('#loginForm').hidden = false;
  $('#registerForm').hidden = true;
});

// Register / Reset account
$('#registerForm')?.addEventListener('submit', async e => {
  e.preventDefault();
  const errorEl = $('#regError');
  errorEl.textContent = '';
  const username = $('#regUsername').value.trim();
  const password = $('#regPassword').value;

  try {
    const res = await api('/auth/register', {
      method: 'POST',
      body: { username, password }
    });
    state.csrf = res.csrfToken;
    state.user = res.user;
    await onUnlock();
    toast(`Account for ${username} is ready! ♥`);
  } catch (err) {
    errorEl.textContent = err.message;
  }
});

// Lock Album button
$('#lockBtn')?.addEventListener('click', async () => {
  try {
    await api('/auth/logout', { method: 'POST' });
  } finally {
    state.user = null;
    state.key = null;
    showLock();
    toast('Journal safely locked.');
  }
});

// Navigation clicks
document.addEventListener('click', e => {
  const navBtn = e.target.closest('[data-nav]');
  if (navBtn) {
    e.preventDefault();
    showSection(navBtn.dataset.nav);
    $('#topNav')?.classList.remove('open');
  }
});

// Mobile menu toggle
$('#menuToggle')?.addEventListener('click', () => {
  $('.top-nav')?.classList.toggle('open');
});

// -------------------------------------------------------------
// Chapters Logic
// -------------------------------------------------------------
async function loadChapters() {
  state.chapters = await api('/chapters');
  renderContents($('#searchInput')?.value || '');
  renderTimeline();
  updateCoverStats();
  populateYearFilter();
}

function updateCoverStats() {
  const statsEl = $('#coverStats');
  if (!statsEl) return;
  const count = state.chapters.length;
  statsEl.innerHTML = `<span>✦ ${count} ${count === 1 ? 'Chapter' : 'Chapters'} written</span> · <span>Kept with love ♥</span>`;
}

function populateYearFilter() {
  const yearSelect = $('#yearFilter');
  if (!yearSelect) return;
  const years = [...new Set(state.chapters.map(c => new Date(c.date).getFullYear()).filter(Boolean))].sort((a,b) => b - a);
  const currentVal = yearSelect.value;
  yearSelect.innerHTML = '<option value="">Any year</option>' + years.map(y => `<option value="${y}">${y}</option>`).join('');
  yearSelect.value = currentVal;
}

// Render Table of Contents
function renderContents(query = '') {
  const listEl = $('#contentsList');
  if (!listEl) return;

  const term = query.toLowerCase().trim();
  const year = $('#yearFilter')?.value || '';
  const month = $('#monthFilter')?.value || '';
  const mood = $('#moodFilter')?.value || '';

  const filtered = state.chapters.filter(c => {
    const d = new Date(c.date);
    const y = String(d.getFullYear());
    const m = String(d.getMonth() + 1).padStart(2, '0');
    
    if (year && y !== year) return false;
    if (month && m !== month) return false;
    if (mood && c.mood !== mood) return false;
    if (term) {
      const match = [c.title, c.location, c.description, c.mood].join(' ').toLowerCase();
      if (!match.includes(term)) return false;
    }
    return true;
  });

  if (!filtered.length) {
    listEl.innerHTML = `
      <div class="empty-state" style="grid-column: 1 / -1; text-align: center; padding: 48px 20px;">
        <p class="script" style="font-size: 32px; color: var(--deep);">The page is still unwritten…</p>
        <p style="color: var(--ink-muted);">No chapters match your search. Add a new chapter to begin!</p>
        <button class="btn-primary" style="margin-top: 14px;" onclick="$('#newChapterBtn').click()">+ Write a New Chapter</button>
      </div>
    `;
    return;
  }

  listEl.innerHTML = filtered.map((c, idx) => {
    const coverUrl = c.coverPhotoId?.secureUrl || c.coverPhotoId?.url || '';
    const chapterNum = String(c.chapterNumber || idx + 1).padStart(2, '0');
    
    return `
      <article class="chapter-card" data-open-chapter="${c._id}">
        <div class="card-cover">
          ${coverUrl 
            ? `<img src="${esc(coverUrl)}" alt="${esc(c.title)}" loading="lazy">` 
            : `<div class="cover-placeholder">♥</div>`
          }
          <span class="card-badge">Chapter ${chapterNum}</span>
          ${c.mood ? `<span class="card-mood">${esc(c.mood)}</span>` : ''}
        </div>
        <div class="card-body">
          <time class="card-date">${formatDate(c.date)}${c.location ? ' · ' + esc(c.location) : ''}</time>
          <h3>${esc(c.title)}</h3>
          <p>${esc(c.description || 'A cherished day in our journey…')}</p>
          <span class="card-link">Open this page <span>→</span></span>
        </div>
      </article>
    `;
  }).join('');
}

// Search and filter listeners
$('#searchInput')?.addEventListener('input', e => renderContents(e.target.value));
['yearFilter', 'monthFilter', 'moodFilter'].forEach(id => {
  $(`#${id}`)?.addEventListener('change', () => renderContents($('#searchInput')?.value || ''));
});

$('#toggleSearchBtn')?.addEventListener('click', () => {
  const panel = $('#searchPanel');
  if (panel) {
    panel.hidden = !panel.hidden;
    if (!panel.hidden) $('#searchInput')?.focus();
  }
});

// Click chapter card to open
document.addEventListener('click', e => {
  const card = e.target.closest('[data-open-chapter]');
  if (card) {
    e.preventDefault();
    openChapter(card.dataset.openChapter);
  }
});

// -------------------------------------------------------------
// Journal / Chapter Detail View
// -------------------------------------------------------------
async function openChapter(chapterId) {
  state.currentChapterId = chapterId;
  const chapter = state.chapters.find(c => c._id === chapterId);
  if (!chapter) return;

  showSection('journal');
  renderChapter(chapter);
  
  // Load photos and entries
  await Promise.all([
    loadPhotos(chapterId),
    loadNotes(chapterId)
  ]);

  updateDockNav();
}

function renderChapter(c) {
  const container = $('#chapterViewContainer');
  if (!container) return;

  const num = String(c.chapterNumber || 1).padStart(2, '0');

  container.innerHTML = `
    <!-- Chapter Hero -->
    <header class="chapter-hero">
      <div class="breadcrumbs">Our Story / Chapter ${num} / ${esc(c.title)}</div>
      <p class="eyebrow">CHAPTER ${num} ${c.mood ? '· ' + esc(c.mood) : ''}</p>
      <h2>${esc(c.title)}</h2>
      <p class="chapter-meta">${formatDate(c.date)}${c.location ? ' · ' + esc(c.location) : ''}</p>
      <p class="script">Some days become memories before they even end.</p>
      <p class="chapter-desc">${esc(c.description || '')}</p>
      
      <div class="chapter-tools">
        <button class="btn-outline" data-edit-chapter="${c._id}">✎ Edit Chapter</button>
        <button class="btn-outline" data-delete-chapter="${c._id}" style="color: #9d334f; border-color: #f1ccd6;">🗑 Delete Chapter</button>
      </div>
    </header>

    <!-- Photo Album Section -->
    <section class="album-block">
      <div class="album-header">
        <div>
          <h3>Pictures from this day</h3>
          <p class="script">little moments, kept forever.</p>
        </div>
        <div class="album-actions">
          <label class="btn-primary" style="display: inline-flex; align-items: center; gap: 6px; cursor: pointer;">
            + Add Photographs
            <input type="file" id="chapterPhotoInput" multiple accept="image/jpeg,image/png,image/webp,image/heic,image/gif" hidden>
          </label>
        </div>
      </div>

      <!-- Upload Progress Card (hidden by default) -->
      <div class="upload-progress-card" id="uploadProgress" hidden>
        <div class="spinner"></div>
        <div>
          <strong id="uploadStatusText">Uploading photographs to Cloudinary…</strong>
          <p style="margin: 0; font-size: 12px; color: var(--ink-muted);">Please wait while your memories are preserved.</p>
        </div>
      </div>

      <!-- Drag & Drop Dropzone -->
      <div class="dropzone" id="chapterDropzone" data-drop-chapter="${c._id}">
        <div class="dropzone-icon">📷</div>
        <div class="dropzone-text">
          <strong>Drag and drop photographs here</strong>
          <small>or click "+ Add Photographs" above to choose images</small>
        </div>
      </div>

      <!-- Polaroid Photo Grid -->
      <div class="photo-masonry-grid" id="chapterPhotos">
        <!-- Rendered by loadPhotos() -->
      </div>
    </section>

    <!-- Journal Notes Section -->
    <section class="writing-block">
      <div class="album-header">
        <div>
          <h3>Little Things I Remember</h3>
          <p class="script">Because not every memory fits inside a photograph.</p>
        </div>
        <button class="btn-secondary" data-add-note="${c._id}">✎ Write a Note</button>
      </div>

      <div class="notes-grid" id="chapterNotes">
        <!-- Rendered by loadNotes() -->
      </div>
    </section>
  `;

  // Attach event listener to new file input
  const fileInput = $('#chapterPhotoInput');
  if (fileInput) {
    fileInput.addEventListener('change', e => {
      if (e.target.files && e.target.files.length) {
        uploadPhotos(Array.from(e.target.files), c._id);
        e.target.value = '';
      }
    });
  }

  // Attach Drag and Drop listeners
  const dropzone = $('#chapterDropzone');
  if (dropzone) {
    ['dragenter', 'dragover'].forEach(eventName => {
      dropzone.addEventListener(eventName, e => {
        e.preventDefault();
        dropzone.classList.add('dragover');
      });
    });

    ['dragleave', 'drop'].forEach(eventName => {
      dropzone.addEventListener(eventName, e => {
        e.preventDefault();
        dropzone.classList.remove('dragover');
      });
    });

    dropzone.addEventListener('drop', e => {
      e.preventDefault();
      const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'));
      if (files.length) {
        uploadPhotos(files, c._id);
      }
    });

    dropzone.addEventListener('click', () => {
      $('#chapterPhotoInput')?.click();
    });
  }
}

// Floating dock navigation (prev / next chapter)
function updateDockNav() {
  const currIdx = state.chapters.findIndex(c => c._id === state.currentChapterId);
  const prevBtn = $('#dockPrev');
  const nextBtn = $('#dockNext');
  
  if (prevBtn) {
    prevBtn.disabled = currIdx <= 0;
  }
  if (nextBtn) {
    nextBtn.disabled = currIdx < 0 || currIdx >= state.chapters.length - 1;
  }
}

$('#dockPrev')?.addEventListener('click', () => {
  const currIdx = state.chapters.findIndex(c => c._id === state.currentChapterId);
  if (currIdx > 0) {
    openChapter(state.chapters[currIdx - 1]._id);
  }
});

$('#dockNext')?.addEventListener('click', () => {
  const currIdx = state.chapters.findIndex(c => c._id === state.currentChapterId);
  if (currIdx >= 0 && currIdx < state.chapters.length - 1) {
    openChapter(state.chapters[currIdx + 1]._id);
  }
});

$('#dockContents')?.addEventListener('click', () => {
  showSection('contents');
});

// -------------------------------------------------------------
// Photos & Cloudinary Upload Logic
// -------------------------------------------------------------
async function loadPhotos(chapterId) {
  try {
    state.photos = await api(`/photos/chapter/${chapterId}`);
    renderPhotos(state.photos);
  } catch (err) {
    console.warn('Error loading photos:', err.message);
  }
}

function renderPhotos(photos) {
  const grid = $('#chapterPhotos');
  if (!grid) return;

  if (!photos.length) {
    grid.innerHTML = `
      <div style="grid-column: 1 / -1; text-align: center; padding: 36px 20px; background: rgba(255,255,255,0.6); border-radius: 8px;">
        <p class="script" style="font-size: 26px; color: var(--deep); margin: 0 0 6px;">Pictures belong here.</p>
        <p style="color: var(--ink-muted); margin: 0;">Add your first memories from this day using "+ Add Photographs".</p>
      </div>
    `;
    return;
  }

  const currentChapter = state.chapters.find(c => c._id === state.currentChapterId);

  grid.innerHTML = photos.map((p, idx) => {
    const isCover = currentChapter && (
      (typeof currentChapter.coverPhotoId === 'object' && currentChapter.coverPhotoId?._id === p._id) ||
      currentChapter.coverPhotoId === p._id
    );
    const photoUrl = p.secureUrl || p.url;

    return `
      <figure class="polaroid-card" data-photo-id="${p._id}" data-photo-idx="${idx}">
        <div class="polaroid-media" data-open-lightbox="${idx}">
          <img src="${esc(photoUrl)}" alt="${esc(p.caption || 'Memory photograph')}" loading="lazy">
          ${isCover ? '<span class="cover-badge-tag">Cover Photo</span>' : ''}
        </div>

        <div class="polaroid-actions">
          <button class="photo-action-btn ${p.isFavourite ? 'active-fav' : ''}" data-toggle-fav="${p._id}" title="Favourite photo">
            ${p.isFavourite ? '♥' : '♡'}
          </button>
          <button class="photo-action-btn" data-edit-caption="${p._id}" title="Edit caption">
            ✎
          </button>
          <button class="photo-action-btn" data-make-cover="${p._id}" title="Set as chapter cover">
            ★
          </button>
          <button class="photo-action-btn" data-delete-photo="${p._id}" title="Delete photo" style="color: #c92a2a;">
            ×
          </button>
        </div>

        <figcaption class="polaroid-caption" data-edit-caption="${p._id}">
          ${esc(p.caption || 'A moment kept forever…')}
        </figcaption>
      </figure>
    `;
  }).join('');
}

// Upload Photos directly to Cloudinary via server endpoint
async function uploadPhotos(files, chapterId) {
  if (!files || !files.length || !chapterId) return;

  const progressCard = $('#uploadProgress');
  const statusText = $('#uploadStatusText');
  if (progressCard) {
    progressCard.hidden = false;
    if (statusText) {
      statusText.textContent = `Uploading ${files.length} ${files.length === 1 ? 'photo' : 'photos'} to Cloudinary… ♥`;
    }
  }

  toast(`Uploading ${files.length} photographs to Cloudinary…`);

  try {
    const formData = new FormData();
    formData.append('chapterId', chapterId);
    files.forEach(file => {
      formData.append('photos', file);
    });

    const newPhotos = await api('/photos/upload', {
      method: 'POST',
      body: formData
    });

    toast(`✓ ${newPhotos.length} ${newPhotos.length === 1 ? 'photo' : 'photos'} safely saved to Cloudinary! ♥`);
    
    // Refresh chapter photos & chapters list
    await Promise.all([
      loadPhotos(chapterId),
      loadChapters()
    ]);
  } catch (err) {
    console.error('Upload failed:', err);
    toast(`Upload failed: ${err.message}`);
  } finally {
    if (progressCard) progressCard.hidden = true;
  }
}

// Photo Actions (Favourite, Make Cover, Caption, Delete)
document.addEventListener('click', async e => {
  // Toggle favourite
  const favBtn = e.target.closest('[data-toggle-fav]');
  if (favBtn) {
    e.stopPropagation();
    const photoId = favBtn.dataset.toggleFav;
    try {
      const updated = await api(`/photos/${photoId}/favourite`, { method: 'POST' });
      favBtn.classList.toggle('active-fav', updated.isFavourite);
      favBtn.textContent = updated.isFavourite ? '♥' : '♡';
      toast(updated.isFavourite ? 'Added to favourites! ♥' : 'Removed from favourites.');
      // Update local array
      const idx = state.photos.findIndex(p => p._id === photoId);
      if (idx !== -1) state.photos[idx] = updated;
    } catch (err) {
      toast(err.message);
    }
    return;
  }

  // Make Cover photo
  const coverBtn = e.target.closest('[data-make-cover]');
  if (coverBtn) {
    e.stopPropagation();
    const photoId = coverBtn.dataset.makeCover;
    try {
      await api(`/photos/${photoId}/make-cover`, { method: 'POST' });
      toast('Set as chapter cover photograph! ★');
      await loadChapters();
      if (state.currentChapterId) {
        await loadPhotos(state.currentChapterId);
      }
    } catch (err) {
      toast(err.message);
    }
    return;
  }

  // Edit Caption
  const capBtn = e.target.closest('[data-edit-caption]');
  if (capBtn) {
    e.stopPropagation();
    const photoId = capBtn.dataset.editCaption;
    const photo = state.photos.find(p => p._id === photoId);
    $('#captionPhotoId').value = photoId;
    $('#captionInput').value = photo?.caption || '';
    $('#captionModal')?.showModal();
    return;
  }

  // Delete Photo
  const delBtn = e.target.closest('[data-delete-photo]');
  if (delBtn) {
    e.stopPropagation();
    const photoId = delBtn.dataset.deletePhoto;
    if (confirm('Delete this photograph from Cloudinary and your album?')) {
      try {
        await api(`/photos/${photoId}`, { method: 'DELETE' });
        toast('Photograph removed.');
        if (state.currentChapterId) {
          await loadPhotos(state.currentChapterId);
          await loadChapters();
        }
      } catch (err) {
        toast(err.message);
      }
    }
    return;
  }
});

// Caption Modal Submit
$('#captionForm')?.addEventListener('submit', async e => {
  e.preventDefault();
  const photoId = $('#captionPhotoId').value;
  const caption = $('#captionInput').value.trim();

  try {
    const updated = await api(`/photos/${photoId}`, {
      method: 'PUT',
      body: { caption }
    });
    $('#captionModal')?.close();
    toast('Caption saved! ♥');
    const idx = state.photos.findIndex(p => p._id === photoId);
    if (idx !== -1) state.photos[idx] = updated;
    renderPhotos(state.photos);
  } catch (err) {
    toast(err.message);
  }
});

// -------------------------------------------------------------
// Journal Entries (Notes) Logic
// -------------------------------------------------------------
async function loadNotes(chapterId) {
  try {
    const notes = await api(`/entries/chapter/${chapterId}`);
    renderNotes(notes);
  } catch (err) {
    console.warn('Error loading notes:', err.message);
  }
}

async function renderNotes(notes) {
  const container = $('#chapterNotes');
  if (!container) return;

  if (!notes.length) {
    container.innerHTML = `
      <div style="grid-column: 1 / -1; text-align: center; padding: 24px; color: var(--ink-muted);">
        <p style="margin: 0;">No notes written yet. Click "Write a Note" to capture little thoughts and moments.</p>
      </div>
    `;
    return;
  }

  const items = await Promise.all(notes.map(async n => {
    const content = await CryptoVault.open(n.encryptedContent);
    const quote = await CryptoVault.open(n.encryptedQuote);

    return `
      <article class="note-card" data-note-id="${n._id}">
        <h4>${esc(n.title)}</h4>
        <div class="note-content">${esc(content)}</div>
        ${quote ? `<blockquote class="note-quote">“${esc(quote)}”</blockquote>` : ''}
        <div class="note-tools">
          <button data-edit-note="${n._id}" data-title="${esc(n.title)}" data-content="${esc(content)}" data-quote="${esc(quote)}">Edit</button>
          <button data-delete-note="${n._id}" style="color: #9d334f;">Delete</button>
        </div>
      </article>
    `;
  }));

  container.innerHTML = items.join('');
}

// Add Note click
document.addEventListener('click', e => {
  const addBtn = e.target.closest('[data-add-note]');
  if (addBtn) {
    const form = $('#entryForm');
    form.reset();
    $('#entryFormId').value = '';
    $('#entryFormChapterId').value = addBtn.dataset.addNote;
    $('#entryModalTitle').innerHTML = 'Write a <em>Note</em>';
    $('#entryModal')?.showModal();
    return;
  }

  const editBtn = e.target.closest('[data-edit-note]');
  if (editBtn) {
    const form = $('#entryForm');
    form.reset();
    $('#entryFormId').value = editBtn.dataset.editNote;
    $('#entryFormChapterId').value = state.currentChapterId;
    $('#entryFormTitle').value = editBtn.dataset.title || '';
    $('#entryFormContent').value = editBtn.dataset.content || '';
    $('#entryFormQuote').value = editBtn.dataset.quote || '';
    $('#entryModalTitle').innerHTML = 'Edit <em>Note</em>';
    $('#entryModal')?.showModal();
    return;
  }

  const delBtn = e.target.closest('[data-delete-note]');
  if (delBtn) {
    const noteId = delBtn.dataset.deleteNote;
    if (confirm('Delete this memory note?')) {
      api(`/entries/${noteId}`, { method: 'DELETE' }).then(() => {
        toast('Note deleted.');
        loadNotes(state.currentChapterId);
      }).catch(err => toast(err.message));
    }
    return;
  }
});

// Entry form submit
$('#entryForm')?.addEventListener('submit', async e => {
  e.preventDefault();
  const noteId = $('#entryFormId').value;
  const chapterId = $('#entryFormChapterId').value || state.currentChapterId;
  const title = $('#entryFormTitle').value.trim();
  const content = $('#entryFormContent').value.trim();
  const quote = $('#entryFormQuote').value.trim();

  try {
    const encryptedContent = await CryptoVault.seal(content);
    const encryptedQuote = await CryptoVault.seal(quote);

    if (noteId) {
      await api(`/entries/${noteId}`, {
        method: 'PUT',
        body: { title, encryptedContent, encryptedQuote }
      });
      toast('Memory note updated! ♥');
    } else {
      await api(`/entries/chapter/${chapterId}`, {
        method: 'POST',
        body: { title, encryptedContent, encryptedQuote }
      });
      toast('New memory note kept safely! ♥');
    }

    $('#entryModal')?.close();
    await loadNotes(chapterId);
  } catch (err) {
    toast(err.message);
  }
});

// -------------------------------------------------------------
// Add / Edit / Delete Chapter
// -------------------------------------------------------------
$('#newChapterBtn')?.addEventListener('click', () => {
  const form = $('#chapterForm');
  form.reset();
  $('#chapterFormId').value = '';
  $('#chapterFormDate').value = new Date().toISOString().split('T')[0];
  $('#chapterModalEyebrow').textContent = 'A NEW PAGE';
  $('#chapterModalTitle').innerHTML = 'Add a <em>Chapter</em>';
  $('#chapterModal')?.showModal();
});

$('#endingAddChapterBtn')?.addEventListener('click', () => {
  $('#newChapterBtn')?.click();
});

$('#footerNewChapter')?.addEventListener('click', () => {
  $('#newChapterBtn')?.click();
});

// Edit Chapter click
document.addEventListener('click', e => {
  const editBtn = e.target.closest('[data-edit-chapter]');
  if (editBtn) {
    const c = state.chapters.find(ch => ch._id === editBtn.dataset.editChapter);
    if (!c) return;
    const form = $('#chapterForm');
    form.reset();
    $('#chapterFormId').value = c._id;
    $('#chapterFormTitle').value = c.title || '';
    $('#chapterFormDate').value = c.date ? new Date(c.date).toISOString().split('T')[0] : '';
    $('#chapterFormLocation').value = c.location || '';
    $('#chapterFormDesc').value = c.description || '';
    $('#chapterFormMood').value = c.mood || '';
    $('#chapterModalEyebrow').textContent = 'EDIT THIS PAGE';
    $('#chapterModalTitle').innerHTML = 'Edit <em>Chapter</em>';
    $('#chapterModal')?.showModal();
    return;
  }

  const delBtn = e.target.closest('[data-delete-chapter]');
  if (delBtn) {
    const chapterId = delBtn.dataset.deleteChapter;
    if (confirm('Delete this chapter and all of its photographs and notes?')) {
      api(`/chapters/${chapterId}`, { method: 'DELETE' }).then(async () => {
        toast('Chapter and memories deleted.');
        await loadChapters();
        showSection('contents');
      }).catch(err => toast(err.message));
    }
    return;
  }
});

// Chapter Form Submit
$('#chapterForm')?.addEventListener('submit', async e => {
  e.preventDefault();
  const form = e.target;
  const id = $('#chapterFormId').value;
  const title = $('#chapterFormTitle').value.trim();
  const date = $('#chapterFormDate').value;
  const location = $('#chapterFormLocation').value.trim();
  const description = $('#chapterFormDesc').value.trim();
  const mood = $('#chapterFormMood').value;
  const coverFile = $('#chapterFormCover')?.files?.[0];

  const payload = { title, date, location, description, mood };

  try {
    let savedChapter;
    if (id) {
      savedChapter = await api(`/chapters/${id}`, { method: 'PUT', body: payload });
      toast('Chapter updated! ♥');
    } else {
      savedChapter = await api('/chapters', { method: 'POST', body: payload });
      toast('A beautiful new chapter was saved! ♥');
    }

    // If cover photograph was chosen, upload it directly to Cloudinary
    if (coverFile) {
      toast('Uploading cover photograph to Cloudinary…');
      const formData = new FormData();
      formData.append('chapterId', savedChapter._id);
      formData.append('photos', coverFile);
      await api('/photos/upload', { method: 'POST', body: formData });
      toast('Cover photograph saved to Cloudinary! ♥');
    }

    form.closest('dialog')?.close();
    await loadChapters();
    openChapter(savedChapter._id);
  } catch (err) {
    toast(err.message);
  }
});

// -------------------------------------------------------------
// Favourites View
// -------------------------------------------------------------
async function loadFavourites() {
  const grid = $('#favouritesGrid');
  if (!grid) return;

  try {
    state.favourites = await api('/photos/favourites');
    if (!state.favourites.length) {
      grid.innerHTML = `
        <div style="grid-column: 1 / -1; text-align: center; padding: 48px 20px;">
          <p class="script" style="font-size: 32px; color: var(--deep); margin-bottom: 6px;">Save the special ones</p>
          <p style="color: var(--ink-muted);">Tap the heart icon (♡) on any photograph in a chapter to keep it here.</p>
        </div>
      `;
      return;
    }

    grid.innerHTML = state.favourites.map((p, idx) => {
      const photoUrl = p.secureUrl || p.url;
      const chapterTitle = p.chapterId?.title || 'Chapter';
      return `
        <figure class="polaroid-card" data-fav-idx="${idx}">
          <div class="polaroid-media" data-open-fav-light="${idx}">
            <img src="${esc(photoUrl)}" alt="${esc(p.caption || 'Favourite memory')}" loading="lazy">
          </div>
          <figcaption class="polaroid-caption">
            ${esc(p.caption || 'A favourite memory')}
            <br>
            <small style="font-family: var(--ui); font-size: 11px; color: var(--deep); font-weight: 500;">
              from "${esc(chapterTitle)}"
            </small>
          </figcaption>
        </figure>
      `;
    }).join('');
  } catch (err) {
    console.warn('Favourites error:', err.message);
  }
}

// -------------------------------------------------------------
// Timeline View
// -------------------------------------------------------------
function renderTimeline() {
  const container = $('#timelineList');
  if (!container) return;

  if (!state.chapters.length) {
    container.innerHTML = `
      <div style="text-align: center; padding: 40px; color: var(--ink-muted);">
        <p class="script" style="font-size: 26px; color: var(--deep);">Our journey is just beginning.</p>
        <p>Your timeline will grow with every chapter you write.</p>
      </div>
    `;
    return;
  }

  // Sort chronologically
  const sorted = [...state.chapters].sort((a,b) => new Date(a.date) - new Date(b.date));

  container.innerHTML = sorted.map((c, idx) => {
    const coverUrl = c.coverPhotoId?.secureUrl || c.coverPhotoId?.url || '';
    const num = String(c.chapterNumber || idx + 1).padStart(2, '0');

    return `
      <div class="timeline-node">
        <div class="node-dot"></div>
        <div class="node-card" data-open-chapter="${c._id}">
          ${coverUrl ? `<div class="node-thumb"><img src="${esc(coverUrl)}" alt="${esc(c.title)}" loading="lazy"></div>` : ''}
          <time class="card-date">Chapter ${num} · ${formatDate(c.date)}</time>
          <h3 style="font-size: 22px; margin: 4px 0 6px;">${esc(c.title)}</h3>
          <p style="color: var(--ink-muted); font-size: 13px; margin: 0;">
            ${esc(c.location ? c.location + ' — ' : '')}${esc(c.description || 'A memory in our story.')}
          </p>
        </div>
      </div>
    `;
  }).join('');
}

// -------------------------------------------------------------
// Lightbox View
// -------------------------------------------------------------
function openLightbox(list, index) {
  state.lightboxList = list;
  state.lightboxIndex = Math.max(0, Math.min(index, list.length - 1));
  renderLightbox();
  $('#lightbox')?.showModal();
}

function renderLightbox() {
  const p = state.lightboxList[state.lightboxIndex];
  if (!p) return;

  const img = $('#lightImage');
  const cap = $('#lightCaption');
  const badge = $('#lightChapterBadge');
  const favBtn = $('#lightFav');
  const coverBtn = $('#lightMakeCover');

  const url = p.secureUrl || p.url;
  img.src = url;
  cap.textContent = p.caption || '';
  
  if (p.chapterId?.title) {
    badge.textContent = `Chapter: ${p.chapterId.title}`;
    badge.hidden = false;
  } else {
    badge.hidden = true;
  }

  favBtn.textContent = p.isFavourite ? '♥ Favourited' : '♡ Add to Favourites';
  
  $('#lightPrev').disabled = state.lightboxIndex <= 0;
  $('#lightNext').disabled = state.lightboxIndex >= state.lightboxList.length - 1;
}

$('#lightPrev')?.addEventListener('click', () => {
  if (state.lightboxIndex > 0) {
    state.lightboxIndex--;
    renderLightbox();
  }
});

$('#lightNext')?.addEventListener('click', () => {
  if (state.lightboxIndex < state.lightboxList.length - 1) {
    state.lightboxIndex++;
    renderLightbox();
  }
});

$('#lightFav')?.addEventListener('click', async () => {
  const p = state.lightboxList[state.lightboxIndex];
  if (!p) return;
  try {
    const updated = await api(`/photos/${p._id}/favourite`, { method: 'POST' });
    p.isFavourite = updated.isFavourite;
    state.lightboxList[state.lightboxIndex] = updated;
    renderLightbox();
    toast(updated.isFavourite ? 'Added to favourites! ♥' : 'Removed from favourites.');
    if (state.currentChapterId) loadPhotos(state.currentChapterId);
  } catch (err) {
    toast(err.message);
  }
});

$('#lightMakeCover')?.addEventListener('click', async () => {
  const p = state.lightboxList[state.lightboxIndex];
  if (!p) return;
  try {
    await api(`/photos/${p._id}/make-cover`, { method: 'POST' });
    toast('Set as chapter cover photograph! ★');
    await loadChapters();
    if (state.currentChapterId) loadPhotos(state.currentChapterId);
  } catch (err) {
    toast(err.message);
  }
});

// Click photo in album to open lightbox
document.addEventListener('click', e => {
  const trigger = e.target.closest('[data-open-lightbox]');
  if (trigger) {
    const idx = parseInt(trigger.dataset.openLightbox, 10);
    openLightbox(state.photos, idx);
    return;
  }

  const favTrigger = e.target.closest('[data-open-fav-light]');
  if (favTrigger) {
    const idx = parseInt(favTrigger.dataset.openFavLight, 10);
    openLightbox(state.favourites, idx);
    return;
  }
});

// Modal Close buttons
document.addEventListener('click', e => {
  if (e.target.matches('[data-close]') || e.target.closest('[data-close]')) {
    const dialog = e.target.closest('dialog');
    dialog?.close();
  }
});

// Keyboard navigation
window.addEventListener('keydown', e => {
  const lightbox = $('#lightbox');
  if (lightbox && lightbox.open) {
    if (e.key === 'ArrowLeft') $('#lightPrev')?.click();
    if (e.key === 'ArrowRight') $('#lightNext')?.click();
    if (e.key === 'Escape') lightbox.close();
  }
});

// Start the application
init();
