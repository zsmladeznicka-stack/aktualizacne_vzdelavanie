/**
 * Backend aktualizačného vzdelávania – Google Apps Script naviazaný na Google tabuľku.
 * Tabuľka slúži zároveň ako administrácia: videá, otázky, priebeh učiteľov, osvedčenia a nastavenia.
 * Pravidlá vzdelávania (povinné video, počet voliteľných videí, hranica úspešnosti…) sú v hárku Nastavenia,
 * aby sa aplikácia dala v ďalších rokoch použiť len s novou tabuľkou. Postup nasadenia je v README.md.
 */
const CONFIG = {
  CLIENT_ID: '360446448624-q4u3huhlgho4ce4taptuofp0e4dveujp.apps.googleusercontent.com',
  DOMAIN: 'koharysuli.sk',
  SCHOOL_NAME: 'Základná škola Štefana Koháriho II. s VJM - II. Koháry István Alapiskola',
  // Účty, ktoré môžu aplikáciu používať aj pri vypnutom vzdelávaní a zapnúť testovací režim (god mode)
  ADMINS: ['fazekas.csaba@koharysuli.sk'],
  WATCH_PERCENT: 95, // koľko percent videa treba pozrieť, aby sa odomkol test
};

// Predvolené hodnoty, ak v hárku Nastavenia chýbajú
const DEFAULTS = { OPTIONAL: 5, PASS_PERCENT: 75, HOURS_TEXT: '10 vyučovacích hodín (1 vyučovacia hodina = 45 minút)', CERT_PREFIX: 'AKT' };

const SHEET = { VIDEOS: 'Videa', QUESTIONS: 'Otazky', PROGRESS: 'Priebeh', CERTS: 'Osvedcenia', USERS: 'Ucastnici', SETTINGS: 'Nastavenia' };

// Stĺpce hárku Priebeh (jeden riadok = jeden učiteľ × jedno video).
// Riadky sa nikdy nemažú – heartbeat zapisuje bez zámku a spolieha sa na to, že sa čísla riadkov nemenia.
const P = {
  EMAIL: 0, NAME: 1, VIDEO: 2, WATCHED: 3, DURATION: 4, DONE: 5, BEAT: 6, QUIZ_START: 7, TRIES: 8, BEST: 9,
  PASSED: 10, PASSED_AT: 11, STARTED: 12, ABANDONED: 13,
};
const PROGRESS_HEADER = ['E-mail', 'Meno', 'Video', 'Pozreté (s)', 'Dĺžka (s)', 'Video dopozerané', 'Posledný záznam',
  'Test spustený', 'Pokusy', 'Najlepšie skóre (%)', 'Test splnený', 'Splnené dňa', 'Spustené', 'Zanechané (krát)'];

const SESSION_SECONDS = 6 * 3600; // maximum CacheService

/** Spustite raz ručne z editora – vytvorí chýbajúce hárky. Existujúce hárky (napr. Videa, Otazky) nemení. */
function setup() {
  const ss = SpreadsheetApp.getActive();
  const make = (name, header, rows) => {
    if (ss.getSheetByName(name)) return;
    const sh = ss.insertSheet(name);
    sh.appendRow(header);
    sh.getRange(1, 1, 1, header.length).setFontWeight('bold');
    sh.setFrozenRows(1);
    if (name === SHEET.VIDEOS) sh.getRange('C:C').setNumberFormat('@'); // YouTube ID ako text
    if (rows && rows.length) sh.getRange(2, 1, rows.length, rows[0].length).setValues(rows);
  };
  make(SHEET.VIDEOS, ['Poradie', 'Názov', 'YouTube ID', 'Dĺžka (sekundy)', 'Anotácia', 'Nálepky']);
  make(SHEET.QUESTIONS, ['Video', 'Otázka', 'A', 'B', 'C', 'D', 'Správna (A–D)']);
  make(SHEET.PROGRESS, PROGRESS_HEADER);
  make(SHEET.CERTS, ['Číslo', 'E-mail', 'Meno', 'Dátum vydania', 'Ukončené (posledný test)']);
  make(SHEET.USERS, ['E-mail', 'Meno', 'Prvé prihlásenie']);
  make(SHEET.SETTINGS, ['Nastavenie', 'Hodnota'], [
    ['Vzdelávanie aktívne', 0],
    ['Názov programu', ''],
    ['Povinné video (číslo z hárku Videa)', ''],
    ['Počet voliteľných videí', DEFAULTS.OPTIONAL],
    ['Hranica úspešnosti (%)', DEFAULTS.PASS_PERCENT],
    ['Rozsah vzdelávania (text na osvedčení)', DEFAULTS.HOURS_TEXT],
    ['Predpona čísla osvedčenia', DEFAULTS.CERT_PREFIX],
    ['Otvorené do (text pre učiteľov)', ''],
  ]);
}

