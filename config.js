/* =========================================================
   BARELY LEGAL MOVIES - API configuration
   ---------------------------------------------------------
   TMDB_API_KEY
     Paste your TMDB key between the quotes. Either works:
       - v3 "API Key"               (32 letters/numbers)
       - v4 "API Read Access Token" (long string starting with "eyJ")
     Get one at https://www.themoviedb.org/settings/api
     When set, TMDB powers search, movie details, posters,
     "now playing" new releases and in-player trailers.
     Leave it empty to fall back to OMDb.

   OMDB_API_KEY
     Fallback movie data source (https://www.omdbapi.com).

   NOTE: this is a static site, so any key here is visible to
   anyone who opens the page source. Use a read-only key and
   never put a secret/paid key here.

   Visitors can also enter their own keys in [SETTINGS]; those
   are saved in their browser and override the values below.
   ========================================================= */

window.BLM_CONFIG = {
  TMDB_API_KEY: '466bb30cac99d10c652b158f4af723a6',
  OMDB_API_KEY: '47096182'
};
