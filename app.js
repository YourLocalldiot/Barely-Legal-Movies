'use strict';

/* =========================================================
   BARELY LEGAL MOVIES
   - Movie data:   OMDb API (https://www.omdbapi.com)
   - Free streams: Internet Archive public-domain feature films
                   (https://archive.org/details/feature_films)
   No ads, no trackers, no third-party pirate embeds.
   ========================================================= */

const DEFAULT_API_KEY = '47096182';
const OMDB_URL = 'https://www.omdbapi.com/';
const ARCHIVE_SEARCH_URL = 'https://archive.org/advancedsearch.php';
const ARCHIVE_EMBED_URL = 'https://archive.org/embed/';
const DEFAULT_QUERY = 'Project Hail Mary';

// Recent theatrical releases (2025–2026), verified against OMDb.
const NEW_RELEASE_IDS = [
  'tt12042730', // Project Hail Mary (2026)
  'tt22084616', // Spider-Man: Brand New Day (2026)
  'tt33764258', // The Odyssey (2026)
  'tt8814476',  // Supergirl (2026)
  'tt29355505', // Toy Story 5 (2026)
  'tt30825738', // The Mandalorian and Grogu (2026)
  'tt11378946', // Michael (2026)
  'tt28650488', // The Super Mario Galaxy Movie (2026)
  'tt1757678',  // Avatar: Fire and Ash (2025)
  'tt26443597', // Zootopia 2 (2025)
  'tt19847976', // Wicked: For Good (2025)
  'tt31193180', // Sinners (2025)
];

// Public-domain classics that stream in full, for free, via the Internet Archive.
const FREE_CLASSIC_IDS = [
  'tt0063350', // Night of the Living Dead (1968)
  'tt0032599', // His Girl Friday (1940)
  'tt0013442', // Nosferatu (1922)
  'tt0017925', // The General (1926)
  'tt0058700', // The Last Man on Earth (1964)
  'tt0037638', // Detour (1945)
  'tt0054033', // The Little Shop of Horrors (1960)
  'tt0052077', // Plan 9 from Outer Space (1957)
  'tt0016220', // The Phantom of the Opera (1925)
  'tt0042369', // D.O.A. (1949)
  'tt0055830', // Carnival of Souls (1962)
  'tt0015324', // Sherlock Jr. (1924)
];

const STORAGE = {
  get(key, fallback) {
    try {
      const v = window.localStorage.getItem(key);
      return v === null ? fallback : v;
    } catch (_) {
      return fallback;
    }
  },
  set(key, value) {
    try { window.localStorage.setItem(key, value); } catch (_) { /* storage unavailable */ }
  },
  remove(key) {
    try { window.localStorage.removeItem(key); } catch (_) { /* storage unavailable */ }
  }
};

const state = {
  apiKey: STORAGE.get('blm_api_key', DEFAULT_API_KEY),
  crtEffect: STORAGE.get('blm_crt', 'on') !== 'off',
  menuExpanded: false,
  selectedMovie: null,
  lastQuery: '',
  searchToken: 0,
  movieToken: 0,
  streamToken: 0,
  internalNavs: 0,
  loaded: { new: false, classics: false },
  cache: new Map()
};

const $ = (id) => document.getElementById(id);

/* ---------- Utilities ---------- */