function doGet() {
  return ContentService.createTextOutput('Kurz API beží.');
}

function doPost(e) {
  let out;
  try {
    out = handle_(JSON.parse(e.postData.contents));
  } catch (err) {
    out = { error: String(err && err.message || err) };
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

function handle_(req) {
  if (req.action === 'login') return login_(req.idToken);
  const user = getSession_(req.session);
  if (!user) return { error: 'SESSION_EXPIRED' };
  if (req.action === 'state') return state_(user);
  if (req.action === 'certificate') return withLock_(() => certificate_(user)); // osvedčenie sa dá stiahnuť aj po vypnutí
  if (String(req.action).indexOf('god') === 0) {
    if (!isAdmin_(user)) return { error: 'Nemáte oprávnenie.' };
    return withLock_(() => god_(user, req));
  }
  if (!courseOpen_(user)) return { error: 'INACTIVE' };
  const order = Number(req.video);
  switch (req.action) {
    case 'heartbeat': return heartbeat_(user, order, Number(req.position)); // bez zámku, pozri heartbeat_
    case 'start': return withLock_(() => startVideo_(user, order));
    case 'abandon': return withLock_(() => abandon_(user, order));
    case 'quiz': return withLock_(() => startQuiz_(user, order));
    case 'submit': return withLock_(() => submitQuiz_(user, order, req.answers));
  }
  return { error: 'Neznáma akcia.' };
}

// ---------- Prihlásenie ----------

function login_(idToken) {
  const res = UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(idToken || ''),
    { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) return { error: 'Prihlásenie sa nepodarilo overiť.' };
  const t = JSON.parse(res.getContentText());
  if (t.aud !== CONFIG.CLIENT_ID) return { error: 'Prihlásenie nepatrí tejto aplikácii.' };
  if (t.hd !== CONFIG.DOMAIN || String(t.email_verified) !== 'true') {
    return { error: 'Prihláste sa školským účtom @' + CONFIG.DOMAIN + '.' };
  }
  const user = { email: String(t.email).toLowerCase(), name: t.name || t.email };
  const session = Utilities.getUuid();
  CacheService.getScriptCache().put('s_' + session, JSON.stringify(user), SESSION_SECONDS);
  if (courseOpen_(user)) withLock_(() => registerUser_(user));
  return Object.assign({ session: session }, state_(user));
}

/** Pri prvom prihlásení do aktívneho vzdelávania zapíše učiteľa do hárku Ucastnici (len evidencia). */
function registerUser_(user) {
  if (rows_(SHEET.USERS).some(r => String(r[0]).toLowerCase() === user.email)) return;
  sheet_(SHEET.USERS).appendRow([user.email, user.name, new Date()]);
}

function getSession_(session) {
  if (!session) return null;
  const cache = CacheService.getScriptCache();
  const raw = cache.get('s_' + session);
  if (!raw) return null;
  cache.put('s_' + session, raw, SESSION_SECONDS); // predĺženie pri aktivite
  return JSON.parse(raw);
}

// ---------- Údaje ----------

function sheet_(name) {
  const sh = SpreadsheetApp.getActive().getSheetByName(name);
  if (!sh) throw new Error('Chýba hárok „' + name + '“. Spustite funkciu setup.');
  return sh;
}

function rows_(name) {
  const v = sheet_(name).getDataRange().getValues();
  v.shift();
  return v;
}

// Videá a otázky sa menia zriedka – krátko ich držíme v pamäti (cache), aby server odpovedal rýchlejšie.
// Zmeny v týchto hárkoch sa preto v aplikácii prejavia najneskôr do minúty.
const SHEET_CACHE_SECONDS = 60;

function cachedRows_(name) {
  const cache = CacheService.getScriptCache();
  const hit = cache.get('rows_' + name);
  if (hit) return JSON.parse(hit);
  const rows = rows_(name);
  try {
    cache.put('rows_' + name, JSON.stringify(rows), SHEET_CACHE_SECONDS);
  } catch (e) { /* príliš veľké pre cache – nevadí */ }
  return rows;
}

/** Nálepky z bunky „AI, Ochrana údajov“ → ['AI', 'Ochrana údajov'] (bez prázdnych a duplicít). */
function tags_(cell) {
  const out = [];
  String(cell || '').split(',').map(s => s.trim()).forEach(t => { if (t && out.indexOf(t) === -1) out.push(t); });
  return out;
}

/**
 * Videá z hárku Videa. Riadok bez YouTube ID alebo bez dĺžky sa preskočí –
 * video s nulovou dĺžkou by sa inak hneď rátalo ako dopozerané.
 */
function videos_() {
  return cachedRows_(SHEET.VIDEOS)
    .filter(r => r[0] !== '' && String(r[2]).trim() && Number(r[3]) > 0)
    .map(r => ({
      order: Number(r[0]), title: String(r[1]), youtubeId: String(r[2]).trim(), duration: Number(r[3]),
      annotation: String(r[4] || ''), tags: tags_(r[5]),
    }))
    .sort((a, b) => a.order - b.order);
}

function video_(order) {
  const v = videos_().find(x => x.order === order);
  if (!v) throw new Error('Neznáme video.');
  return v;
}

function questions_(order) {
  return cachedRows_(SHEET.QUESTIONS)
    .filter(r => Number(r[0]) === order && String(r[1]).trim())
    .map(r => ({
      text: String(r[1]),
      options: [r[2], r[3], r[4], r[5]].map(String).filter(s => s.trim() !== ''),
      correct: 'ABCD'.indexOf(String(r[6]).trim().toUpperCase()),
    }));
}

/** Počet otázok ku každému videu: { poradie: počet }. */
function questionCounts_() {
  const counts = {};
  cachedRows_(SHEET.QUESTIONS).forEach(r => {
    if (String(r[1]).trim()) counts[Number(r[0])] = (counts[Number(r[0])] || 0) + 1;
  });
  return counts;
}

/** Koľko správnych odpovedí treba na splnenie testu s n otázkami (pri 75 % a 8 otázkach = 6). */
function needed_(n) {
  return Math.ceil(n * passPercent_() / 100 - 1e-9);
}

function progress_(user) {
  const data = sheet_(SHEET.PROGRESS).getDataRange().getValues();
  const map = {};
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][P.EMAIL]).toLowerCase() === user.email) map[Number(data[i][P.VIDEO])] = { row: i + 1, v: data[i] };
  }
  return map;
}

