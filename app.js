'use strict';

/* =========================================================
   BARELY LEGAL MOVIES
   - Movie data:   TMDB (primary, when a key is set in config.js
                   or Settings), OMDb (fallback)
   - Free streams: Internet Archive public-domain feature films
                   (https://archive.org/details/feature_films)
   No ads, no trackers, no third-party pirate embeds.
   ========================================================= */

const CONFIG = Object.assign(
  { TMDB_API_KEY: '', OMDB_API_KEY: '47096182' },
  (typeof window !== 'undefined' && window.BLM_CONFIG) || {}
);

const OMDB_URL = 'https://www.omdbapi.com/';
const TMDB_URL = 'https://api.themoviedb.org/3';
const TMDB_IMG = 'https://image.tmdb.org/t/p/';
const ARCHIVE_SEARCH_URL = 'https://archive.org/advancedsearch.php';
const ARCHIVE_EMBED_URL = 'https://archive.org/embed/';
const YOUTUBE_EMBED_URL = 'https://www.youtube-nocookie.com/embed/';
const DEFAULT_QUERY = 'Project Hail Mary';

// Recent theatrical releases (2025–2026), verified against OMDb.
// Used for [NEW RELEASES] when no TMDB key is set; with TMDB the tab shows "now playing".
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
  omdbKey: STORAGE.get('blm_api_key', CONFIG.OMDB_API_KEY),
  tmdbKey: STORAGE.get('blm_tmdb_key', CONFIG.TMDB_API_KEY),
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

const useTmdb = () => Boolean(state.tmdbKey);
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

function val(value) {
  if (typeof value === 'string') value = decodeEntities(value).trim();
  return value && value !== 'N/A' ? value : '';
}

function updateStatus(msg) {
  const el = $('status-text');
  if (el) el.textContent = msg;
}

function notice(container, text) {
  container.innerHTML = `<div class="notice">${esc(text)}</div>`;
}

