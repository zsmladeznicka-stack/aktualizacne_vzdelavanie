// Testy servera Code.gs na simulovanej tabuľke. Spustenie: node tests/test-server.js apps-script/Code.gs
const assert = require('assert');
const { makeEnv } = require('./gas-mock');
const env = makeEnv(process.argv[2]);
let passed = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); passed++; };
const eq = (a, b, msg) => { assert.deepStrictEqual(a, b, msg); passed++; };

// --- tabuľka ako po zápise obsahu: Videa a Otazky existujú ---
const V = env.ss.insertSheet('Videa');
V.data = [['Poradie', 'Názov', 'YouTube ID', 'Dĺžka (sekundy)', 'Anotácia', 'Nálepky'],
  [1, 'Trendy', 'aaa', 600, 'Anotácia 1', 'Online svet detí, Prevencia'],
  [2, 'Prompty', 'bbb', 600, 'Anotácia 2', 'AI, AI ,Tvorba materiálov,'],
  [4, 'Chémia', 'ccc', 600, '', 'Chémia'],
  [5, 'Bezpečnosť', 'ddd', 600, '', 'Kyberbezpečnosť'],
  [6, 'Bez dĺžky', 'eee', '', '', ''],
  [7, 'Bez ID', '', 600, '', ''],
  [8, 'Bez otázok', 'fff', 600, '', '']];
const Q = env.ss.insertSheet('Otazky');
Q.data = [['Video', 'Otázka', 'A', 'B', 'C', 'D', 'Správna (A–D)']];
[1, 2, 4, 5].forEach(v => { for (let k = 0; k < 8; k++) Q.data.push([v, `Otázka ${k} k ${v}`, 'a', 'b', 'c', 'd', 'ABCD'[k % 4]]); });
const CORRECT = [0, 1, 2, 3, 0, 1, 2, 3];

env.run('setup');
ok(env.sheets.Priebeh && env.sheets.Nastavenia && env.sheets.Osvedcenia && env.sheets.Ucastnici, 'setup vytvorí hárky');
eq(env.sheets.Videa.data.length, 8, 'setup nezmení existujúce Videa');
const S = env.sheets.Nastavenia;
const setS = (name, val) => { const r = S.data.find(x => String(x[0]).indexOf(name) === 0); r[1] = val; };
eq(S.data.find(r => r[0] === 'Vzdelávanie aktívne')[1], 0, 'predvolene vypnuté');

const tok = (email, name) => JSON.stringify({ aud: '360446448624-q4u3huhlgho4ce4taptuofp0e4dveujp.apps.googleusercontent.com', hd: 'koharysuli.sk', email_verified: 'true', email, name });
const login = (email, name) => env.post({ action: 'login', idToken: tok(email, name) });

// --- prihlásenie ---
eq(env.post({ action: 'login', idToken: JSON.stringify({ aud: 'x' }) }).error, 'Prihlásenie nepatrí tejto aplikácii.', 'cudzí client');
eq(env.post({ action: 'login', idToken: JSON.stringify({ aud: '360446448624-q4u3huhlgho4ce4taptuofp0e4dveujp.apps.googleusercontent.com', hd: 'gmail.com', email_verified: 'true', email: 'a@gmail.com' }) }).error,
  'Prihláste sa školským účtom @koharysuli.sk.', 'iná doména');
let t1 = login('Ucitel1@koharysuli.sk', 'Učiteľ Jeden');
const s1 = t1.session;
ok(s1, 'session');
eq(t1.active, false, 'neaktívne');
eq(t1.canStart, false, 'učiteľ nemôže pri vypnutom');
eq(env.sheets.Ucastnici.data.length, 1, 'pri vypnutom sa učiteľ neeviduje');
eq(t1.videos.map(v => v.order), [1, 2, 4, 5], 'skryté videá bez ID, dĺžky alebo otázok');
eq(t1.videos[1].tags, ['AI', 'Tvorba materiálov'], 'nálepky bez duplicít a prázdnych');
eq(t1.videos[0].questions, 8, 'počet otázok');
eq(t1.videos[0].needed, 6, '6 z 8 pri 75 %');
ok(!('correct' in t1.videos[0]), 'bez správnych odpovedí');
eq(t1.course, '', 'názov programu prázdny');
eq(t1.mandatory, null, 'povinné nenastavené');
eq(t1.mandatoryNote, '', 'poznámka len pre admina');
eq(env.post({ action: 'start', session: s1, video: 1 }).error, 'INACTIVE', 'vypnuté – start');
eq(env.post({ action: 'heartbeat', session: s1, video: 1, position: 5 }).error, 'INACTIVE', 'vypnuté – heartbeat');