function save_(rec) {
  sheet_(SHEET.PROGRESS).getRange(rec.row, 1, 1, PROGRESS_HEADER.length).setValues([rec.v.slice(0, PROGRESS_HEADER.length)]);
}

function ms_(value) {
  return value instanceof Date ? value.getTime() : 0;
}

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

/** Rozpracované = spustené a test ešte nie je splnený. */
function isStarted_(rec) {
  return !!rec && rec.v[P.STARTED] !== '' && rec.v[P.STARTED] != null;
}

function isPassed_(rec) {
  return !!rec && rec.v[P.PASSED] === true;
}

function inProgress_(map) {
  const key = Object.keys(map).find(k => isStarted_(map[k]) && !isPassed_(map[k]));
  return key === undefined ? null : Number(key);
}

/** Číslo povinného videa z Nastavení; null, ak nie je vyplnené alebo také video v hárku Videa nie je. */
function mandatory_(vids) {
  const n = Number(setting_('Povinné video'));
  return n > 0 && vids.some(v => v.order === n) ? n : null;
}

/** Upozornenie pre administrátora, prečo povinné video nie je nastavené. */
function mandatoryNote_() {
  const raw = String(setting_('Povinné video') || '').trim();
  return raw === '' ? 'V hárku Nastavenia nie je vyplnené povinné video.'
    : 'Povinné video „' + raw + '“ v hárku Videa nie je alebo nemá YouTube ID a dĺžku.';
}

