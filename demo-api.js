// Ukážkový režim: napodobňuje backend (apps-script/Code.gs) v prehliadači,
// aby sa dala aplikácia vyskúšať bez nastavenia Google služieb.
// Videá sa v ukážke rátajú ako dopozerané po 60 sekundách. Všetky ukážkové videá prehrávajú
// verejné ukážkové video YouTube; skutočné ID videí vzdelávania sú len v tabuľke.
window.DemoApi = (() => {
  const SAMPLE_ID = 'M7lc1UVf-VE';
  const VIDEOS = [
    { order: 1, title: 'Najnovšie online trendy detí', duration: 4391, tags: ['Online svet detí', 'Prevencia', 'Kyberbezpečnosť', 'Pre triednych učiteľov'],
      annotation: 'Aké online trendy priniesli deti v rokoch 2025 a 2026 a ako rozlíšiť trendy, ktoré sú len otravné, od nebezpečných.' },
    { order: 2, title: 'Vytvorte si knižnicu promptov', duration: 3685, tags: ['AI', 'Tvorba materiálov'],
      annotation: 'Ako napísať dobrú výzvu (prompt) pre Copilota a ako si overené výzvy ukladať a zdieľať s kolegami.' },
    { order: 4, title: 'Simulácie a virtuálne laboratóriá vo vyučovaní chémie', duration: 3705, tags: ['Chémia', 'Prírodné vedy', 'Simulácie', 'Bádanie', 'Tvorba materiálov'],
      annotation: 'Prehľad digitálnych nástrojov pre chémiu: kreslenie aparatúr, 3D modely molekúl a virtuálne laboratóriá.' },
    { order: 5, title: 'Úvod do informačnej bezpečnosti', duration: 3500, tags: ['Kyberbezpečnosť', 'Ochrana údajov'],
      annotation: 'Prečo sa informačná bezpečnosť týka každého učiteľa a ako rozpoznať phishing a ďalšie triky sociálneho inžinierstva.' },
    { order: 6, title: 'Dejepis inovovane', duration: 3801, tags: ['Dejepis', 'Humanitné predmety', 'Bádanie', 'Kritické myslenie', 'Gamifikácia'],
      annotation: 'Ako učiť dejepis bádateľsky: práca s historickými prameňmi a minulosť z rôznych perspektív.' },
    { order: 7, title: 'Digitálne technológie v predmete Slovenský jazyk a literatúra', duration: 3737,
      tags: ['Slovenčina', 'Humanitné predmety', 'Gamifikácia', 'Projektové vyučovanie', 'Tvorba materiálov'],
      annotation: 'Ako rozvíjať digitálne kompetencie na hodinách slovenčiny: slovníky, nárečové nástroje, cvičenia a WebQuest.' },
    { order: 8, title: 'PhotoVoice a participatívne video – kreatívne využitie digitálnych nástrojov v prevencii', duration: 5241,
      tags: ['Prevencia', 'Online svet detí', 'Ochrana údajov', 'Projektové vyučovanie', 'Pre triednych učiteľov'],
      annotation: 'Ako používať metódy PhotoVoice a participatívne video vo vyučovaní a v prevencii.' },
    { order: 9, title: 'Zdravotná gramotnosť v biológii s pomocou digitálnych technológií', duration: 3497,
      tags: ['Biológia', 'Prírodné vedy', 'Prevencia', 'Kritické myslenie', 'Práca s dátami'],
      annotation: 'Čo je zdravotná gramotnosť a ako ju rozvíjať pomocou databáz, online kalkulačiek a overovania informácií.' },
    { order: 10, title: 'Bádajme na fyzike, digitálne technológie nám pomôžu', duration: 3717,
      tags: ['Fyzika', 'Prírodné vedy', 'Bádanie', 'Simulácie', 'Práca s dátami'],
      annotation: 'Meranie na videozázname, senzory, matematické modelovanie a simulácie na hodinách fyziky.' },
    { order: 11, title: 'Vyučovanie v ére umelej inteligencie', duration: 3665, tags: ['AI', 'Kritické myslenie', 'Ochrana údajov', 'Tvorba materiálov'],
      annotation: 'Čo je gramotnosť v oblasti umelej inteligencie a ako posúdiť, či je nástroj AI bezpečný pre školu.' },
  ];
  const MANDATORY = 5;
  const OPTIONAL = 5;
  const PASS_PERCENT = 75;
  const DEMO_WATCH_SECONDS = 60; // v ukážke sa video ráta ako dopozerané po 1 minúte
  const QUESTIONS = 8;
  const CORRECT = [0, 1, 2, 3, 0, 1, 2, 3];
  const needed = (n) => Math.ceil(n * PASS_PERCENT / 100 - 1e-9);
  const question = (k) => ({
    text: `Ukážková otázka ${k + 1}: ktorá odpoveď je správna?`,
    options: ['Odpoveď A', 'Odpoveď B', 'Odpoveď C', 'Odpoveď D'].map((o, j) => (j === CORRECT[k] ? o + ' (správna)' : o)),
  });
  const KEY = 'akt-demo-v1';
  let memory = null;

  const empty = () => ({ started: false, watched: 0, videoDone: false, quizPassed: false, best: 0, tries: 0, passedAt: 0, quizOn: false });
  const load = () => {
    try { memory = JSON.parse(localStorage.getItem(KEY)) || memory; } catch (e) { /* bez úložiska */ }
    return memory || { user: null, progress: Object.fromEntries(VIDEOS.map((v) => [v.order, empty()])), cert: null };
  };
  const save = (db) => {
    memory = db;
    try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) { /* bez úložiska */ }
  };

  const video = (order) => {
    const v = VIDEOS.find((x) => x.order === order);
    if (!v) throw new Error('Neznáme video.');
    return v;
  };
  const inProgress = (db) => {
    const v = VIDEOS.find((x) => db.progress[x.order].started && !db.progress[x.order].quizPassed);
    return v ? v.order : null;
  };
  const started = (db, order) => {
    video(order);
    const p = db.progress[order];
    if (!p.started) throw new Error('Video nie je spustené. Spustite ho v katalógu.');
    return p;
  };
  const completion = (db) => {
    const opt = VIDEOS.filter((v) => v.order !== MANDATORY && db.progress[v.order].quizPassed).length;
    return { optionalPassed: opt, done: db.progress[MANDATORY].quizPassed && opt >= OPTIONAL };
  };

  const state = (db) => {
    const c = completion(db);
    return {
      user: db.user,
      school: 'Základná škola Štefana Koháriho II. s VJM - II. Koháry István Alapiskola',
      course: 'Aktualizačné vzdelávanie (ukážka)',
      hoursText: '10 vyučovacích hodín (1 vyučovacia hodina = 45 minút)',
      openUntil: '',
      passPercent: PASS_PERCENT,
      optionalRequired: OPTIONAL,
      mandatory: MANDATORY,
      mandatoryNote: '',
      active: true,
      canStart: true,
      admin: true, // v ukážke je dostupný testovací režim
      now: Date.now(),
      videos: VIDEOS.map((v) => {
        const p = db.progress[v.order];
        return Object.assign({ youtubeId: SAMPLE_ID, mandatory: v.order === MANDATORY, questions: QUESTIONS, needed: needed(QUESTIONS) }, v, {
          started: p.started, watched: p.watched, videoDone: p.videoDone, quizPassed: p.quizPassed, best: p.best, tries: p.tries,
        });
      }),
      inProgress: inProgress(db),
      optionalPassed: c.optionalPassed,
      complete: c.done,
      certificate: db.cert,
    };
  };

  const actions = {
    login(db, d) {
      db.user = { email: 'ucitel@koharysuli.sk', name: d.name || 'Ukážkový učiteľ' };
      return Object.assign({ session: 'demo' }, state(db));
    },
    state: (db) => state(db),
    start(db, d) {
      video(d.video);
      if (d.video !== MANDATORY && !db.progress[MANDATORY].quizPassed) throw new Error('Najprv splňte povinné video a test k nemu.');
      const p = db.progress[d.video];
      if (p.quizPassed) throw new Error('Toto video už máte splnené. Môžete si ho pozrieť znova.');
      if (p.started) return state(db);
      const busy = inProgress(db);
      if (busy !== null) throw new Error(`Najprv dokončite alebo zanechajte rozpracované video „${video(busy).title}“.`);
      db.progress[d.video] = Object.assign(empty(), { started: true });
      return state(db);
    },
    abandon(db, d) {
      if (d.video === MANDATORY) throw new Error('Povinné video sa nedá zanechať.');
      const p = started(db, d.video);
      if (p.quizPassed) throw new Error('Splnené video sa nedá zanechať.');
      db.progress[d.video] = empty();
      return state(db);
    },
    heartbeat(db, d) {
      const p = started(db, d.video);
      p.watched = Math.max(p.watched, Math.min(d.position, video(d.video).duration));
      if (p.watched >= DEMO_WATCH_SECONDS) p.videoDone = true;
      return { watched: p.watched, videoDone: p.videoDone };
    },
    quiz(db, d) {
      const p = started(db, d.video);
      if (!p.videoDone) throw new Error('Najprv dopozerajte video.');
      if (p.quizPassed) throw new Error('Tento test už máte splnený.');
      p.quizOn = true;
      return { needed: needed(QUESTIONS), questions: CORRECT.map((c, k) => question(k)) };
    },
    submit(db, d) {
      const p = started(db, d.video);
      if (p.quizPassed) throw new Error('Tento test už máte splnený.');
      if (!p.quizOn) throw new Error('Test nebol spustený.');
      const correct = CORRECT.filter((c, k) => Number(d.answers[k]) === c).length;
      const passed = correct >= needed(QUESTIONS);
      const score = Math.round(correct / QUESTIONS * 100);
      p.quizOn = false;
      p.tries++;
      p.best = Math.max(p.best, score);
      if (passed) Object.assign(p, { quizPassed: true, passedAt: Date.now() });
      return { score, correct, total: QUESTIONS, needed: needed(QUESTIONS), passed, complete: completion(db).done };
    },
    godmode: () => ({ ok: true }),
    godSkipVideo(db, d) {
      Object.assign(started(db, d.video), { watched: video(d.video).duration, videoDone: true });
      return state(db);
    },
    godPassQuiz(db, d) {
      const p = started(db, d.video);
      Object.assign(p, { watched: video(d.video).duration, videoDone: true, quizPassed: true, best: 100, tries: p.tries + 1, passedAt: Date.now() });
      return state(db);
    },
    godAnswers: () => ({ correct: CORRECT }),
    godReset(db) {
      db.progress = Object.fromEntries(VIDEOS.map((v) => [v.order, empty()]));
      db.cert = null;
      return state(db);
    },
    certificate(db) {
      if (db.cert) return { certificate: db.cert };
      if (!completion(db).done) throw new Error('Vzdelávanie ešte nie je dokončené.');
      const now = new Date();
      db.cert = {
        id: `AKT-${now.getFullYear()}-0001`, name: db.user.name, date: now.toLocaleDateString('sk-SK'),
        completed: now.toLocaleDateString('sk-SK') + ' o ' + now.toLocaleTimeString('sk-SK', { hour: '2-digit', minute: '2-digit' }),
      };
      return { certificate: db.cert };
    },
  };

  return {
    call(action, data) {
      return new Promise((resolve) => {
        setTimeout(() => {
          try {
            const db = load();
            if (!actions[action]) throw new Error('Neznáma akcia.');
            const out = actions[action](db, data || {});
            save(db);
            resolve(JSON.parse(JSON.stringify(out)));
          } catch (e) {
            resolve({ error: e.message });
          }
        }, 150);
      });
    },
    reset() {
      memory = null;
      try { localStorage.removeItem(KEY); } catch (e) { /* bez úložiska */ }
    },
  };
})();