function esc(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// OMDb sometimes returns pre-encoded entities (e.g. "O&apos;Dea"). Decode them
// safely as text (DOMParser never executes scripts) so esc() doesn't double-encode.
const entityParser = typeof DOMParser !== 'undefined' ? new DOMParser() : null;
function decodeEntities(str) {
  if (!entityParser || typeof str !== 'string' || str.indexOf('&') === -1) return str;
  return entityParser.parseFromString(`<!doctype html><body>${str}`, 'text/html').body.textContent || '';
}

function cleanRecord(obj) {
  const out = {};
  Object.keys(obj || {}).forEach((k) => {
    out[k] = typeof obj[k] === 'string' ? decodeEntities(obj[k]) : obj[k];
  });
  return out;
}

function val(value) {
  return value && value !== 'N/A' ? value : '';
}

function updateStatus(msg) {
  const el = $('status-text');
  if (el) el.textContent = msg;
}

function notice(container, text) {
  container.innerHTML = `<div class="notice">${esc(text)}</div>`;
}

async function fetchJSON(url, timeoutMs = 15000) {
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
  try {
    const res = await fetch(url, ctrl ? { signal: ctrl.signal } : undefined);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function omdbUrl(params) {
  const qs = new URLSearchParams({ ...params, apikey: state.apiKey });
  return `${OMDB_URL}?${qs.toString()}`;
}

async function getMovie(imdbID) {
  if (state.cache.has(imdbID)) return state.cache.get(imdbID);
  const data = await fetchJSON(omdbUrl({ i: imdbID, plot: 'full' }));
  if (data.Response !== 'True') throw new Error(data.Error || 'Movie not found');
  const movie = cleanRecord(data);
  state.cache.set(imdbID, movie);
  return movie;
}

function isValidImdbId(id) {
  return /^tt\d{5,10}$/.test(id);
}

/* ---------- Init ---------- */

document.addEventListener('DOMContentLoaded', () => {
  initMenuToggle();
  initNav();
  initSearch();
  initSettings();
  initPlayerButtons();
  applyCrt();

  window.addEventListener('hashchange', () => {
    state.internalNavs++;
    handleRoute();
  });
  handleRoute();
});

/* ---------- Routing (hash based so the back button works) ---------- */

function navigate(hash) {
  if (window.location.hash === hash) {
    handleRoute();
  } else {
    window.location.hash = hash;
  }
}

function handleRoute() {
  const raw = window.location.hash.replace(/^#\/?/, '');
  const [route, ...rest] = raw.split('/');
  const param = rest.length ? decodeURIComponent(rest.join('/')) : '';

  if (route !== 'movie') stopPlayback();

  switch (route) {
    case 'new':
      showTab('new');
      if (!state.loaded.new) loadList(NEW_RELEASE_IDS, $('new-movies'), 'new');
      break;
    case 'classics':
      showTab('classics');
      if (!state.loaded.classics) loadList(FREE_CLASSIC_IDS, $('classic-movies'), 'classics');
      break;
    case 'settings':
      showTab('settings');
      break;
    case 'movie':
      if (isValidImdbId(param)) {
        openMovie(param);
      } else {
        navigate('#/home');
      }
      break;
    case 'search':
      showTab('home');
      if (param) runSearch(param);
      break;
    default:
      showTab('home');
      if (!state.lastQuery) runSearch(DEFAULT_QUERY);
  }
}

function showTab(tabName) {
  document.querySelectorAll('.nav-box-item').forEach((btn) => {
    const active = btn.dataset.tab === tabName;
    btn.classList.toggle('active', active);
    if (active) btn.setAttribute('aria-current', 'page');
    else btn.removeAttribute('aria-current');
  });

  document.querySelectorAll('.tab-content').forEach((content) => {
    content.classList.toggle('active', content.id === `tab-${tabName}`);
  });

  setMenu(false);
  window.scrollTo(0, 0);
  updateStatus(`SWIFT_NAV >> [${tabName.toUpperCase()}]`);
}

/* ---------- Menu ---------- */

function setMenu(open) {
  state.menuExpanded = open;
  const navMenu = $('nav-menu');
  const menuBtn = $('menu-toggle-btn');
  if (navMenu) navMenu.classList.toggle('expanded', open);
  if (menuBtn) {
    menuBtn.classList.toggle('active', open);
    menuBtn.setAttribute('aria-expanded', String(open));
  }
}

function initMenuToggle() {
  const menuBtn = $('menu-toggle-btn');
  if (!menuBtn) return;
  menuBtn.addEventListener('click', () => {
    setMenu(!state.menuExpanded);
    updateStatus(`NAV_MENU >> ${state.menuExpanded ? 'EXPANDED' : 'COLLAPSED'}`);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && state.menuExpanded) setMenu(false);
  });
}

function initNav() {
  document.querySelectorAll('.nav-box-item').forEach((item) => {
    item.addEventListener('click', () => navigate(`#/${item.dataset.tab}`));
  });
  const logo = $('logo-home');
  if (logo) logo.addEventListener('click', () => navigate('#/home'));
}

/* ---------- Search ---------- */

function initSearch() {
  const topInput = $('top-search-input');
  const homeInput = $('home-search-input');
  const homeBtn = $('home-search-btn');

  const submit = (input) => {
    const q = input.value.trim();
    if (!q) {
      updateStatus('INPUT_ERR >> ENTER A MOVIE TITLE');
      input.focus();
      return;
    }
    input.blur(); // closes the on-screen keyboard on mobile
    navigate(`#/search/${encodeURIComponent(q)}`);
  };

  if (topInput) {
    topInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); submit(topInput); }
    });
  }
  if (homeInput) {
    homeInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); submit(homeInput); }
    });
  }
  if (homeBtn && homeInput) homeBtn.addEventListener('click', () => submit(homeInput));
}