/** Ostatné videá sa odomknú až po splnení testu povinného videa. */
function requireAvailable_(order, vids, map) {
  if (!vids.some(v => v.order === order)) throw new Error('Neznáme video.');
  const m = mandatory_(vids);
  if (m !== null && order !== m && !isPassed_(map[m])) throw new Error('Najprv splňte povinné video a test k nemu.');
}

/** Rozpracovaný záznam videa – inak chyba (napr. video bolo medzitým zanechané). */
function requireStarted_(map, order) {
  const rec = map[order];
  if (!isStarted_(rec)) throw new Error('Video nie je spustené. Spustite ho v katalógu.');
  return rec;
}

/**
 * Stav splnenia: povinné video + požadovaný počet voliteľných. Čas ukončenia je chvíľa,
 * keď boli obe podmienky splnené prvýkrát – ďalšie videá ho už nemenia.
 */
function completion_(vids, map) {
  const m = mandatory_(vids);
  const required = optionalRequired_();
  const optional = vids.filter(v => v.order !== m && isPassed_(map[v.order]))
    .map(v => map[v.order].v[P.PASSED_AT])
    .filter(t => t instanceof Date)
    .sort((a, b) => a - b);
  const mandatoryAt = m === null ? null : (isPassed_(map[m]) ? map[m].v[P.PASSED_AT] : undefined);
  const done = mandatoryAt !== undefined && optional.length >= required;
  let completedAt = null;
  if (done) {
    completedAt = required > 0 ? optional[required - 1] : null;
    if (mandatoryAt instanceof Date && (!completedAt || mandatoryAt > completedAt)) completedAt = mandatoryAt;
  }
  return { done: done, optionalPassed: optional.length, completedAt: completedAt };
}

function state_(user) {
  const vids = videos_();
  const map = progress_(user);
  const counts = questionCounts_();
  const m = mandatory_(vids);
  const videos = vids.map(v => {
    const r = map[v.order];
    const n = counts[v.order] || 0;
    return {
      order: v.order,
      title: v.title,
      youtubeId: v.youtubeId,
      duration: v.duration,
      annotation: v.annotation,
      tags: v.tags,
      mandatory: v.order === m,
      questions: n,
      needed: needed_(n),
      started: isStarted_(r),
      watched: isStarted_(r) ? Number(r.v[P.WATCHED]) || 0 : 0,
      videoDone: isStarted_(r) && r.v[P.DONE] === true,
      quizPassed: isPassed_(r),
      best: isStarted_(r) ? Number(r.v[P.BEST]) || 0 : 0,
      tries: isStarted_(r) ? Number(r.v[P.TRIES]) || 0 : 0,
    };
  });
  const c = completion_(vids, map);
  const admin = isAdmin_(user);
  return {
    user: user,
    school: CONFIG.SCHOOL_NAME,
    course: String(setting_('Názov programu') || '').trim(),
    hoursText: String(setting_('Rozsah vzdelávania') || DEFAULTS.HOURS_TEXT).trim(),
    openUntil: String(setting_('Otvorené do') || '').trim(),
    passPercent: passPercent_(),
    optionalRequired: optionalRequired_(),
    mandatory: m,
    mandatoryNote: admin && m === null ? mandatoryNote_() : '',
    active: isActive_(),
    canStart: courseOpen_(user),
    admin: admin,
    now: Date.now(),
    videos: videos,
    inProgress: inProgress_(map),
    optionalPassed: c.optionalPassed,
    complete: c.done,
    certificate: findCert_(user.email),
  };
}