const a = login('fazekas.csaba@koharysuli.sk', 'Admin');
eq(a.canStart, true, 'admin môže aj pri vypnutom');
eq(a.mandatoryNote, 'V hárku Nastavenia nie je vyplnené povinné video.', 'admin vidí poznámku');
setS('Povinné video', 9);
eq(env.post({ action: 'state', session: a.session }).mandatoryNote.indexOf('„9“') > 0, true, 'neexistujúce povinné video');

// --- zapnutie, povinné video 5, 2 voliteľné ---
setS('Vzdelávanie aktívne', 1);
setS('Povinné video', 5);
setS('Počet voliteľných videí', 2);
setS('Názov programu', 'Testovací program');
t1 = env.post({ action: 'state', session: s1 });
eq(t1.active, true, 'aktívne');
eq(t1.mandatory, 5, 'povinné 5');
eq(t1.videos.find(v => v.order === 5).mandatory, true, 'príznak povinného');
eq(t1.optionalRequired, 2, 'počet voliteľných');
eq(env.post({ action: 'heartbeat', session: s1, video: 5, position: 5 }).error, 'Video nie je spustené. Spustite ho v katalógu.', 'heartbeat bez spustenia');
eq(env.post({ action: 'start', session: s1, video: 1 }).error, 'Najprv splňte povinné video a test k nemu.', 'voliteľné pred povinným');
eq(env.post({ action: 'start', session: s1, video: 99 }).error, 'Neznáme video.', 'neznáme video');
eq(env.post({ action: 'start', session: s1, video: 6 }).error, 'Neznáme video.', 'skryté video');
eq(env.post({ action: 'start', session: s1, video: 8 }).error, 'Neznáme video.', 'video bez otázok sa nedá spustiť');
let st = env.post({ action: 'start', session: s1, video: 5 });
eq(st.inProgress, 5, 'rozpracované 5');
eq(env.sheets.Priebeh.data.length, 2, 'jeden riadok priebehu');
eq(env.post({ action: 'start', session: s1, video: 5 }).inProgress, 5, 'opakovaný start nevytvorí riadok');
eq(env.sheets.Priebeh.data.length, 2, 'stále jeden riadok');
eq(env.post({ action: 'abandon', session: s1, video: 5 }).error, 'Povinné video sa nedá zanechať.', 'povinné nezanechať');
eq(env.post({ action: 'quiz', session: s1, video: 5 }).error, 'Najprv dopozerajte video.', 'test pred dopozeraním');

// --- heartbeat: obmedzenie rýchlosti ---
let hb = env.post({ action: 'heartbeat', session: s1, video: 5, position: 590 });
eq(hb.watched, 16, 'prvý záznam max 10*1,1+5 s');
env.advance(20);
hb = env.post({ action: 'heartbeat', session: s1, video: 5, position: 590 });
eq(hb.watched, 16 + 27, 'po 20 s max +27 s');
for (let k = 0; k < 30 && !hb.videoDone; k++) { env.advance(20); hb = env.post({ action: 'heartbeat', session: s1, video: 5, position: 600 }); }
eq(hb.videoDone, true, 'dopozerané');
ok(hb.watched >= 570, 'aspoň 95 %');
const row = env.sheets.Priebeh.data[1];
eq(row.length >= 7, true, 'heartbeat zapisuje do stĺpcov');

// --- test ---
let qz = env.post({ action: 'quiz', session: s1, video: 5 });
eq(qz.questions.length, 8, '8 otázok');
eq(qz.needed, 6, 'needed v teste');
ok(qz.questions.every(q => !('correct' in q)), 'otázky bez správnych odpovedí');
let ans = CORRECT.slice(); ans[0] = 3; ans[1] = 3; ans[2] = 3; // 5 správnych
let sb = env.post({ action: 'submit', session: s1, video: 5, answers: ans });
eq([sb.correct, sb.passed, sb.score], [5, false, 63], '5 z 8 nestačí');
eq(env.post({ action: 'submit', session: s1, video: 5, answers: CORRECT }).error, 'Test nebol spustený.', 'odovzdanie bez spustenia');
for (let k = 0; k < 3; k++) { env.post({ action: 'quiz', session: s1, video: 5 }); env.post({ action: 'submit', session: s1, video: 5, answers: ans }); }
env.post({ action: 'quiz', session: s1, video: 5 });
ans = CORRECT.slice(); ans[0] = 3; ans[1] = 3;
sb = env.post({ action: 'submit', session: s1, video: 5, answers: ans });
eq([sb.correct, sb.passed, sb.complete], [6, true, false], '6 z 8 stačí, opakovanie neobmedzené');
st = env.post({ action: 'state', session: s1 });
eq(st.inProgress, null, 'po splnení nič rozpracované');
eq(st.videos.find(v => v.order === 5).tries, 5, 'pokusy');
eq(env.post({ action: 'quiz', session: s1, video: 5 }).error, 'Tento test už máte splnený.', 'splnený test');
eq(env.post({ action: 'start', session: s1, video: 5 }).error, 'Toto video už máte splnené. Môžete si ho pozrieť znova.', 'splnené video');

