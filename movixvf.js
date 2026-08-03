// movixvf.js — Provider Nuvio pour Movix (movix.fun), orienté VF/VOSTFR
//
// Sources interrogées : /api/fstream/... et /api/cpasmal/... sur api.movix.fun
// (confirmées fonctionnelles par capture réseau réelle, aucune clé VIP requise).
//
// Résolution des liens "embed" (Vidzy, etc.) faite ici même, côté client,
// sans passer par les endpoints verrouillés VIP de Movix — même principe que
// ce que fait un navigateur qui charge la page de l'hébergeur, juste automatisé.
//
// Ecrit en chaînage .then()/.catch() (pas d'async/await) pour compatibilité Hermes,
// comme les providers déjà fonctionnels testés sur l'app.

var MAINAPI_BASE = 'https://api.movix.fun';
var SITE_ORIGIN = 'https://movix.fun';

var COMMON_HEADERS = {
  'Accept': 'application/json, text/plain, */*',
  'Origin': SITE_ORIGIN,
  'Referer': SITE_ORIGIN + '/',
};

// ---------- Appels API Movix (confirmés) ----------

function fetchFStream(tmdbId, mediaType, season) {
  var url = mediaType === 'tv'
    ? MAINAPI_BASE + '/api/fstream/tv/' + tmdbId + '/season/' + season
    : MAINAPI_BASE + '/api/fstream/movie/' + tmdbId;

  return fetch(url, { headers: COMMON_HEADERS })
    .then(function (res) { return res.json(); })
    .catch(function () { return null; });
}

function fetchCpasmal(tmdbId, mediaType, season, episode) {
  var url = mediaType === 'tv'
    ? MAINAPI_BASE + '/api/cpasmal/tv/' + tmdbId + '/' + (season || 1) + '/' + (episode || 1)
    : MAINAPI_BASE + '/api/cpasmal/movie/' + tmdbId;

  return fetch(url, { headers: COMMON_HEADERS })
    .then(function (res) { return res.json(); })
    .catch(function () { return null; });
}

// ---------- Aplatissement des réponses ----------

function flattenFStream(data, episode) {
  var out = [];
  if (!data || !data.success) return out;

  if (data.episodes) {
    // série : episodes[num].languages[lang] = [{url,quality,player}]
    var ep = data.episodes[episode];
    if (ep && ep.languages) {
      Object.keys(ep.languages).forEach(function (lang) {
        (ep.languages[lang] || []).forEach(function (p) {
          out.push({ url: p.url, quality: p.quality, playerName: p.player, lang: lang });
        });
      });
    }
  } else if (data.players) {
    // film : players[lang] = [{url,quality,player}]
    Object.keys(data.players).forEach(function (lang) {
      (data.players[lang] || []).forEach(function (p) {
        out.push({ url: p.url, quality: p.quality, playerName: p.player, lang: lang });
      });
    });
  }
  return out;
}

function flattenCpasmal(data) {
  var out = [];
  if (!data || !data.links) return out;
  ['vf', 'vostfr'].forEach(function (lang) {
    (data.links[lang] || []).forEach(function (item) {
      out.push({ url: item.url, quality: null, playerName: item.server, lang: lang.toUpperCase() });
    });
  });
  return out;
}

// ---------- Décodeur JS-Packer générique (eval(function(p,a,c,k,e,d)...)) ----------
// Technique publique très répandue, utilisée par de nombreux hébergeurs vidéo.

var PACKER_CHARS = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';

function toBase(num, base) {
  if (num === 0) return PACKER_CHARS[0];
  var result = '';
  var n = num;
  while (n > 0) {
    result = PACKER_CHARS[n % base] + result;
    n = Math.floor(n / base);
  }
  return result;
}