async function runSearch(rawQuery) {
  const container = $('home-search-results');
  if (!container) return;

  // OMDb's firewall rejects markup-like input; titles never need these characters.
  const query = String(rawQuery).replace(/[<>{}\\`]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100);
  if (!query) {
    notice(container, 'ENTER A MOVIE TITLE TO SEARCH.');
    return;
  }

  state.lastQuery = query;
  const homeInput = $('home-search-input');
  if (homeInput && homeInput.value.trim() !== query) homeInput.value = query;
  const topInput = $('top-search-input');
  if (topInput) topInput.value = '';

  const token = ++state.searchToken;
  updateStatus(`FETCHING >> QUERY: "${query}"`);
  container.innerHTML = '<div class="notice loading">-- SEARCHING OMDb DATABASE --</div>';

  try {
    const data = await fetchJSON(omdbUrl({ s: query }));
    if (token !== state.searchToken) return; // a newer search started

    if (data.Response === 'True' && Array.isArray(data.Search)) {
      const movies = dedupe(data.Search).map(cleanRecord);
      container.innerHTML = `<div class="path-header">RESULTS FOR "${esc(query)}" [${movies.length}]</div>`;
      renderMovieGrid(container, movies, false);
      updateStatus(`OMDb_SUCCESS >> ${movies.length} RESULTS`);
    } else {
      const errText = data.Error || 'No movies found.';
      const friendly = /too many/i.test(errText)
        ? 'TOO MANY RESULTS: type a longer, more specific title.'
        : /api key/i.test(errText)
          ? `API KEY PROBLEM: ${errText} Reset or change the key in Settings.`
          : `NO MATCHES FOR "${query}". Check the spelling and try again.`;
      notice(container, friendly);
      updateStatus(`OMDb_ERR >> ${errText.toUpperCase()}`);
    }
  } catch (err) {
    if (token !== state.searchToken) return;
    console.warn('Search failed:', err);
    const blocked = /HTTP (401|403)/.test(err.message);
    notice(container, blocked
      ? 'REQUEST REJECTED BY OMDb. Try a plain movie title, or check your API key in Settings.'
      : 'CONNECTION_ERROR: Could not reach OMDb. Check your internet connection and try again.');
    updateStatus('OMDb_ERR >> NETWORK/API ERROR');
  }
}

function dedupe(list) {
  const seen = new Set();
  return list.filter((m) => m && m.imdbID && !seen.has(m.imdbID) && seen.add(m.imdbID));
}

/* ---------- Movie grids ---------- */

function renderMovieGrid(container, movies, append = true) {
  if (!append) {
    const header = container.querySelector('.path-header');
    container.innerHTML = '';
    if (header) container.appendChild(header);
  }

  const grid = document.createElement('div');
  grid.className = 'movie-grid';

  movies.forEach((movie) => {
    const card = document.createElement('a');
    card.className = 'movie-card';
    card.href = `#/movie/${encodeURIComponent(movie.imdbID)}`;
    card.setAttribute('aria-label', `${movie.Title} (${movie.Year})`);

    const poster = val(movie.Poster);
    const posterHTML = poster
      ? `<img src="${esc(poster)}" class="poster-img" alt="" loading="lazy" decoding="async" />`
      : '<span class="no-poster">[NO POSTER]</span>';

    card.innerHTML = `
      <div class="poster-box">${posterHTML}</div>
      <div class="movie-card-title">${esc(movie.Title)}</div>
      <div class="movie-card-meta">
        <span>${esc(movie.Year)}</span>
        <span>${esc((movie.Type || 'movie').toUpperCase())}</span>
      </div>
    `;

    const img = card.querySelector('img');
    if (img) {
      img.addEventListener('error', () => {
        img.replaceWith(Object.assign(document.createElement('span'), {
          className: 'no-poster',
          textContent: '[NO POSTER]'
        }));
      }, { once: true });
    }

    grid.appendChild(card);
  });

  container.appendChild(grid);
}