// ---------- Video ----------

/**
 * Spustenie videa z katalógu. Naraz môže byť rozpracované len jedno video;
 * zanechané video sa pri novom spustení začína od začiatku.
 */
function startVideo_(user, order) {
  const vids = videos_();
  const map = progress_(user);
  requireAvailable_(order, vids, map);
  const video = vids.find(v => v.order === order);
  const rec = map[order];
  if (isPassed_(rec)) throw new Error('Toto video už máte splnené. Môžete si ho pozrieť znova.');
  if (isStarted_(rec)) return state_(user);
  const busy = inProgress_(map);
  if (busy !== null) {
    const b = vids.find(v => v.order === busy);
    throw new Error('Najprv dokončite alebo zanechajte rozpracované video' + (b ? ' „' + b.title + '“' : '') + '.');
  }
  const fresh = [user.email, user.name, order, 0, video.duration, false, '', '', 0, 0, false, '', new Date(), 0];
  if (rec) {
    fresh[P.ABANDONED] = Number(rec.v[P.ABANDONED]) || 0;
    rec.v = fresh;
    save_(rec);
  } else {
    sheet_(SHEET.PROGRESS).appendRow(fresh);
  }
  return state_(user);
}

/** Zanechanie rozpracovaného videa: pozretý čas aj pokusy sa vynulujú, video je znova nezačaté. */
function abandon_(user, order) {
  const vids = videos_();
  const map = progress_(user);
  if (order === mandatory_(vids)) throw new Error('Povinné video sa nedá zanechať.');
  const rec = requireStarted_(map, order);
  if (isPassed_(rec)) throw new Error('Splnené video sa nedá zanechať.');
  rec.v[P.WATCHED] = 0;
  rec.v[P.DONE] = false;
  rec.v[P.BEAT] = '';
  rec.v[P.QUIZ_START] = '';
  rec.v[P.TRIES] = 0;
  rec.v[P.BEST] = 0;
  rec.v[P.STARTED] = '';
  rec.v[P.ABANDONED] = (Number(rec.v[P.ABANDONED]) || 0) + 1;
  save_(rec);
  return state_(user);
}

/**
 * Priebežný záznam pozretia. Server prijme posun len o toľko, koľko reálneho času
 * uplynulo od posledného záznamu – video sa tak nedá „dopozerať“ rýchlejšie.
 * Beží bez globálneho zámku a zapisuje iba stĺpce Pozreté, Dĺžka, Video dopozerané a Posledný záznam,
 * aby sa pri veľkom počte učiteľov požiadavky navzájom nečakali. Riadok vždy vytvára spustenie videa (so zámkom).
 */
function heartbeat_(user, order, position) {
  const video = video_(order);
  const rec = requireStarted_(progress_(user), order);
  const done = rec.v[P.DONE] === true;
  if (isPassed_(rec)) return { watched: Number(rec.v[P.WATCHED]) || 0, videoDone: done };
  const now = Date.now();
  const last = ms_(rec.v[P.BEAT]);
  const watched = Number(rec.v[P.WATCHED]) || 0;
  const elapsed = last ? Math.min((now - last) / 1000, 300) : 10;
  const allowed = watched + elapsed * 1.1 + 5;
  const pos = Math.max(0, Math.min(position || 0, allowed, video.duration));
  const newWatched = Math.max(watched, Math.round(pos));
  const newDone = done || newWatched >= video.duration * CONFIG.WATCH_PERCENT / 100;
  sheet_(SHEET.PROGRESS).getRange(rec.row, P.WATCHED + 1, 1, 4).setValues([[newWatched, video.duration, newDone, new Date(now)]]);
  return { watched: newWatched, videoDone: newDone };
}