// --- jedno rozpracované a zanechanie ---
st = env.post({ action: 'start', session: s1, video: 1 });
eq(st.inProgress, 1, 'rozpracované 1');
eq(env.post({ action: 'start', session: s1, video: 2 }).error, 'Najprv dokončite alebo zanechajte rozpracované video „Trendy“.', 'len jedno rozpracované');
env.advance(20); env.post({ action: 'heartbeat', session: s1, video: 1, position: 30 });
st = env.post({ action: 'abandon', session: s1, video: 1 });
eq(st.inProgress, null, 'po zanechaní nič rozpracované');
const v1 = st.videos.find(v => v.order === 1);
eq([v1.started, v1.watched, v1.tries, v1.videoDone], [false, 0, 0, false], 'zanechané = nezačaté');
const r1 = env.sheets.Priebeh.data.find(r => r[2] === 1);
eq([r1[3], r1[12], r1[13]], [0, '', 1], 'v tabuľke vynulované, zanechané 1×');
eq(env.post({ action: 'heartbeat', session: s1, video: 1, position: 60 }).error, 'Video nie je spustené. Spustite ho v katalógu.', 'heartbeat po zanechaní');
eq(env.post({ action: 'abandon', session: s1, video: 1 }).error, 'Video nie je spustené. Spustite ho v katalógu.', 'zanechanie nezačatého');
const rowsBefore = env.sheets.Priebeh.data.length;
st = env.post({ action: 'start', session: s1, video: 1 });
eq(env.sheets.Priebeh.data.length, rowsBefore, 'opätovné spustenie použije ten istý riadok');
eq(env.sheets.Priebeh.data.find(r => r[2] === 1)[13], 1, 'počet zanechaní zostane');
eq(st.videos.find(v => v.order === 1).watched, 0, 'začína od začiatku');

const passVideo = (sess, order) => {
  for (let k = 0; k < 40; k++) {
    env.advance(20);
    if (env.post({ action: 'heartbeat', session: sess, video: order, position: 600 }).videoDone) break;
  }
  env.post({ action: 'quiz', session: sess, video: order });
  return env.post({ action: 'submit', session: sess, video: order, answers: CORRECT });
};
sb = passVideo(s1, 1);
eq([sb.passed, sb.complete], [true, false], '1 voliteľné');
eq(env.post({ action: 'certificate', session: s1 }).error, 'Vzdelávanie ešte nie je dokončené.', 'osvedčenie pred dokončením');
env.post({ action: 'start', session: s1, video: 4 });
env.advance(3600);
sb = passVideo(s1, 4);
eq([sb.passed, sb.complete], [true, true], 'povinné + 2 voliteľné = hotovo');
const completedAt = env.sheets.Priebeh.data.find(r => r[2] === 4)[11];
st = env.post({ action: 'state', session: s1 });
eq([st.complete, st.optionalPassed], [true, 2], 'stav dokončenia');
let c1 = env.post({ action: 'certificate', session: s1 });
const year = new Date(env.now()).getUTCFullYear();
eq(c1.certificate.id, `AKT-${year}-0001`, 'číslo osvedčenia');
eq(env.sheets.Osvedcenia.data[1][4].getTime(), completedAt.getTime(), 'čas ukončenia = splnenie posledného potrebného testu');
// ďalšie video po dokončení – nemení osvedčenie
env.advance(3600);
env.post({ action: 'start', session: s1, video: 2 });
passVideo(s1, 2);
st = env.post({ action: 'state', session: s1 });
eq(st.optionalPassed, 3, 'tri voliteľné');
eq(env.post({ action: 'certificate', session: s1 }).certificate.id, `AKT-${year}-0001`, 'osvedčenie sa nemení');
eq(env.sheets.Osvedcenia.data.length, 2, 'jedno osvedčenie');
const firstCompleted = env.sheets.Osvedcenia.data[1][4];
eq(firstCompleted.getTime(), completedAt.getTime(), 'čas ukončenia sa nemení');

