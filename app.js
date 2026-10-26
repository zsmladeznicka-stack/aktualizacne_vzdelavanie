(() => {
  'use strict';

  const CFG = window.APP_CONFIG;
  const DEMO = !CFG.API_URL;
  const $ = (s) => document.querySelector(s);
  const VIEWS = ['loading', 'login', 'home', 'video', 'quiz', 'result', 'cert'];
  const YT_PLAYING = 1, YT_PAUSED = 2, YT_ENDED = 0, YT_BUFFERING = 3;
  const HEARTBEAT_MS = 20000;
  const BEAT_WARN_AFTER = 3; // varovanie až po toľkých neúspešných záznamoch za sebou
  const FALLBACK_TITLE = 'Aktualizačné vzdelávanie';

  let session = store('session');
  let state = null;
  let godMode = store('god') === '1';
  let search = '';
  let activeTags = [];
  const openCards = {}; // číslo videa → rozbalená karta v katalógu (len počas návštevy stránky)

  // ---------- Pomocné ----------

  function store(key, value) {
    try {
      if (value === undefined) return sessionStorage.getItem('akt-' + key);
      if (value === null) sessionStorage.removeItem('akt-' + key);
      else sessionStorage.setItem('akt-' + key, value);
    } catch (e) { /* úložisko nedostupné */ }
    return null;
  }

  function show(view) {
    VIEWS.forEach((v) => { $('#view-' + v).hidden = v !== view; });
    window.scrollTo(0, 0);
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function fmt(sec) {
    sec = Math.max(0, Math.floor(sec || 0));
    const h = Math.floor(sec / 3600), m = Math.floor(sec / 60) % 60, s = sec % 60;
    const mm = h ? String(m).padStart(2, '0') : m;
    return (h ? h + ':' : '') + mm + ':' + String(s).padStart(2, '0');
  }

  /** Text bez diakritiky a veľkých písmen – na vyhľadávanie. */
  function plain(s) {
    return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  }

  /** Slovenské tvary: 1 video, 2 videá, 5 videí. */
  function plural(n, one, few, many) {
    return n === 1 ? one : n >= 2 && n <= 4 ? few : many;
  }

  function showError(msg) {
    const el = $('#error');
    el.textContent = msg || '';
    el.hidden = !msg;
  }

  function byOrder(order) {
    return state.videos.find((v) => v.order === order);
  }

  async function api(action, data) {
    let out;
    if (DEMO) {
      out = await window.DemoApi.call(action, data);
    } else {
      const res = await fetch(CFG.API_URL, {
        method: 'POST',
        body: JSON.stringify(Object.assign({ action: action, session: session }, data)),
      });
      try {
        out = await res.json();
      } catch (e) {
        // napr. presmerovanie počas nasadzovania novej verzie Apps Scriptu
        throw new Error('Server odpovedal nečakane. Skúste to znova o chvíľu.');
      }
    }
    if (out.error === 'INACTIVE') {
      state.active = false;
      state.canStart = false;
      closePlayer();
      renderHome();
      throw new Error('Vzdelávanie momentálne nie je aktívne.');
    }
    if (out.error === 'SESSION_EXPIRED') {
      logout('Platnosť prihlásenia vypršala. Prihláste sa znova – váš priebeh je uložený.');
      throw new Error('Platnosť prihlásenia vypršala.');
    }
    if (out.error) throw new Error(out.error);
    return out;
  }

  // ---------- Prihlásenie ----------

  function initLogin() {
    $('#login-domain').textContent = '@' + CFG.DOMAIN;
    if (DEMO) {
      $('#demo-login').hidden = false;
      $('#demo-login').addEventListener('submit', async (e) => {
        e.preventDefault();
        try {
          onLogin(await api('login', { name: $('#demo-name').value.trim() }));
        } catch (err) {
          $('#login-msg').textContent = err.message;
        }
      });
      return;
    }
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = () => {
      google.accounts.id.initialize({
        client_id: CFG.GOOGLE_CLIENT_ID,
        hd: CFG.DOMAIN,
        auto_select: true,
        callback: async (resp) => {
          $('#login-msg').textContent = 'Overujem prihlásenie…';
          try {
            onLogin(await api('login', { idToken: resp.credential }));
          } catch (err) {
            $('#login-msg').textContent = err.message;
          }
        },
      });
      google.accounts.id.renderButton($('#gsi-button'), { theme: 'filled_blue', size: 'large', text: 'signin_with', locale: 'sk' });
    };
    document.head.appendChild(s);
  }

  function onLogin(r) {
    session = r.session;
    store('session', session);
    $('#login-msg').textContent = '';
    setState(r);
    renderHome();
  }

  function logout(msg) {
    closePlayer();
    session = null;
    state = null;
    store('session', null);
    setGod(false);
    if (!DEMO && window.google) google.accounts.id.disableAutoSelect();
    $('#user-box').hidden = true;
    $('#login-msg').textContent = msg || '';
    show('login');
  }

  function setState(r) {
    state = {
      user: r.user, school: r.school, course: r.course || '', hoursText: r.hoursText, openUntil: r.openUntil || '',
      passPercent: r.passPercent, optionalRequired: r.optionalRequired, mandatory: r.mandatory,
      mandatoryNote: r.mandatoryNote || '', admin: !!r.admin,
      active: r.active !== false,
      canStart: r.canStart !== undefined ? r.canStart : r.active !== false,
      videos: r.videos, inProgress: r.inProgress, optionalPassed: r.optionalPassed, complete: !!r.complete,
      certificate: r.certificate,
    };
    const title = state.course || FALLBACK_TITLE;
    $('#course-name').textContent = title;
    document.title = title;
    $('#user-name').textContent = state.user.name;
    $('#user-box').hidden = false;
    $('#god-bar').hidden = !godMode;
  }

  async function refresh() {
    setState(await api('state'));
  }

  // ---------- Testovací režim (god mode) ----------
  // Zapína sa 5 kliknutiami na názov kurzu v hlavičke do 3 sekúnd.
  // Server ho povolí len účtom uvedeným v CONFIG.ADMINS (Code.gs).
  // Tlačidlá pracujú s rozpracovaným videom.

  let godClicks = [];

  function setGod(on) {
    godMode = on;
    store('god', on ? '1' : null);
    $('#god-bar').hidden = !on || !state;
  }

  async function onTitleClick() {
    if (!state || godMode) return;
    const now = Date.now();
    godClicks = godClicks.filter((t) => now - t < 3000).concat(now);
    if (godClicks.length < 5) return;
    godClicks = [];
    try {
      await api('godmode');
      setGod(true);
    } catch (err) { /* nie je administrátor – nič nezobrazujeme */ }
  }

  async function godAction(action) {
    const order = state.inProgress;
    if (order === null && action !== 'godReset') {
      showError('Najprv spustite video v katalógu.');
      return;
    }
    if (action === 'godReset' && !confirm('Naozaj vymazať váš priebeh aj osvedčenie a začať odznova?')) return;
    closePlayer();
    try {
      setState(await api(action, { video: order }));
      renderHome();
    } catch (err) {
      showError(err.message);
    }
  }

  function markCorrectAnswers(order) {
    api('godAnswers', { video: order }).then((r) => {
      r.correct.forEach((c, k) => {
        const input = document.querySelector(`input[name="q${k}"][value="${c}"]`);
        if (input) input.closest('label').classList.add('god-correct');
      });
    }).catch(() => {});
  }

  // ---------- Prehľad ----------

  function mandatoryVideo() {
    return state.mandatory === null ? null : byOrder(state.mandatory);
  }

  function mandatoryPassed() {
    const m = mandatoryVideo();
    return !m || m.quizPassed;
  }

  /** Spoločný počet otázok a potrebných odpovedí, ak sú pri všetkých testoch rovnaké. */
  function quizRule() {
    const withQ = state.videos.filter((v) => v.questions > 0);
    if (!withQ.length) return null;
    const q = withQ[0].questions, n = withQ[0].needed;
    return withQ.every((v) => v.questions === q && v.needed === n) ? { questions: q, needed: n } : null;
  }

  function renderHowto() {
    const m = mandatoryVideo();
    const n = state.optionalRequired;
    const rule = quizRule();
    const quizLine = rule
      ? `Každý test má <strong>${rule.questions} otázok</strong>. Na splnenie treba aspoň <strong>${rule.needed} správnych odpovedí</strong>.`
      : `Na splnenie testu treba aspoň <strong>${state.passPercent} %</strong> správnych odpovedí.`;
    $('#howto-body').innerHTML = `
      <h3>Priebeh vzdelávania</h3>
      <ul>
        ${m ? `<li>Najprv pozriete <strong>povinné video</strong> „${esc(m.title)}“ a splníte test k nemu. Potom sa odomknú ostatné videá.</li>` : ''}
        <li>${m ? 'Potom si' : 'Z katalógu si'} vyberiete <strong>${n} ${plural(n, 'ľubovoľné video', 'ľubovoľné videá', 'ľubovoľných videí')}</strong> v ľubovoľnom poradí. Po každom videu nasleduje test.</li>
        <li>Naraz môžete mať rozpracované <strong>len jedno video</strong>. Rozpracované video môžete <strong>zanechať</strong> a vybrať si iné. Zanechané video začnete neskôr od začiatku.${m ? ' Povinné video sa zanechať nedá.' : ''}</li>
        <li>Po splnení ${m ? 'povinného videa a ' : ''}${n} ${plural(n, 'voliteľného videa', 'voliteľných videí', 'voliteľných videí')} získate <strong>osvedčenie</strong>. Ďalšie videá môžete pozerať aj potom, do osvedčenia sa však nerátajú.</li>
        <li>Videá môžete hľadať podľa názvu a anotácie alebo filtrovať kliknutím na nálepky.</li>
      </ul>
      <h3>Čas a ukladanie priebehu</h3>
      <ul>
        <li>Vzdelávanie nemá denný časový limit${state.openUntil ? ` a je otvorené <strong>do ${esc(state.openUntil)}</strong>` : ''}.</li>
        <li>Priebeh sa ukladá priebežne – môžete prestať, zatvoriť prehliadač a pokračovať tam, kde ste skončili.</li>
        <li>Osvedčenie si môžete stiahnuť kedykoľvek, aj neskôr.</li>
      </ul>
      <h3>Pozeranie videa</h3>
      <ul>
        <li>Video je potrebné <strong>pozrieť celé</strong>. Až potom sa odomkne test.</li>
        <li>Pri prvom pozeraní video <strong>nie je možné pretáčať dopredu ani zrýchliť</strong>.</li>
        <li>Ak prepnete na iné okno alebo kartu, alebo okno minimalizujete, <strong>video sa pozastaví</strong>. Pokračujete tlačidlom <em>Prehrať</em>.</li>
        <li>Splnené video si môžete kedykoľvek <strong>pozrieť znova</strong> a voľne ho pretáčať. Váš priebeh sa tým nezmení.</li>
      </ul>
      <h3>Test</h3>
      <ul>
        <li>${quizLine}</li>
        <li>Test nemá časový limit a môžete ho <strong>opakovať ľubovoľný počet krát</strong>.</li>
      </ul>
      <h3>Odporúčania</h3>
      <ul>
        <li>Aplikáciu majte otvorenú iba v jednej karte prehliadača.</li>
      </ul>
      <h3>Osvedčenie</h3>
      <ul>
        <li>Osvedčenie sa vygeneruje <strong>bez podpisu a pečiatky</strong>.</li>
        <li>Osvedčenie si stiahnite alebo vytlačte – <strong>podpíše ho riaditeľ školy</strong>.</li>
      </ul>`;
    // pri prvej návšteve je návod rozbalený, neskôr zbalený
    $('#howto').open = !state.videos.some((v) => v.started || v.quizPassed);
  }

  function banner(kind, icon, title, text) {
    return `<div class="banner admin ${kind}"><span class="admin-icon" aria-hidden="true">${icon}</span>`
      + `<div><strong>${title}</strong>${text ? '<br>' + text : ''}</div></div>`;
  }

  function renderStatus() {
    let html = '';
    if (state.admin) {
      if (!state.active) {
        html += banner('', '⏸', 'Vzdelávanie je pre učiteľov VYPNUTÉ',
          'V hárku Nastavenia je hodnota 0 – učitelia nemôžu spustiť videá ani testy. '
          + 'Ako administrátor môžete aplikáciu testovať. Spustíte ju prepísaním hodnoty na 1.');
      }
      const notes = [];
      if (!state.course) notes.push('V hárku Nastavenia nie je vyplnený názov programu (zobrazuje sa na osvedčení).');
      if (state.mandatoryNote) notes.push(esc(state.mandatoryNote));
      if (notes.length) html += banner('warnbox', '!', 'Nastavenia treba doplniť', notes.join('<br>'));
    } else if (!state.canStart) {
      const any = state.videos.some((v) => v.started || v.quizPassed);
      html += any
        ? banner('notice', 'i', 'Vzdelávanie je momentálne vypnuté',
          'Váš priebeh je uložený. Osvedčenie si môžete stiahnuť kedykoľvek.')
        : banner('notice', 'i', 'Vzdelávanie zatiaľ nie je spustené',
          'Môžete si prečítať, ako funguje, a pozrieť si katalóg videí. Videá a testy bude možné spustiť po zahájení vzdelávania.');
    }
    if (state.canStart && state.openUntil && !state.complete) {
      html += `<div class="banner info">Vzdelávanie je otvorené <strong>do ${esc(state.openUntil)}</strong>.</div>`;
    }
    $('#status').innerHTML = html;
  }

  function renderProgress() {
    const m = mandatoryVideo();
    const n = state.optionalRequired;
    const got = Math.min(state.optionalPassed, n);
    const extra = Math.max(0, state.optionalPassed - n);
    let html = '<h2>Váš postup</h2><ul class="checklist">';
    if (m) {
      html += `<li class="${m.quizPassed ? 'done' : ''}"><span class="icon">${m.quizPassed ? '✓' : '1'}</span>`
        + `<span>Povinné video: ${m.quizPassed ? 'splnené' : 'nesplnené'}</span></li>`;
    }
    html += `<li class="${got >= n ? 'done' : ''}"><span class="icon">${got >= n ? '✓' : m ? '2' : '1'}</span>`
      + `<span>Voliteľné videá: splnené <strong>${got} z ${n}</strong>${extra ? ` (navyše ${extra})` : ''}</span></li></ul>`;
    html += `<div class="meter" aria-hidden="true"><div style="width:${n ? got / n * 100 : 100}%"></div></div>`;
    if (state.complete || state.certificate) {
      html += '<p class="ok-text">Vzdelávanie máte splnené. Ďalšie videá môžete pozerať, do osvedčenia sa však nerátajú.</p>'
        + '<button class="btn primary big" id="open-cert">Zobraziť osvedčenie</button>';
    }
    $('#progress').innerHTML = html;
    if ($('#open-cert')) $('#open-cert').onclick = openCert;
  }

  /** Tlačidlá a poznámka ku karte videa podľa jeho stavu. */
  function videoActions(v) {
    const btn = (cls, attr, label) => `<button class="btn ${cls}" ${attr}="${v.order}">${label}</button>`;
    if (v.quizPassed) {
      return { note: `Test splnený (${v.best} %)`, buttons: btn('small', 'data-review', '▶ Pozrieť znova') };
    }
    if (v.started) {
      const parts = [];
      if (!state.canStart) {
        return { note: v.videoDone ? 'Video dopozerané, test zatiaľ nesplnený.' : `Pozreté ${fmt(v.watched)}`, buttons: '' };
      }
      if (v.videoDone) {
        parts.push(btn('primary', 'data-quiz', 'Spustiť test'));
        parts.push(btn('small', 'data-review', '▶ Pozrieť znova'));
      } else {
        parts.push(btn('primary', 'data-play', v.watched > 0 ? '▶ Pokračovať vo videu' : '▶ Spustiť video'));
      }
      if (!v.mandatory) parts.push(btn('small ghost danger', 'data-abandon', 'Zanechať video'));
      const note = v.videoDone
        ? (v.tries ? `Video dopozerané · pokusy: ${v.tries}, najlepšie ${v.best} %` : 'Video dopozerané · test čaká')
        : v.watched > 0 ? `Pozreté ${fmt(v.watched)} z ${fmt(v.duration)}` : '';
      return { note: note, buttons: parts.join('') };
    }
    if (!state.canStart) return { note: '', buttons: '' };
    if (!v.mandatory && !mandatoryPassed()) return { note: 'Odomkne sa po splnení povinného videa.', buttons: '' };
    if (state.inProgress !== null) {
      return { note: 'Najprv dokončite alebo zanechajte rozpracované video.', buttons: '' };
    }
    return { note: '', buttons: btn('primary', 'data-start', '▶ Spustiť video') };
  }

  function statusBadge(v) {
    if (v.quizPassed) return '<span class="badge done">Splnené</span>';
    if (v.started) return '<span class="badge progress">Rozpracované</span>';
    return '<span class="badge">Nezačaté</span>';
  }

  function isOpen(v) {
    // pri prvej návšteve je rozbalené povinné video, aby bolo jasné, kde začať
    return v.order in openCards ? openCards[v.order] : v.mandatory && !v.started;
  }

  /** Karta videa. V katalógu je zbalená (názov, dĺžka, stav), po kliknutí sa rozbalí. */
  function videoCard(v, collapsible) {
    const a = videoActions(v);
    const cls = ['vcard', v.mandatory ? 'mandatory' : '', v.quizPassed ? 'done' : v.started ? 'progress' : ''].join(' ');
    const tags = v.tags.map((t) => `<button class="tag${activeTags.includes(t) ? ' on' : ''}" data-tag="${esc(t)}">${esc(t)}</button>`).join('');
    const head = `<h3>${esc(v.title)}</h3>
      <span class="meta">${v.mandatory ? '<span class="badge mand">Povinné</span>' : ''}<span>${fmt(v.duration)}</span>${statusBadge(v)}</span>`;
    const body = `${v.annotation ? `<p class="annot">${esc(v.annotation)}</p>` : ''}
      ${tags ? `<div class="vtags">${tags}</div>` : ''}
      ${a.note || a.buttons ? `<div class="vactions">${a.note ? `<span class="note">${esc(a.note)}</span>` : ''}${a.buttons}</div>` : ''}`;
    if (!collapsible) return `<article class="${cls}"><div class="vhead">${head}</div>${body}</article>`;
    return `<details class="${cls}" data-order="${v.order}"${isOpen(v) ? ' open' : ''}>
      <summary class="vhead">${head}</summary>${body}</details>`;
  }

  function renderCurrent() {
    const v = state.inProgress === null ? null : byOrder(state.inProgress);
    $('#current').innerHTML = v ? `<h2 class="current-title">Rozpracované video</h2>${videoCard(v, false)}` : '';
  }

  /** Nálepky zoradené podľa počtu videí (všeobecné skôr), potom abecedne. */
  function allTags() {
    const counts = {};
    state.videos.forEach((v) => v.tags.forEach((t) => { counts[t] = (counts[t] || 0) + 1; }));
    return Object.keys(counts).sort((x, y) => counts[y] - counts[x] || x.localeCompare(y, 'sk')).map((t) => ({ tag: t, count: counts[t] }));
  }

  function matches(v) {
    if (activeTags.length && !v.tags.some((t) => activeTags.includes(t))) return false; // ALEBO
    if (!search) return true;
    return plain(v.title + ' ' + v.annotation).includes(plain(search));
  }

  function renderCatalog() {
    const tags = allTags();
    activeTags = activeTags.filter((t) => tags.some((x) => x.tag === t));
    $('#tags').innerHTML = tags.map((x) => `<button class="tag${activeTags.includes(x.tag) ? ' on' : ''}" data-tag="${esc(x.tag)}"`
      + ` aria-pressed="${activeTags.includes(x.tag)}">${esc(x.tag)} <span class="count">${x.count}</span></button>`).join('')
      + (activeTags.length ? '<button class="link" id="tags-clear">Zrušiť výber</button>' : '');
    // povinné video je vždy prvé
    const list = state.videos.slice().sort((x, y) => (y.mandatory - x.mandatory) || (x.order - y.order)).filter(matches);
    const filtered = activeTags.length || search;
    const info = $('#filter-info');
    info.hidden = !filtered;
    info.textContent = filtered
      ? `Zobrazené: ${list.length} z ${state.videos.length}` + (activeTags.length > 1 ? ' (videá s aspoň jednou zo zvolených nálepiek)' : '') : '';
    $('#catalog').innerHTML = list.length ? list.map((v) => videoCard(v, true)).join('') : '<p class="muted">Žiadne video nevyhovuje výberu.</p>';
    if ($('#tags-clear')) $('#tags-clear').onclick = () => { activeTags = []; renderCatalog(); };
  }

  function toggleTag(tag) {
    activeTags = activeTags.includes(tag) ? activeTags.filter((t) => t !== tag) : activeTags.concat(tag);
    renderCatalog();
  }

  function renderHome() {
    showError('');
    $('#hello-name').textContent = state.user.name;
    renderStatus();
    renderHowto();
    renderProgress();
    renderCurrent();
    renderCatalog();
    show('home');
  }

  async function goHome() {
    closePlayer();
    try {
      await refresh();
    } catch (err) { /* ukážeme posledný známy stav */ }
    renderHome();
  }

  // ---------- Akcie v katalógu ----------

  async function startVideo(order) {
    showError('');
    try {
      setState(await api('start', { video: order }));
    } catch (err) {
      showError(err.message);
      return;
    }
    openVideo(order);
  }

  async function abandonVideo(order) {
    const v = byOrder(order);
    if (!confirm(`Naozaj zanechať video „${v.title}“?\n\nPozretý čas aj pokusy v teste sa vynulujú. Video si môžete vybrať neskôr a začnete od začiatku.`)) return;
    showError('');
    try {
      setState(await api('abandon', { video: order }));
      renderHome();
    } catch (err) {
      showError(err.message);
    }
  }

  function onCatalogClick(e) {
    const el = e.target.closest('[data-tag],[data-start],[data-play],[data-quiz],[data-review],[data-abandon]');
    if (!el) return;
    const d = el.dataset;
    if (d.tag !== undefined) toggleTag(d.tag);
    else if (d.start) startVideo(Number(d.start));
    else if (d.play) openVideo(Number(d.play));
    else if (d.quiz) openQuiz(Number(d.quiz));
    else if (d.review) openVideo(Number(d.review), true);
    else if (d.abandon) abandonVideo(Number(d.abandon));
  }

  // ---------- Video ----------

  const ytApi = new Promise((resolve) => { window.onYouTubeIframeAPIReady = resolve; });
  let player = null, tick = null, vOrder = null, maxWatched = 0, lastBeatAt = 0, beatBusy = false, beatAgain = false;
  let beatFails = 0, beatRetry = null;
  // Opakované pozretie dopozeraného videa: voľné pretáčanie a nič sa neposiela na server,
  // takže priebeh sa nemôže zmeniť.
  let review = false;

  function loadYouTube() {
    if (document.querySelector('script[src*="youtube.com/iframe_api"]')) return;
    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    document.head.appendChild(s);
  }

  function setNotice(msg, kind) {
    const el = $('#video-notice');
    el.textContent = msg || '';
    el.className = 'banner' + (kind ? ' ' + kind : '');
    el.hidden = !msg;
  }

  function isPlaying() {
    const s = player && player.getPlayerState ? player.getPlayerState() : -1;
    return s === YT_PLAYING || s === YT_BUFFERING;
  }

  async function openVideo(order, isReview) {
    loadYouTube();
    closePlayer();
    showError('');
    const v = byOrder(order);
    vOrder = order;
    review = !!isReview;
    beatFails = 0;
    maxWatched = review ? v.duration : v.watched;
    $('#video-title').textContent = v.title + (review ? ' (opakované pozretie)' : '');
    $('#to-quiz').hidden = review || !v.videoDone || v.quizPassed;
    $('#rules').classList.toggle('review', review);
    $('#rules-text').innerHTML = review
      ? '<strong>Opakované pozretie: video môžete voľne pretáčať</strong> – kliknutím na lištu alebo tlačidlami.<br>'
        + 'Váš priebeh sa tým nezmení, video nemusíte dopozerať.'
      : '<strong>Video nie je možné pretáčať dopredu ani zrýchliť.</strong><br>'
        + '<strong>Ak prepnete na iné okno alebo kartu, video sa pozastaví.</strong>';
    $('#back10').hidden = $('#fwd30').hidden = !review;
    $('#bar').classList.toggle('seekable', review);
    const demoNote = DEMO && !review ? 'Ukážkový režim: video sa ráta ako dopozerané po 1 minúte. V ostrom režime treba pozrieť celé video. ' : '';
    setNotice(demoNote + (!review && v.watched > 0 && !v.videoDone ? `Pokračujete od ${fmt(v.watched)}.` : ''));
    updateBar(maxWatched);
    show('video');
    await ytApi;
    if (vOrder !== order) return;
    $('#yt-host').innerHTML = '<div id="yt"></div>';
    const p = new YT.Player('yt', {
      videoId: v.youtubeId,
      width: '100%',
      height: '100%',
      playerVars: {
        controls: 0, disablekb: 1, fs: 0, rel: 0, modestbranding: 1, iv_load_policy: 3,
        playsinline: 1, start: review ? 0 : Math.floor(Math.max(0, maxWatched - 3)),
      },
      events: {
        onReady: () => {
          if (player !== p) return; // medzitým zatvorené
          p.setVolume(Number($('#volume').value));
          tick = setInterval(onTick, 250);
        },
        onStateChange: (e) => { if (player === p) onPlayerState(e); },
      },
    });
    player = p;
  }

  function closePlayer() {
    clearInterval(tick);
    clearTimeout(beatRetry);
    tick = null;
    if (player) {
      if (isPlaying()) player.pauseVideo();
      if (vOrder !== null) heartbeat();
      try { player.destroy(); } catch (e) { /* už zrušený */ }
    }
    player = null;
    $('#yt-host').innerHTML = '';
    if (document.fullscreenElement) document.exitFullscreen();
  }

  function onTick() {
    if (!player || !player.getCurrentTime) return;
    if (player.getPlaybackRate && player.getPlaybackRate() !== 1) player.setPlaybackRate(1);
    const t = player.getCurrentTime();
    if (review) {
      updateBar(t);
      return;
    }
    if (t > maxWatched + 2) {
      // pokus o posun dopredu – vrátiť na najďalšie pozreté miesto
      player.seekTo(maxWatched, true);
      return;
    }
    if (t > maxWatched) maxWatched = t;
    if (isPlaying() && Date.now() - lastBeatAt > HEARTBEAT_MS) heartbeat();
    updateBar(t);
  }

  function updateBar(t) {
    const v = byOrder(vOrder);
    const dur = (player && player.getDuration && player.getDuration()) || v.duration || 1;
    $('#bar-watched').style.width = Math.min(100, maxWatched / dur * 100) + '%';
    $('#bar-current').style.width = Math.min(100, t / dur * 100) + '%';
    $('#time').textContent = fmt(t) + ' / ' + fmt(dur);
  }

  function onPlayerState(e) {
    $('#play').textContent = e.data === YT_PLAYING || e.data === YT_BUFFERING ? '❚❚ Pozastaviť' : '▶ Prehrať';
    if (e.data === YT_PLAYING && beatFails < BEAT_WARN_AFTER) setNotice('');
    if (e.data === YT_PLAYING || e.data === YT_PAUSED) heartbeat();
    if (e.data === YT_ENDED) {
      maxWatched = Math.max(maxWatched, player.getDuration());
      heartbeat();
    }
  }

  /**
   * Priebežný záznam pozretia. Ojedinelú chybu (napr. presmerovanie počas nasadzovania novej verzie)
   * potichu zopakuje – ďalší záznam čas aj tak dopočíta. Varovanie ukáže až po opakovaných chybách.
   */
  async function heartbeat() {
    if (review) return; // opakované pozretie nemení priebeh
    if (beatBusy) { beatAgain = true; return; }
    beatBusy = true;
    lastBeatAt = Date.now();
    clearTimeout(beatRetry);
    const order = vOrder;
    try {
      const r = await api('heartbeat', { video: order, position: Math.floor(maxWatched) });
      const v = byOrder(order);
      if (beatFails >= BEAT_WARN_AFTER && order === vOrder) setNotice('Spojenie je opäť v poriadku, priebeh sa ukladá.', 'ok');
      beatFails = 0;
      v.watched = r.watched;
      if (r.videoDone && !v.videoDone) setNotice('Video je dopozerané. Môžete pokračovať na test.', 'ok');
      v.videoDone = r.videoDone;
      if (order === vOrder) {
        $('#to-quiz').hidden = !v.videoDone || v.quizPassed;
        if (!r.videoDone && player && player.getPlayerState() === YT_ENDED) {
          // server nezaznamenal celé pozretie (napr. výpadok spojenia)
          maxWatched = r.watched;
          player.seekTo(r.watched, true);
          player.pauseVideo();
          setNotice(`Časť videa sa nepodarilo zaznamenať. Dopozerajte ju, prosím, od ${fmt(r.watched)}.`, 'warn');
        }
      }
    } catch (err) {
      if (!session) return;
      if (/nie je spustené/.test(err.message)) {
        // video bolo medzitým zanechané (napr. v inej karte)
        if (order === vOrder) goHome().then(() => showError(err.message));
        return;
      }
      beatFails++;
      if (beatFails >= BEAT_WARN_AFTER) {
        setNotice('Priebeh sa nedarí uložiť – skontrolujte pripojenie na internet. Pozretý čas sa dopočíta, keď sa spojenie obnoví.', 'warn');
      } else if (order === vOrder && player) {
        beatRetry = setTimeout(heartbeat, 5000);
      }
    } finally {
      beatBusy = false;
      if (beatAgain) { beatAgain = false; heartbeat(); }
    }
  }

  function seekBy(sec) {
    if (!review || !player || !player.getCurrentTime) return;
    const dur = player.getDuration() || byOrder(vOrder).duration;
    player.seekTo(Math.min(Math.max(0, player.getCurrentTime() + sec), dur - 1), true);
  }

  function seekToBar(e) {
    if (!review || !player || !player.getDuration) return;
    const rect = $('#bar').getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    player.seekTo(frac * player.getDuration(), true);
  }

  function togglePlay() {
    if (!player || !player.getPlayerState) return;
    if (isPlaying()) player.pauseVideo();
    else player.playVideo();
  }

  function pauseBecauseLeft() {
    if (player && isPlaying()) {
      player.pauseVideo();
      setNotice('Video sa pozastavilo, pretože ste opustili okno. Pokračujte tlačidlom Prehrať.', 'warn');
    }
  }

  // ---------- Test ----------

  let quiz = null;

  async function openQuiz(order) {
    closePlayer();
    showError('');
    let r;
    try {
      r = await api('quiz', { video: order });
    } catch (err) {
      showError(err.message);
      return;
    }
    const v = byOrder(order);
    quiz = { order: order, questions: r.questions };
    $('#quiz-title').textContent = `Test: ${v.title}`;
    $('#quiz-info').textContent = `Na splnenie treba aspoň ${r.needed} správnych odpovedí z ${r.questions.length}. Test nemá časový limit.`;
    $('#quiz-form').innerHTML = r.questions.map((q, k) => `
      <fieldset class="question">
        <legend>${k + 1}. ${esc(q.text)}</legend>
        ${q.options.map((o, j) => `<label><input type="radio" name="q${k}" value="${j}"> <span>${esc(o)}</span></label>`).join('')}
      </fieldset>`).join('');
    $('#quiz-submit').disabled = false;
    $('#quiz-submit').textContent = 'Odovzdať test';
    show('quiz');
    if (godMode) markCorrectAnswers(order);
  }

  async function submitQuiz() {
    if (!quiz || $('#quiz-submit').disabled) return;
    const answers = quiz.questions.map((q, k) => {
      const c = document.querySelector(`input[name="q${k}"]:checked`);
      return c ? Number(c.value) : -1;
    });
    if (answers.includes(-1) && !confirm('Niektoré otázky nemáte zodpovedané. Naozaj chcete test odovzdať?')) return;
    $('#quiz-submit').disabled = true;
    $('#quiz-submit').textContent = 'Vyhodnocujem test…';
    const order = quiz.order;
    let r;
    try {
      r = await api('submit', { video: order, answers: answers });
    } catch (err) {
      showError('Test sa nepodarilo odovzdať: ' + err.message);
      $('#quiz-submit').disabled = false;
      $('#quiz-submit').textContent = 'Odovzdať test';
      return;
    }
    quiz = null;
    try {
      await refresh();
    } catch (err) { /* výsledok ukážeme aj tak */ }
    showResult(order, r);
  }

  function showResult(order, r) {
    const v = byOrder(order);
    let html = `<h1>Test: ${esc(v.title)}</h1>
      <div class="score ${r.passed ? 'ok' : 'bad'}">${r.correct} z ${r.total}</div>
      <p>Správne odpovede: ${r.correct} z ${r.total} (${r.score} %)</p>`;
    if (r.passed) {
      const certNow = r.complete && !state.certificate;
      html += `<p>Test ste úspešne splnili.</p>`
        + (certNow ? '<p><strong>Splnili ste celé vzdelávanie.</strong></p>' : '')
        + `<button class="btn primary big" id="result-next">${certNow ? 'Získať osvedčenie' : 'Späť na katalóg'}</button>`;
    } else {
      html += `<p>Na splnenie treba aspoň ${r.needed} správnych odpovedí. Test môžete zopakovať.</p>
        <button class="btn primary big" id="result-retry">Skúsiť znova</button>
        <p><button class="link" id="result-review">Pozrieť video znova</button> · <button class="link" id="result-home">Späť na katalóg</button></p>`;
    }
    $('#result-box').innerHTML = html;
    show('result');
    if (r.passed) {
      $('#result-next').onclick = r.complete && !state.certificate ? openCert : renderHome;
    } else {
      $('#result-retry').onclick = () => openQuiz(order);
      $('#result-review').onclick = () => openVideo(order, true);
      $('#result-home').onclick = renderHome;
    }
  }

  // ---------- Osvedčenie ----------

  async function openCert() {
    showError('');
    if (!state.course && !state.admin) {
      showError('Osvedčenie zatiaľ nie je možné zobraziť – v nastaveniach chýba názov programu. Kontaktujte administrátora.');
      return;
    }
    try {
      state.certificate = (await api('certificate')).certificate;
    } catch (err) {
      showError(err.message);
      return;
    }
    const c = state.certificate;
    $('#cert-school').textContent = state.school.replace(' - ', '\n');
    $('#cert-name').textContent = c.name;
    $('#cert-course').textContent = state.course ? '„' + state.course + '“' : '[Názov programu – doplňte v hárku Nastavenia]';
    $('#cert-text').textContent = `Vzdelávanie v rozsahu ${state.hoursText}`;
    $('#cert-date').textContent = c.date;
    $('#cert-completed').textContent = c.completed || c.date;
    $('#cert-id').textContent = c.id;
    show('cert');
  }

  async function downloadPdf() {
    const btn = $('#cert-pdf');
    btn.disabled = true;
    btn.textContent = 'Pripravujem…';
    try {
      const canvas = await html2canvas($('#certificate'), { scale: 3, backgroundColor: '#ffffff' });
      const pdf = new window.jspdf.jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
      pdf.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, 297, 210);
      const slug = state.certificate.name.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9]+/g, '-');
      pdf.save(`osvedcenie-${slug}.pdf`);
    } catch (err) {
      showError('PDF sa nepodarilo vytvoriť. Použite tlačidlo Tlačiť → Uložiť ako PDF.');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Stiahnuť PDF';
    }
  }

  // ---------- Udalosti ----------

  $('#logout').onclick = () => { if (DEMO) window.DemoApi.reset(); logout(); };
  $('#video-back').onclick = goHome;
  $('#to-quiz').onclick = () => openQuiz(vOrder);
  $('#play').onclick = togglePlay;
  $('#shield').onclick = togglePlay;
  $('#volume').oninput = (e) => { if (player && player.setVolume) player.setVolume(Number(e.target.value)); };
  $('#fullscreen').onclick = () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else $('#player-box').requestFullscreen();
  };
  $('#quiz-submit').onclick = submitQuiz;
  $('#quiz-form').onsubmit = (e) => e.preventDefault();
  $('#cert-back').onclick = renderHome;
  $('#cert-print').onclick = () => window.print();
  $('#cert-pdf').onclick = downloadPdf;
  $('#course-name').addEventListener('click', onTitleClick);
  $('#back10').onclick = () => seekBy(-10);
  $('#fwd30').onclick = () => seekBy(30);
  $('#bar').addEventListener('click', seekToBar);
  $('#view-home').addEventListener('click', onCatalogClick);
  // toggle nebublá, preto zachytávanie (capture) na celom katalógu
  $('#catalog').addEventListener('toggle', (e) => { openCards[e.target.dataset.order] = e.target.open; }, true);
  $('#search').addEventListener('input', (e) => { search = e.target.value.trim(); renderCatalog(); });
  $('#god-skip').onclick = () => godAction('godSkipVideo');
  $('#god-pass').onclick = () => godAction('godPassQuiz');
  $('#god-reset').onclick = () => godAction('godReset');
  $('#god-off').onclick = () => setGod(false);

  // Video sa zastaví pri prepnutí karty, minimalizácii alebo prechode do iného okna.
  document.addEventListener('visibilitychange', () => { if (document.hidden) pauseBecauseLeft(); });
  window.addEventListener('blur', pauseBecauseLeft);

  window.addEventListener('pagehide', () => {
    if (!player || DEMO || review || vOrder === null) return;
    navigator.sendBeacon(CFG.API_URL, JSON.stringify({ action: 'heartbeat', session: session, video: vOrder, position: Math.floor(maxWatched) }));
  });

  // ---------- Štart ----------

  (async () => {
    initLogin();
    if (session) {
      try {
        await refresh();
        renderHome();
        return;
      } catch (err) { /* prihlásenie neplatné */ }
    }
    show('login');
  })();
})();