// ---------- Test ----------

function startQuiz_(user, order) {
  const map = progress_(user);
  const rec = requireStarted_(map, order);
  if (rec.v[P.DONE] !== true) throw new Error('Najprv dopozerajte video.');
  if (isPassed_(rec)) throw new Error('Tento test už máte splnený.');
  rec.v[P.QUIZ_START] = new Date();
  save_(rec);
  const qs = questions_(order);
  return { needed: needed_(qs.length), questions: qs.map(q => ({ text: q.text, options: q.options })) };
}

function submitQuiz_(user, order, answers) {
  const map = progress_(user);
  const rec = requireStarted_(map, order);
  if (isPassed_(rec)) throw new Error('Tento test už máte splnený.');
  if (!ms_(rec.v[P.QUIZ_START])) throw new Error('Test nebol spustený.');
  answers = Array.isArray(answers) ? answers : [];

  const qs = questions_(order);
  let correct = 0;
  qs.forEach((q, k) => { if (Number(answers[k]) === q.correct) correct++; });
  const needed = needed_(qs.length);
  const passed = correct >= needed;
  const score = qs.length ? Math.round(correct / qs.length * 100) : 100;

  rec.v[P.QUIZ_START] = '';
  rec.v[P.TRIES] = (Number(rec.v[P.TRIES]) || 0) + 1;
  rec.v[P.BEST] = Math.max(score, Number(rec.v[P.BEST]) || 0);
  if (passed) {
    rec.v[P.PASSED] = true;
    rec.v[P.PASSED_AT] = new Date();
  }
  save_(rec);
  const c = completion_(videos_(), progress_(user));
  return { score: score, correct: correct, total: qs.length, needed: needed, passed: passed, complete: c.done };
}

// ---------- Nastavenia ----------

/** Hodnota z hárku Nastavenia podľa začiatku názvu v stĺpci A (bez ohľadu na veľké písmená). */
let settingsMemo_ = null; // Nastavenia sa v rámci jednej požiadavky čítajú len raz

function setting_(name) {
  if (!settingsMemo_) {
    const sh = SpreadsheetApp.getActive().getSheetByName(SHEET.SETTINGS);
    settingsMemo_ = sh ? sh.getDataRange().getValues() : [];
  }
  const row = settingsMemo_.find(r => String(r[0]).trim().toLowerCase().indexOf(name.toLowerCase()) === 0);
  return row ? row[1] : null;
}

function numberSetting_(name, fallback) {
  const v = setting_(name);
  const n = Number(String(v == null ? '' : v).replace(',', '.').replace('%', '').trim());
  return v === null || String(v).trim() === '' || !(n >= 0) ? fallback : n;
}

function optionalRequired_() {
  return Math.round(numberSetting_('Počet voliteľných videí', DEFAULTS.OPTIONAL));
}

/** Hranica úspešnosti v percentách (hodnota 0,75 v tabuľke sa berie ako 75 %). */
function passPercent_() {
  const n = numberSetting_('Hranica úspešnosti', DEFAULTS.PASS_PERCENT);
  return n > 0 && n <= 1 ? n * 100 : n;
}

/** Vzdelávanie je aktívne, ak je v Nastaveniach 1. */
function isActive_() {
  const v = setting_('Vzdelávanie aktívne');
  return v === true || String(v).trim() === '1';
}

/** Administrátori môžu aplikáciu používať aj pri neaktívnom vzdelávaní (testovanie). */
function courseOpen_(user) {
  return isActive_() || isAdmin_(user);
}