async function loadList(ids, container, key) {
  if (!container) return;
  notice(container, '-- LOADING TERMINAL DATA --');
  container.firstChild.classList.add('loading');

  const results = await Promise.allSettled(ids.map((id) => getMovie(id)));
  const movies = results.filter((r) => r.status === 'fulfilled').map((r) => r.value);

  if (movies.length) {
    container.innerHTML = '';
    renderMovieGrid(container, movies);
    state.loaded[key] = true;
    updateStatus(`OMDb_SUCCESS >> ${movies.length} TITLES LOADED`);
  } else {
    container.innerHTML = `
      <div class="notice">FAILED TO LOAD MOVIES. Check your connection or API key.</div>
      <button type="button" class="terminal-btn block-btn" data-retry>[ RETRY ]</button>`;
    container.querySelector('[data-retry]').addEventListener('click', () => loadList(ids, container, key));
    updateStatus('OMDb_ERR >> LIST LOAD FAILED');
  }
}

/* ---------- Player view ---------- */

function initPlayerButtons() {
  const back = $('player-back-btn');
  if (back) {
    back.addEventListener('click', () => {
      // Only go "back" if the previous page was inside this site.
      if (state.internalNavs > 0) window.history.back();
      else navigate('#/home');
    });
  }
}

async function openMovie(imdbID) {
  showTab('player');
  const token = ++state.movieToken;

  $('player-path-header').textContent = 'Home/Movies/...';
  $('player-details').innerHTML = '<div class="loading">-- FETCHING MOVIE DETAILS --</div>';
  resetPlayerScreen(null);
  updateStatus(`FETCHING_DETAILS >> ${imdbID}`);

  try {
    const movie = await getMovie(imdbID);
    if (token !== state.movieToken) return;
    state.selectedMovie = movie;
    renderPlayerView(movie);
  } catch (err) {
    if (token !== state.movieToken) return;
    console.warn('Details failed:', err);
    $('player-path-header').textContent = 'Home/Movies/ERROR';
    $('player-details').innerHTML = `<div class="notice">COULD NOT LOAD MOVIE DETAILS: ${esc(err.message)}</div>`;
    updateStatus('OMDb_ERR >> DETAILS UNAVAILABLE');
  }
}

function resetPlayerScreen(movie) {
  const screen = $('player-screen');
  if (!screen) return;
  state.streamToken++;

  const poster = movie ? val(movie.Poster) : '';
  const titleTag = movie ? `${movie.Title} ${movie.Year}` : 'LOADING...';

  screen.innerHTML = `
    <div class="fake-player-art">
      <span class="player-title-tag">${esc(titleTag)}</span>
      <button type="button" class="play-overlay-btn" ${movie ? '' : 'disabled'}>&#9654; STREAM NOW</button>
    </div>`;

  const art = screen.querySelector('.fake-player-art');
  if (poster) {
    art.style.backgroundImage =
      `linear-gradient(rgba(0,0,0,0.6), rgba(0,0,0,0.85)), url("${poster.replace(/"/g, '%22')}")`;
  }
  if (movie) screen.querySelector('.play-overlay-btn').addEventListener('click', () => startStream(movie));

  $('player-source').textContent = '[SRC: --]';
}