async function fetchJSON(url, options = {}, timeoutMs = 15000) {
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
  try {
    const res = await fetch(url, ctrl ? { ...options, signal: ctrl.signal } : options);
    if (!res.ok) {
      let detail = '';
      try { detail = (await res.json()).status_message || ''; } catch (_) { /* not JSON */ }
      const err = new Error(detail || `HTTP ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return await res.json();
  } finally {
    if (timer) clearTimeout(timer);
  }
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function formatDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
  return m ? `${m[3]} ${MONTHS[Number(m[2]) - 1]} ${m[1]}` : '';
}

const isImdbId = (id) => /^tt\d{5,10}$/.test(id);
const isTmdbId = (id) => /^\d{1,9}$/.test(id);

/* ---------- OMDb provider ---------- */

function omdbRequest(params, key = state.omdbKey) {
  const qs = new URLSearchParams({ ...params, apikey: key });
  return fetchJSON(`${OMDB_URL}?${qs.toString()}`);
}

function omdbListItem(m) {
  return {
    id: m.imdbID,
    imdbID: m.imdbID,
    title: val(m.Title),
    year: val(m.Year),
    poster: val(m.Poster),
    type: (val(m.Type) || 'movie').toUpperCase()
  };
}

function omdbMovie(m) {
  const rating = val(m.imdbRating);
  const votes = val(m.imdbVotes);
  return {
    ...omdbListItem(m),
    source: 'OMDb',
    released: val(m.Released),
    runtime: val(m.Runtime),
    rated: val(m.Rated),
    genre: val(m.Genre),
    director: val(m.Director),
    cast: val(m.Actors),
    rating: rating ? `IMDb ${rating}/10${votes ? ` (${votes} votes)` : ''}` : '',
    plot: val(m.Plot),
    trailerKey: ''
  };
}

async function omdbDetails(imdbID) {
  const data = await omdbRequest({ i: imdbID, plot: 'full' });
  if (data.Response !== 'True') throw new Error(data.Error || 'Movie not found');
  return omdbMovie(data);
}

async function omdbSearch(query) {
  const data = await omdbRequest({ s: query });
  if (data.Response !== 'True' || !Array.isArray(data.Search)) {
    const err = new Error(data.Error || 'No movies found.');
    err.empty = /not found|too many/i.test(err.message); // otherwise it's a key/API problem
    throw err;
  }
  return data.Search.map(omdbListItem);
}

/* ---------- TMDB provider ---------- */

// v4 "Read Access Token" is a JWT (starts with "eyJ"); v3 "API Key" is 32 hex chars.
const isTmdbToken = (key) => /^eyJ/.test(key);

function tmdbRequest(path, params = {}, key = state.tmdbKey) {
  const qs = new URLSearchParams({ language: 'en-US', ...params });
  const options = { headers: { Accept: 'application/json' } };
  if (isTmdbToken(key)) options.headers.Authorization = `Bearer ${key}`;
  else qs.set('api_key', key);
  return fetchJSON(`${TMDB_URL}${path}?${qs.toString()}`, options);
}

function tmdbImage(path, size) {
  return path ? `${TMDB_IMG}${size}${path}` : '';
}

function tmdbListItem(m) {
  return {
    id: String(m.id),
    imdbID: '',
    title: val(m.title || m.name),
    year: (m.release_date || '').slice(0, 4),
    poster: tmdbImage(m.poster_path, 'w342'),
    type: 'MOVIE'
  };
}

function pickTrailer(videos) {
  const list = ((videos && videos.results) || []).filter((v) => v.site === 'YouTube' && v.key);
  const rank = (v) => (v.type === 'Trailer' ? 0 : v.type === 'Teaser' ? 2 : 4) + (v.official ? 0 : 1);
  list.sort((a, b) => rank(a) - rank(b));
  return list.length ? list[0].key : '';
}

function usCertification(releaseDates) {
  const us = ((releaseDates && releaseDates.results) || []).find((r) => r.iso_3166_1 === 'US');
  const hit = us && us.release_dates.find((d) => d.certification);
  return hit ? hit.certification : '';
}

function tmdbMovie(d) {
  const credits = d.credits || {};
  const directors = (credits.crew || []).filter((c) => c.job === 'Director').map((c) => c.name);
  const cast = (credits.cast || []).slice(0, 4).map((c) => c.name);
  return {
    ...tmdbListItem(d),
    imdbID: d.imdb_id || (d.external_ids && d.external_ids.imdb_id) || '',
    source: 'TMDB',
    released: formatDate(d.release_date),
    runtime: d.runtime ? `${d.runtime} min` : '',
    rated: usCertification(d.release_dates),
    genre: (d.genres || []).map((g) => g.name).join(', '),
    director: directors.join(', '),
    cast: cast.join(', '),
    rating: d.vote_count
      ? `TMDB ${Number(d.vote_average).toFixed(1)}/10 (${Number(d.vote_count).toLocaleString('en-US')} votes)`
      : '',
    plot: val(d.overview),
    backdrop: tmdbImage(d.backdrop_path, 'w780'),
    trailerKey: pickTrailer(d.videos)
  };
}

async function tmdbDetails(tmdbId) {
  const d = await tmdbRequest(`/movie/${encodeURIComponent(tmdbId)}`, {
    append_to_response: 'credits,videos,release_dates,external_ids'
  });
  return tmdbMovie(d);
}

async function tmdbIdFromImdb(imdbID) {
  const data = await tmdbRequest(`/find/${encodeURIComponent(imdbID)}`, { external_source: 'imdb_id' });
  const hit = data.movie_results && data.movie_results[0];
  if (!hit) throw new Error('Not found on TMDB');
  return String(hit.id);
}

async function tmdbSearch(query) {
  const data = await tmdbRequest('/search/movie', { query, include_adult: 'false', page: '1' });
  const results = (data.results || []).map(tmdbListItem).filter((m) => m.title);
  if (!results.length) {
    const err = new Error('No movies found.');
    err.empty = true;
    throw err;
  }
  return results;
}

async function tmdbNowPlaying() {
  const data = await tmdbRequest('/movie/now_playing', { region: 'US', page: '1' });
  return (data.results || []).map(tmdbListItem).filter((m) => m.title);
}

/* ---------- Unified data access ---------- */

function cacheMovie(movie, ...ids) {
  [movie.id, movie.imdbID, ...ids].filter(Boolean).forEach((k) => state.cache.set(k, movie));
}

async function getMovie(id) {
  if (state.cache.has(id)) return state.cache.get(id);

  let movie;
  if (isTmdbId(id)) {
    if (!useTmdb()) throw new Error('This link needs a TMDB API key (see Settings).');
    movie = await tmdbDetails(id);
  } else if (useTmdb()) {
    try {
      movie = await tmdbDetails(await tmdbIdFromImdb(id));
    } catch (err) {
      console.warn('TMDB lookup failed, falling back to OMDb:', err);
      movie = await omdbDetails(id);
    }
  } else {
    movie = await omdbDetails(id);
  }

  cacheMovie(movie, id);
  return movie;
}

async function searchMovies(query) {
  if (useTmdb()) {
    try {
      return await tmdbSearch(query);
    } catch (err) {
      if (err.empty) throw err;
      console.warn('TMDB search failed, falling back to OMDb:', err);
    }
  }
  return omdbSearch(query);
}

function dataSourceLabel() {
  return useTmdb() ? 'TMDB API v3 (OMDb fallback)' : 'OMDb API v1';
}

function resetDataCache() {
  state.cache.clear();
  state.loaded = { new: false, classics: false };
  state.lastQuery = '';
  updateSourceUI();
}

function updateSourceUI() {
  const src = $('data-source');
  if (src) src.textContent = dataSourceLabel();
  const attr = $('tmdb-attribution');
  if (attr) attr.hidden = !useTmdb();
  const note = $('new-note');
  if (note) {
    note.textContent = useTmdb()
      ? 'Now playing in US theaters (via TMDB). Still under copyright: pick one for details, the trailer, and where to watch it legally.'
      : 'Recent theatrical releases. Still under copyright: pick one to see details, the trailer, and where to watch it legally.';
  }
}

/* ---------- Init ---------- */

document.addEventListener('DOMContentLoaded', () => {
  initMenuToggle();
  initNav();
  initSearch();
  initSettings();
  initPlayerButtons();
  applyCrt();
  updateSourceUI();

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
  let param = '';
  try {
    param = rest.length ? decodeURIComponent(rest.join('/')) : '';
  } catch (_) {
    param = rest.join('/'); // malformed % sequence in a hand-typed URL
  }

  if (route !== 'movie') stopPlayback();

  switch (route) {
    case 'new':
      showTab('new');
      if (!state.loaded.new) loadNewReleases();
      break;
    case 'classics':
      showTab('classics');
      if (!state.loaded.classics) loadList(FREE_CLASSIC_IDS, $('classic-movies'), 'classics');
      break;
    case 'settings':
      showTab('settings');
      break;
    case 'movie':
      if (isImdbId(param) || isTmdbId(param)) {
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

  // API firewalls reject markup-like input; titles never need these characters.
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
  const sourceName = useTmdb() ? 'TMDB' : 'OMDb';
  updateStatus(`FETCHING >> QUERY: "${query}"`);
  container.innerHTML = `<div class="notice loading">-- SEARCHING ${sourceName} DATABASE --</div>`;

  try {
    const movies = dedupe(await searchMovies(query));
    if (token !== state.searchToken) return; // a newer search started

    container.innerHTML = `<div class="path-header">RESULTS FOR "${esc(query)}" [${movies.length}]</div>`;
    renderMovieGrid(container, movies);
    updateStatus(`${sourceName}_SUCCESS >> ${movies.length} RESULTS`);
  } catch (err) {
    if (token !== state.searchToken) return;
    const msg = err.message || '';
    let friendly;
    if (err.empty) {
      friendly = /too many/i.test(msg)
        ? 'TOO MANY RESULTS: type a longer, more specific title.'
        : `NO MATCHES FOR "${query}". Check the spelling and try again.`;
    } else if (/api key|invalid|401/i.test(msg) || err.status === 401) {
      friendly = `API KEY PROBLEM: ${msg} Check your keys in Settings.`;
    } else if (err.status === 403) {
      friendly = 'REQUEST REJECTED. Try a plain movie title, or check your API keys in Settings.';
    } else {
      friendly = 'CONNECTION_ERROR: Could not reach the movie database. Check your internet connection and try again.';
    }
    if (!err.empty) console.warn('Search failed:', err);
    notice(container, friendly);
    updateStatus(`SEARCH_ERR >> ${msg.toUpperCase() || 'NETWORK/API ERROR'}`);
  }
}

function dedupe(list) {
  const seen = new Set();
  return list.filter((m) => m && m.id && !seen.has(m.id) && seen.add(m.id));
}

/* ---------- Movie grids ---------- */

function renderMovieGrid(container, movies) {
  const grid = document.createElement('div');
  grid.className = 'movie-grid';

  movies.forEach((movie) => {
    const card = document.createElement('a');
    card.className = 'movie-card';
    card.href = `#/movie/${encodeURIComponent(movie.id)}`;
    card.setAttribute('aria-label', `${movie.title}${movie.year ? ` (${movie.year})` : ''}`);

    const posterHTML = movie.poster
      ? `<img src="${esc(movie.poster)}" class="poster-img" alt="" loading="lazy" decoding="async" />`
      : '<span class="no-poster">[NO POSTER]</span>';

    card.innerHTML = `
      <div class="poster-box">${posterHTML}</div>
      <div class="movie-card-title">${esc(movie.title)}</div>
      <div class="movie-card-meta">
        <span>${esc(movie.year || '----')}</span>
        <span>${esc(movie.type || 'MOVIE')}</span>
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

function showListError(container, retry) {
  container.innerHTML = `
    <div class="notice">FAILED TO LOAD MOVIES. Check your connection or API keys in Settings.</div>
    <button type="button" class="terminal-btn block-btn" data-retry>[ RETRY ]</button>`;
  container.querySelector('[data-retry]').addEventListener('click', retry);
  updateStatus('API_ERR >> LIST LOAD FAILED');
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
    updateStatus(`DATA_OK >> ${movies.length} TITLES LOADED`);
  } else {
    showListError(container, () => loadList(ids, container, key));
  }
}

async function loadNewReleases() {
  const container = $('new-movies');
  if (!container) return;

  if (!useTmdb()) {
    loadList(NEW_RELEASE_IDS, container, 'new');
    return;
  }

  notice(container, '-- LOADING NOW PLAYING FROM TMDB --');
  container.firstChild.classList.add('loading');
  try {
    const movies = await tmdbNowPlaying();
    if (!movies.length) throw new Error('Empty list');
    container.innerHTML = '';
    renderMovieGrid(container, movies);
    state.loaded.new = true;
    updateStatus(`TMDB_SUCCESS >> ${movies.length} NOW PLAYING`);
  } catch (err) {
    console.warn('TMDB now playing failed, using curated list:', err);
    loadList(NEW_RELEASE_IDS, container, 'new');
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

async function openMovie(id) {
  showTab('player');
  const token = ++state.movieToken;

  $('player-path-header').textContent = 'Home/Movies/...';
  $('player-details').innerHTML = '<div class="loading">-- FETCHING MOVIE DETAILS --</div>';
  resetPlayerScreen(null);
  updateStatus(`FETCHING_DETAILS >> ${id}`);

  try {
    const movie = await getMovie(id);
    if (token !== state.movieToken) return;
    state.selectedMovie = movie;
    renderPlayerView(movie);
  } catch (err) {
    if (token !== state.movieToken) return;
    console.warn('Details failed:', err);
    $('player-path-header').textContent = 'Home/Movies/ERROR';
    $('player-details').innerHTML = `<div class="notice">COULD NOT LOAD MOVIE DETAILS: ${esc(err.message)}</div>`;
    updateStatus('API_ERR >> DETAILS UNAVAILABLE');
  }
}

function resetPlayerScreen(movie) {
  const screen = $('player-screen');
  if (!screen) return;
  state.streamToken++;

  const art = movie ? (movie.backdrop || movie.poster) : '';
  const titleTag = movie ? `${movie.title} ${movie.year}`.trim() : 'LOADING...';

  screen.innerHTML = `
    <div class="fake-player-art">
      <span class="player-title-tag">${esc(titleTag)}</span>
      <button type="button" class="play-overlay-btn" ${movie ? '' : 'disabled'}>&#9654; STREAM NOW</button>
    </div>`;

  if (art) {
    screen.querySelector('.fake-player-art').style.backgroundImage =
      `linear-gradient(rgba(0,0,0,0.6), rgba(0,0,0,0.85)), url("${art.replace(/"/g, '%22')}")`;
  }
  if (movie) screen.querySelector('.play-overlay-btn').addEventListener('click', () => startStream(movie));

  $('player-source').textContent = '[SRC: --]';
}

function renderPlayerView(movie) {
  $('player-path-header').textContent = `Home/Movies/${movie.title}`;
  document.title = `${movie.title}${movie.year ? ` (${movie.year})` : ''} - BARELY LEGAL MOVIES`;
  resetPlayerScreen(movie);

  $('player-runtime').textContent = `▶ ${movie.runtime || '?? min'}`;
  $('player-rated').textContent = `[${movie.rated || 'NR'}]`;

  const rows = [
    ['TITLE', movie.title],
    ['RELEASED', [movie.released, movie.runtime && `(${movie.runtime})`].filter(Boolean).join(' ')],
    ['GENRE', movie.genre],
    ['DIRECTOR', movie.director],
    ['CAST', movie.cast],
    ['RATING', movie.rating],
    ['PLOT', movie.plot]
  ].filter(([, v]) => v);

  $('player-details').innerHTML = rows
    .map(([label, v]) => `<div class="detail-row"><span class="detail-label">${label}:</span><span class="detail-value">${esc(v)}</span></div>`)
    .join('');

  updateStatus(`PLAYER_LOADED >> ${movie.title}`);
}

function stopPlayback() {
  const screen = $('player-screen');
  if (screen && screen.querySelector('iframe, video')) screen.innerHTML = '';
  state.streamToken++;
  if (!/^#\/?movie/.test(window.location.hash)) document.title = 'BARELY LEGAL MOVIES - Terminal Movie Player';
}

function embedPlayer(src, title) {
  $('player-screen').innerHTML = `
    <iframe class="player-video"
      src="${esc(src)}"
      title="${esc(title)}"
      allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
      referrerpolicy="strict-origin-when-cross-origin"></iframe>`;
}

function playTrailer(movie) {
  if (!movie.trailerKey) return;
  embedPlayer(`${YOUTUBE_EMBED_URL}${encodeURIComponent(movie.trailerKey)}?autoplay=1&rel=0`, `${movie.title} - trailer`);
  $('player-source').textContent = '[SRC: TRAILER]';
  updateStatus(`TRAILER_ACTIVE >> ${movie.title}`);
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
  const year = parseInt(movie.year, 10);
  const words = normTitle(movie.title).split(' ').filter(Boolean);
  if (!words.length) return null;

  const q = `collection:feature_films AND mediatype:movies AND title:(${words.join(' AND ')})`;
  const params = new URLSearchParams({ q, rows: '25', output: 'json' });
  ['identifier', 'title', 'year', 'date', 'downloads'].forEach((f) => params.append('fl[]', f));
  params.append('sort[]', 'downloads desc');

  const data = await fetchJSON(`${ARCHIVE_SEARCH_URL}?${params.toString()}`);
  const docs = (data && data.response && data.response.docs) || [];
  const want = normTitle(movie.title);

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
  updateStatus(`STREAM_LOOKUP >> ${movie.title}`);

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
    embedPlayer(`${ARCHIVE_EMBED_URL}${encodeURIComponent(identifier)}`, `${movie.title} - Internet Archive player`);
    $('player-source').textContent = '[SRC: INTERNET ARCHIVE]';
    updateStatus(`STREAM_ACTIVE >> PLAYING: ${movie.title}`);
    return;
  }

  const trailerSearch = `https://www.youtube.com/results?search_query=${encodeURIComponent(`${movie.title} ${movie.year} official trailer`)}`;
  const where = `https://www.justwatch.com/us/search?q=${encodeURIComponent(movie.title)}`;
  const trailerBtn = movie.trailerKey
    ? '<button type="button" class="terminal-btn outline-btn" data-trailer>&#9654; PLAY TRAILER</button>'
    : `<a class="terminal-btn outline-btn" href="${esc(trailerSearch)}" target="_blank" rel="noopener noreferrer">&#9654; TRAILER</a>`;

  screen.innerHTML = `
    <div class="player-message">
      <div class="msg-title">${failed ? 'ARCHIVE_UNREACHABLE' : 'NO FREE LEGAL STREAM FOUND'}</div>
      <p>${failed
        ? 'Could not reach the Internet Archive. Try again in a moment.'
        : 'This title is still under copyright, so it has no free public-domain copy. Try the [FREE CLASSICS] tab for full movies.'}</p>
      <div class="msg-actions">
        ${trailerBtn}
        <a class="terminal-btn outline-btn" href="${esc(where)}" target="_blank" rel="noopener noreferrer">WHERE TO WATCH</a>
        <button type="button" class="terminal-btn outline-btn" data-retry>&#8635; RETRY</button>
      </div>
    </div>`;
  screen.querySelector('[data-retry]').addEventListener('click', () => startStream(movie));
  const tBtn = screen.querySelector('[data-trailer]');
  if (tBtn) tBtn.addEventListener('click', () => playTrailer(movie));
  $('player-source').textContent = '[SRC: NONE]';
  updateStatus(failed ? 'STREAM_ERR >> ARCHIVE UNREACHABLE' : `STREAM_NONE >> ${movie.title} NOT IN PUBLIC DOMAIN`);
}

/* ---------- Settings ---------- */

function applyCrt() {
  const overlay = $('crt-overlay');
  if (overlay) overlay.hidden = !state.crtEffect;
  const toggle = $('crt-toggle');
  if (toggle) toggle.checked = state.crtEffect;
}

/**
 * Wires a "key" settings block: input + SAVE + RESET + status line.
 * A saved key is verified against the API, stored in localStorage and
 * overrides the value from config.js. RESET returns to the config.js value.
 */
function bindKeySetting(opts) {
  const input = $(opts.inputId);
  const saveBtn = $(opts.saveId);
  const resetBtn = $(opts.resetId);
  const msg = $(opts.msgId);
  if (!input || !saveBtn || !resetBtn) return;

  const setMsg = (text) => { if (msg) msg.textContent = text; };
  const defaultKey = opts.defaultKey;
  const current = opts.get();
  input.value = current && current !== defaultKey ? current : '';
  if (opts.describe) setMsg(opts.describe());

  const save = async () => {
    const key = input.value.trim();
    if (!key) {
      setMsg('> PASTE A KEY FIRST, OR PRESS RESET.');
      return;
    }
    if (!opts.validFormat(key)) {
      setMsg(`> INVALID FORMAT. ${opts.formatHint}`);
      return;
    }
    setMsg('> TESTING KEY...');
    saveBtn.disabled = true;
    try {
      await opts.test(key);
      opts.set(key);
      STORAGE.set(opts.storageKey, key);
      resetDataCache();
      setMsg('> KEY VERIFIED AND SAVED.');
      updateStatus(`SYS_CONFIG >> ${opts.name} KEY UPDATED`);
    } catch (err) {
      setMsg(`> KEY REJECTED: ${err.message}`);
    } finally {
      saveBtn.disabled = false;
    }
  };

  saveBtn.addEventListener('click', save);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); save(); } });

  resetBtn.addEventListener('click', () => {
    opts.set(defaultKey);
    STORAGE.remove(opts.storageKey);
    input.value = '';
    resetDataCache();
    setMsg(opts.describe ? opts.describe() : '> RESET.');
    updateStatus(`SYS_CONFIG >> ${opts.name} KEY RESET`);
  });
}