// ---------- Testovací režim (god mode) ----------

function isAdmin_(user) {
  return CONFIG.ADMINS.some(e => String(e).toLowerCase() === user.email);
}

function god_(user, req) {
  const map = progress_(user);
  const order = Number(req.video);
  switch (req.action) {
    case 'godmode':
      return { ok: true };
    case 'godSkipVideo': {
      const video = video_(order);
      const rec = requireStarted_(map, order);
      rec.v[P.WATCHED] = video.duration;
      rec.v[P.DONE] = true;
      save_(rec);
      return state_(user);
    }
    case 'godPassQuiz': {
      const video = video_(order);
      const rec = requireStarted_(map, order);
      rec.v[P.WATCHED] = video.duration;
      rec.v[P.DONE] = true;
      rec.v[P.PASSED] = true;
      rec.v[P.BEST] = 100;
      rec.v[P.TRIES] = (Number(rec.v[P.TRIES]) || 0) + 1;
      rec.v[P.PASSED_AT] = new Date();
      save_(rec);
      return state_(user);
    }
    case 'godAnswers':
      return { correct: questions_(order).map(q => q.correct) };
    case 'godReset':
      // Riadky v hárku Priebeh sa nemažú (heartbeat zapisuje podľa čísla riadku), iba sa vynulujú.
      Object.keys(map).forEach(k => {
        const rec = map[k];
        rec.v = [user.email, user.name, Number(k), 0, rec.v[P.DURATION], false, '', '', 0, 0, false, '', '', 0];
        save_(rec);
      });
      deleteUserRows_(SHEET.USERS, 0, user.email);
      deleteUserRows_(SHEET.CERTS, 1, user.email);
      return state_(user);
  }
  return { error: 'Neznáma akcia.' };
}

function deleteUserRows_(name, col, email) {
  const sh = sheet_(name);
  const data = sh.getDataRange().getValues();
  for (let r = data.length - 1; r >= 1; r--) {
    if (String(data[r][col]).toLowerCase() === email) sh.deleteRow(r + 1);
  }
}

// ---------- Osvedčenie ----------

function findCert_(email) {
  const rows = rows_(SHEET.CERTS);
  const row = rows.find(r => String(r[1]).toLowerCase() === email);
  if (!row) return null;
  return {
    id: String(row[0]), name: String(row[2]), date: formatDate_(row[3]),
    completed: row[4] instanceof Date ? formatDateTime_(row[4]) : '',
  };
}

/** Osvedčenie sa vydá raz; neskôr sa vždy vráti to isté (aj po vypnutí vzdelávania). */
function certificate_(user) {
  const existing = findCert_(user.email);
  if (existing) return { certificate: existing };
  const c = completion_(videos_(), progress_(user));
  if (!c.done) throw new Error('Vzdelávanie ešte nie je dokončené.');
  const prefix = String(setting_('Predpona čísla osvedčenia') || DEFAULTS.CERT_PREFIX).trim();
  const now = new Date();
  const base = prefix + '-' + now.getFullYear() + '-';
  const last = rows_(SHEET.CERTS).reduce((m, r) => {
    const id = String(r[0]);
    return id.indexOf(base) === 0 ? Math.max(m, Number(id.slice(base.length)) || 0) : m;
  }, 0);
  const id = base + String(last + 1).padStart(4, '0');
  const completed = c.completedAt || now;
  sheet_(SHEET.CERTS).appendRow([id, user.email, user.name, now, completed]);
  return { certificate: { id: id, name: user.name, date: formatDate_(now), completed: formatDateTime_(completed) } };
}

function formatDateTime_(d) {
  return Utilities.formatDate(d, Session.getScriptTimeZone(), "d. M. yyyy 'o' HH:mm");
}

function formatDate_(d) {
  return d instanceof Date ? Utilities.formatDate(d, Session.getScriptTimeZone(), 'd. M. yyyy') : String(d);
}