function renderPlayerView(movie) {
  $('player-path-header').textContent = `Home/Movies/${movie.Title}`;
  document.title = `${movie.Title} (${movie.Year}) - BARELY LEGAL MOVIES`;
  resetPlayerScreen(movie);

  $('player-runtime').textContent = `▶ ${val(movie.Runtime) || '?? min'}`;
  $('player-rated').textContent = `[${val(movie.Rated) || 'NR'}]`;

  const rows = [
    ['TITLE', movie.Title],
    ['RELEASED', [val(movie.Released), val(movie.Runtime) && `(${movie.Runtime})`].filter(Boolean).join(' ')],
    ['GENRE', val(movie.Genre)],
    ['DIRECTOR', val(movie.Director)],
    ['CAST', val(movie.Actors)],
    ['RATING', val(movie.imdbRating) ? `IMDb ${movie.imdbRating}/10${val(movie.imdbVotes) ? ` (${movie.imdbVotes} votes)` : ''}` : ''],
    ['PLOT', val(movie.Plot)]
  ].filter(([, v]) => v);

  $('player-details').innerHTML = rows
    .map(([label, v]) => `<div class="detail-row"><span class="detail-label">${label}:</span><span class="detail-value">${esc(v)}</span></div>`)
    .join('');

  updateStatus(`PLAYER_LOADED >> ${movie.Title}`);
}

function stopPlayback() {
  const screen = $('player-screen');
  if (screen && screen.querySelector('iframe, video')) screen.innerHTML = '';
  state.streamToken++;
  if (!/^#\/?movie/.test(window.location.hash)) document.title = 'BARELY LEGAL MOVIES - Terminal Movie Player';
}

/* ---------- Free legal streams (Internet Archive) ---------- */

function normTitle(t) {
  return String(t || '')
    .toLowerCase()
    .replace(/\(.*?\)|\[.*?\]/g, ' ')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/^(the|a|an) /, '')
    .replace(/\s+/g, ' ')
    .trim();
}

async function findArchiveStream(movie) {
  const year = parseInt(movie.Year, 10);
  const words = normTitle(movie.Title).split(' ').filter(Boolean);
  if (!words.length) return null;

  const q = `collection:feature_films AND mediatype:movies AND title:(${words.join(' AND ')})`;
  const params = new URLSearchParams({ q, rows: '25', output: 'json' });
  ['identifier', 'title', 'year', 'date', 'downloads'].forEach((f) => params.append('fl[]', f));
  params.append('sort[]', 'downloads desc');

  const data = await fetchJSON(`${ARCHIVE_SEARCH_URL}?${params.toString()}`);
  const docs = (data && data.response && data.response.docs) || [];
  const want = normTitle(movie.Title);

  const match = docs.find((d) => {
    const t = normTitle(Array.isArray(d.title) ? d.title[0] : d.title);
    if (t !== want && !t.startsWith(`${want} `)) return false;
    const dy = parseInt(d.year || String(d.date || '').slice(0, 4), 10);
    if (!Number.isNaN(dy) && !Number.isNaN(year)) return Math.abs(dy - year) <= 1;
    // no year on the archive item: accept only when the year appears in its title/identifier
    return !Number.isNaN(year) && `${d.title} ${d.identifier}`.includes(String(year));
  });

  return match ? match.identifier : null;
}