function initSettings() {
  const crtToggle = $('crt-toggle');
  if (crtToggle) {
    crtToggle.addEventListener('change', (e) => {
      state.crtEffect = e.target.checked;
      STORAGE.set('blm_crt', state.crtEffect ? 'on' : 'off');
      applyCrt();
      updateStatus(`SYS_CONFIG >> CRT FILTER: ${state.crtEffect ? 'ENABLED' : 'DISABLED'}`);
    });
  }

  bindKeySetting({
    name: 'TMDB',
    inputId: 'tmdb-key-input',
    saveId: 'tmdb-save-btn',
    resetId: 'tmdb-reset-btn',
    msgId: 'tmdb-msg',
    storageKey: 'blm_tmdb_key',
    defaultKey: CONFIG.TMDB_API_KEY,
    get: () => state.tmdbKey,
    set: (k) => { state.tmdbKey = k; },
    describe: () => {
      if (!state.tmdbKey) return '> NOT SET. USING OMDb. Add a key here or in config.js.';
      return state.tmdbKey === CONFIG.TMDB_API_KEY ? '> USING KEY FROM config.js.' : '> USING KEY SAVED IN THIS BROWSER.';
    },
    validFormat: (k) => /^[a-f0-9]{32}$/i.test(k) || /^eyJ[\w-]+\.[\w-]+\.[\w-]+$/.test(k),
    formatHint: 'USE THE 32-CHARACTER API KEY OR THE "eyJ..." READ ACCESS TOKEN.',
    test: (k) => tmdbRequest('/configuration', {}, k)
  });

  bindKeySetting({
    name: 'OMDb',
    inputId: 'api-key-input',
    saveId: 'save-key-btn',
    resetId: 'reset-key-btn',
    msgId: 'settings-msg',
    storageKey: 'blm_api_key',
    defaultKey: CONFIG.OMDB_API_KEY,
    get: () => state.omdbKey,
    set: (k) => { state.omdbKey = k; },
    validFormat: (k) => /^[a-zA-Z0-9]{6,16}$/.test(k),
    formatHint: 'OMDb KEYS ARE 8 LETTERS/NUMBERS.',
    test: async (k) => {
      const data = await omdbRequest({ i: 'tt0063350' }, k);
      if (data.Response !== 'True') throw new Error(data.Error || 'Rejected');
    }
  });
}