// druhý učiteľ – číslovanie, predpona z Nastavení
const t2 = login('ucitel2@koharysuli.sk', 'Učiteľ Dva');
eq(env.sheets.Ucastnici.data.length, 3, 'evidencia pri aktívnom (učiteľ 1 cez state sa neeviduje, admin + učiteľ 2 áno)');
['start'].forEach(() => env.post({ action: 'start', session: t2.session, video: 5 }));
passVideo(t2.session, 5); env.post({ action: 'start', session: t2.session, video: 2 }); passVideo(t2.session, 2);
env.post({ action: 'start', session: t2.session, video: 4 }); passVideo(t2.session, 4);
eq(env.post({ action: 'certificate', session: t2.session }).certificate.id, `AKT-${year}-0002`, 'druhé číslo');

// hranica úspešnosti ako 0,75 a „75 %“
setS('Hranica úspešnosti', 0.75);
eq(env.post({ action: 'state', session: s1 }).videos[0].needed, 6, '0,75 = 75 %');
setS('Hranica úspešnosti', '75 %');
eq(env.post({ action: 'state', session: s1 }).videos[0].needed, 6, '„75 %“');
setS('Hranica úspešnosti', 80);
eq(env.post({ action: 'state', session: s1 }).videos[0].needed, 7, '80 % z 8 = 7');
setS('Hranica úspešnosti', 75);

// vypnutie – osvedčenie ostáva dostupné
setS('Vzdelávanie aktívne', 0);
eq(env.post({ action: 'certificate', session: s1 }).certificate.id, `AKT-${year}-0001`, 'osvedčenie aj po vypnutí');
eq(env.post({ action: 'start', session: s1, video: 4 }).error, 'INACTIVE', 'po vypnutí nič nové');
eq(env.post({ action: 'state', session: s1 }).canStart, false, 'canStart po vypnutí');

// god mode
eq(env.post({ action: 'godmode', session: s1 }).error, 'Nemáte oprávnenie.', 'učiteľ nemá god mode');
const as = a.session;
eq(env.post({ action: 'godmode', session: as }).ok, true, 'admin god mode');
eq(env.post({ action: 'godSkipVideo', session: as, video: 5 }).error, 'Video nie je spustené. Spustite ho v katalógu.', 'god skip len rozpracované');
env.post({ action: 'start', session: as, video: 5 });
st = env.post({ action: 'godSkipVideo', session: as, video: 5 });
eq(st.videos.find(v => v.order === 5).videoDone, true, 'god skip');
eq(env.post({ action: 'godAnswers', session: as, video: 5 }).correct, CORRECT, 'god answers');
st = env.post({ action: 'godPassQuiz', session: as, video: 5 });
eq(st.videos.find(v => v.order === 5).quizPassed, true, 'god pass');
env.post({ action: 'start', session: as, video: 1 }); env.post({ action: 'godPassQuiz', session: as, video: 1 });
env.post({ action: 'start', session: as, video: 2 }); env.post({ action: 'godPassQuiz', session: as, video: 2 });
eq(env.post({ action: 'certificate', session: as }).certificate.id, `AKT-${year}-0003`, 'admin osvedčenie');
const prog = env.sheets.Priebeh.data.length;
st = env.post({ action: 'godReset', session: as });
eq(env.sheets.Priebeh.data.length, prog, 'god reset nemaže riadky priebehu');
eq([st.inProgress, st.certificate, st.optionalPassed], [null, null, 0], 'god reset vynuluje');
ok(st.videos.every(v => !v.started && !v.quizPassed), 'všetko nezačaté');
eq(env.sheets.Osvedcenia.data.length, 3, 'osvedčenie admina zmazané');

// neplatná session
eq(env.post({ action: 'state', session: 'xxx' }).error, 'SESSION_EXPIRED', 'expirovaná session');

// bez povinného videa: stačí 2 ľubovoľné
setS('Vzdelávanie aktívne', 1); setS('Povinné video', '');
const t3 = login('ucitel3@koharysuli.sk', 'Učiteľ Tri');
env.post({ action: 'start', session: t3.session, video: 1 }); passVideo(t3.session, 1);
env.post({ action: 'start', session: t3.session, video: 2 }); sb = passVideo(t3.session, 2);
eq(sb.complete, true, 'bez povinného stačia voliteľné');

console.log(`OK – ${passed} kontrol prešlo`);