function unpackJs(script) {
  var match = script.match(
    /eval\(function\(p,a,c,k,e,d\)\{[\s\S]*?\}\('([\s\S]+?)',(\d+),(\d+),'([\s\S]+?)'\./
  );
  if (!match) return null;

  var p = match[1];
  var a = parseInt(match[2], 10);
  var c = parseInt(match[3], 10);
  var k = match[4].split('|');

  var result = p;
  while (c > 0) {
    c -= 1;
    if (c < k.length && k[c]) {
      var token = toBase(c, a).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      var re = new RegExp('\\b' + token + '\\b', 'g');
      result = result.replace(re, k[c]);
    }
  }
  return result;
}

// ---------- Détection de l'hébergeur + résolution générique ----------

var M3U8_PATTERNS = [
  /file\s*:\s*["']([^"']+\.m3u8[^"']*)["']/i,
  /sources\s*:\s*\[\s*\{[^}]*file\s*:\s*["']([^"']+\.m3u8[^"']*)["']/i,
  /source\s+src=["']([^"']+\.m3u8[^"']*)["']/i,
  /["']([^"']*\.m3u8(?:\?[^"']*)?)["']/i,
];

function extractM3u8(text) {
  for (var i = 0; i < M3U8_PATTERNS.length; i++) {
    var m = text.match(M3U8_PATTERNS[i]);
    if (m) return m[1].indexOf('//') === 0 ? 'https:' + m[1] : m[1];
  }
  return null;
}

function detectHoster(playerName, embedUrl) {
  var name = (playerName || '').toLowerCase();
  var url = (embedUrl || '').toLowerCase();

  if (name.indexOf('vidzy') !== -1 || url.indexOf('vidzy') !== -1) {
    return { key: 'vidzy', referer: 'https://vidzy.org/' };
  }
  if (name.indexOf('vidmoly') !== -1 || url.indexOf('vidmoly') !== -1) {
    return { key: 'vidmoly', referer: 'https://vidmoly.to/' };
  }
  if (name.indexOf('sibnet') !== -1 || url.indexOf('sibnet') !== -1) {
    return { key: 'sibnet', referer: 'https://video.sibnet.ru/' };
  }
  if (url.indexOf('fsvid') !== -1) {
    return { key: 'fsvid', referer: 'https://fsvid.lol/' };
  }
  // Uqload, DoodStream, Voe : nécessitent un algorithme dédié plus complexe
  // (non couvert par l'extraction générique ci-dessous, voir README).
  if (name.indexOf('uqload') !== -1 || url.indexOf('uqload') !== -1) {
    return { key: 'uqload', referer: 'https://uqload.io/', unsupported: true };
  }
  if (name.indexOf('dood') !== -1 || url.indexOf('dood') !== -1) {
    return { key: 'doodstream', referer: 'https://dood.to/', unsupported: true };
  }
  if (name.indexOf('voe') !== -1 || url.indexOf('voe.sx') !== -1) {
    return { key: 'voe', referer: 'https://voe.sx/', unsupported: true };
  }
  return null;
}

// Extraction générique : marche pour les hébergeurs qui posent leur script
// "packer" ou leur .m3u8 en clair dans le HTML de la page embed (Vidzy et
// plusieurs autres). Ne couvre pas Uqload/DoodStream/Voe (voir README).
function genericExtract(embedUrl, referer) {
  return fetch(embedUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0',
      'Referer': referer,
      'Accept': 'text/html,*/*',
    },
  })
    .then(function (res) { return res.text(); })
    .then(function (html) {
      var unpacked = unpackJs(html);
      var fromUnpacked = unpacked ? extractM3u8(unpacked) : null;
      return fromUnpacked || extractM3u8(html);
    })
    .catch(function () { return null; });
}

function resolveEmbed(item) {
  var hoster = detectHoster(item.playerName, item.url);
  if (!hoster || hoster.unsupported) {
    return Promise.resolve(null);
  }
  return genericExtract(item.url, hoster.referer).then(function (finalUrl) {
    if (!finalUrl) return null;
    return {
      name: 'Movix',
      title: [item.lang, item.quality || 'HD', item.playerName].filter(Boolean).join(' - '),
      url: finalUrl,
      quality: item.quality || 'HD',
      headers: { 'Referer': hoster.referer },
    };
  });
}

// ---------- Point d'entrée Nuvio ----------

function getStreams(tmdbId, mediaType, season, episode) {
  return Promise.all([
    fetchFStream(tmdbId, mediaType, season),
    fetchCpasmal(tmdbId, mediaType, season, episode),
  ])
    .then(function (results) {
      var fstreamData = results[0];
      var cpasmalData = results[1];
      var rawPlayers = flattenFStream(fstreamData, episode).concat(flattenCpasmal(cpasmalData));

      if (rawPlayers.length === 0) return [];

      return Promise.all(rawPlayers.map(resolveEmbed)).then(function (resolved) {
        return resolved.filter(function (s) { return s !== null; });
      });
    })
    .catch(function () { return []; });
}

typeof module !== 'undefined' && module.exports
  ? (module.exports = { getStreams: getStreams })
  : (global.getStreams = getStreams);