async function startStream(movie) {
  const screen = $('player-screen');
  if (!screen || !movie) return;
  const token = ++state.streamToken;

  screen.innerHTML = '<div class="player-message loading">-- SCANNING PUBLIC-DOMAIN ARCHIVE --</div>';
  updateStatus(`STREAM_LOOKUP >> ${movie.Title}`);

  let identifier = null;
  let failed = false;
  try {
    identifier = await findArchiveStream(movie);
  } catch (err) {
    console.warn('Archive lookup failed:', err);
    failed = true;
  }
  if (token !== state.streamToken) return; // user navigated away

  if (identifier) {
    screen.innerHTML = `
      <iframe class="player-video"
        src="${ARCHIVE_EMBED_URL}${encodeURIComponent(identifier)}"
        title="${esc(movie.Title)} - Internet Archive player"
        allow="autoplay; fullscreen; picture-in-picture"
        referrerpolicy="strict-origin-when-cross-origin"></iframe>`;
    $('player-source').textContent = '[SRC: INTERNET ARCHIVE]';
    updateStatus(`STREAM_ACTIVE >> PLAYING: ${movie.Title}`);
    return;
  }

  const trailer = `https://www.youtube.com/results?search_query=${encodeURIComponent(`${movie.Title} ${movie.Year} official trailer`)}`;
  const where = `https://www.justwatch.com/us/search?q=${encodeURIComponent(movie.Title)}`;
  screen.innerHTML = `
    <div class="player-message">
      <div class="msg-title">${failed ? 'ARCHIVE_UNREACHABLE' : 'NO FREE LEGAL STREAM FOUND'}</div>
      <p>${failed
        ? 'Could not reach the Internet Archive. Try again in a moment.'
        : 'This title is still under copyright, so it has no free public-domain copy. Try the [FREE CLASSICS] tab for full movies.'}</p>
      <div class="msg-actions">
        <a class="terminal-btn outline-btn" href="${esc(trailer)}" target="_blank" rel="noopener noreferrer">&#9654; TRAILER</a>
        <a class="terminal-btn outline-btn" href="${esc(where)}" target="_blank" rel="noopener noreferrer">WHERE TO WATCH</a>
        <button type="button" class="terminal-btn outline-btn" data-retry>&#8635; RETRY</button>
      </div>
    </div>`;
  screen.querySelector('[data-retry]').addEventListener('click', () => startStream(movie));
  $('player-source').textContent = '[SRC: NONE]';
  updateStatus(failed ? 'STREAM_ERR >> ARCHIVE UNREACHABLE' : `STREAM_NONE >> ${movie.Title} NOT IN PUBLIC DOMAIN`);
}

/* ---------- Settings ---------- */

function applyCrt() {
  const overlay = $('crt-overlay');
  if (overlay) overlay.hidden = !state.crtEffect;
  const toggle = $('crt-toggle');
  if (toggle) toggle.checked = state.crtEffect;
}

function initSettings() {
  const crtToggle = $('crt-toggle');
  const apiKeyInput = $('api-key-input');
  const saveKeyBtn = $('save-key-btn');
  const resetKeyBtn = $('reset-key-btn');
  const msg = $('settings-msg');

  if (crtToggle) {
    crtToggle.addEventListener('change', (e) => {
      state.crtEffect = e.target.checked;
      STORAGE.set('blm_crt', state.crtEffect ? 'on' : 'off');
      applyCrt();
      updateStatus(`SYS_CONFIG >> CRT FILTER: ${state.crtEffect ? 'ENABLED' : 'DISABLED'}`);
    });
  }

  const setMsg = (text) => { if (msg) msg.textContent = text; };

  if (apiKeyInput) apiKeyInput.value = state.apiKey === DEFAULT_API_KEY ? '' : state.apiKey;

  if (saveKeyBtn && apiKeyInput) {
    const save = async () => {
      const key = apiKeyInput.value.trim();
      if (!key) {
        setMsg('> ENTER A KEY, OR PRESS RESET TO USE THE BUILT-IN KEY.');
        return;
      }
      if (!/^[a-zA-Z0-9]{6,16}$/.test(key)) {
        setMsg('> INVALID FORMAT. OMDb KEYS ARE 8 LETTERS/NUMBERS.');
        return;
      }
      setMsg('> TESTING KEY...');
      try {
        const qs = new URLSearchParams({ i: 'tt0063350', apikey: key });
        const data = await fetchJSON(`${OMDB_URL}?${qs.toString()}`);
        if (data.Response !== 'True') throw new Error(data.Error || 'Rejected');
        state.apiKey = key;
        STORAGE.set('blm_api_key', key);
        setMsg('> KEY VERIFIED AND SAVED.');
        updateStatus('SYS_CONFIG >> API KEY UPDATED');
      } catch (err) {
        setMsg(`> KEY REJECTED: ${err.message}`);
      }
    };
    saveKeyBtn.addEventListener('click', save);
    apiKeyInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); save(); } });
  }

  if (resetKeyBtn && apiKeyInput) {
    resetKeyBtn.addEventListener('click', () => {
      state.apiKey = DEFAULT_API_KEY;
      STORAGE.remove('blm_api_key');
      apiKeyInput.value = '';
      setMsg('> USING BUILT-IN KEY.');
      updateStatus('SYS_CONFIG >> API KEY RESET');
    });
  }
}
