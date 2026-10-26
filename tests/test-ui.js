// Test stránky v ukážkovom režime (Playwright). YouTube a CDN sú nahradené falošnými skriptami.
// Spustenie: v koreni repozitára python3 -m http.server 8765 --bind 127.0.0.1, potom node tests/test-ui.js <priečinok na snímky>
const { chromium } = require('playwright');
const assert = require('assert');
const OUT = process.argv[2] || '.';
const URL = 'http://127.0.0.1:8765/index.html';

const FAKE_YT = `
window.YT = { Player: function (id, opts) {
  const self = this; let state = -1, t = opts.playerVars.start || 0; const dur = 400; let iv = null;
  const emit = (s) => { state = s; opts.events.onStateChange({ data: s }); };
  self.getPlayerState = () => state; self.getCurrentTime = () => t; self.getDuration = () => dur;
  self.getPlaybackRate = () => 1; self.setPlaybackRate = () => {}; self.setVolume = () => {};
  self.seekTo = (x) => { t = x; };
  self.playVideo = () => { emit(1); clearInterval(iv); iv = setInterval(() => { t += 0.25 * (window.__speed || 1); if (t >= dur) { t = dur; clearInterval(iv); emit(0); } }, 250); };
  self.pauseVideo = () => { clearInterval(iv); if (state === 1) emit(2); };
  self.destroy = () => clearInterval(iv);
  setTimeout(() => opts.events.onReady(), 50);
} };
setTimeout(() => window.onYouTubeIframeAPIReady(), 30);`;

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  page.on('dialog', (d) => d.accept());
  await page.route('https://www.youtube.com/iframe_api', (r) => r.fulfill({ contentType: 'text/javascript', body: FAKE_YT }));
  await page.route('https://cdnjs.cloudflare.com/**', (r) => r.fulfill({ contentType: 'text/javascript', body: '/* stub */' }));

  const cards = () => page.$$eval('#catalog .vcard h3', (els) => els.map((e) => e.textContent));
  let checks = 0;
  const ok = (c, m) => { assert.ok(c, m); checks++; };

  await page.goto(URL);
  await page.click('#demo-login button');
  await page.waitForSelector('#view-home:not([hidden])');
  ok((await page.textContent('#course-name')).includes('ukážka'), 'názov programu');
  ok(await page.$eval('#howto', (d) => d.open), 'návod otvorený pri prvej návšteve');
  const howto = await page.textContent('#howto-body');
  ok(howto.includes('8 otázok') && howto.includes('aspoň 6 správnych') && howto.includes('ľubovoľný počet krát'), 'návod: 8 otázok, 6, opakovanie');
  ok(howto.includes('podpíše ho riaditeľ školy'), 'návod: podpis riaditeľa');
  ok(!howto.includes('95'), 'návod nespomína 95 %');
  ok(howto.includes('5 ľubovoľných videí'), 'návod: 5 voliteľných');
  let list = await cards();
  ok(list.length === 10, '10 videí');
  ok(list[0] === 'Úvod do informačnej bezpečnosti', 'povinné prvé');
  ok((await page.textContent('#progress')).includes('splnené 0 z 5'), 'postup 0 z 5');
  ok((await page.$$('#catalog [data-start]')).length === 1, 'spustiť sa dá len povinné');
  ok((await page.textContent('#catalog')).includes('Odomkne sa po splnení povinného videa'), 'zamknuté voliteľné');
  await page.screenshot({ path: OUT + '/1-home.png', fullPage: true });

  // filter nálepok (ALEBO) a vyhľadávanie
  await page.click('#tags [data-tag="AI"]');
  list = await cards();
  ok(list.length === 2, 'AI → 2 videá');
  await page.click('#tags [data-tag="Chémia"]');
  list = await cards();
  ok(list.length === 3, 'AI alebo Chémia → 3 videá');
  ok((await page.textContent('#filter-info')).includes('Zobrazené: 3 z 10'), 'info o filtri');
  await page.screenshot({ path: OUT + '/2-filter.png', fullPage: true });
  await page.fill('#search', 'chemie');
  list = await cards();
  ok(list.length === 1 && list[0].includes('chémie'), 'vyhľadávanie bez diakritiky + nálepky');
  await page.click('#tags-clear');
  await page.fill('#search', 'phishing');
  list = await cards();
  ok(list.length === 1, 'vyhľadávanie v anotácii');
  await page.fill('#search', '');
  await page.click('#catalog .vcard:nth-child(2) [data-tag]');
  ok((await page.$$('#tags .tag.on')).length === 1, 'klik na nálepku v karte zapne filter');
  await page.click('#tags-clear');
  ok((await cards()).length === 10, 'zrušenie filtra');

  // povinné video: ochrana proti pretáčaniu, pozeranie, test
  await page.click('#catalog [data-start="5"]');
  await page.waitForSelector('#view-video:not([hidden])');
  ok((await page.textContent('#video-notice')).includes('Ukážkový režim'), 'ukážková poznámka');
  await page.waitForTimeout(300);
  await page.evaluate(() => { window.__speed = 200; });
  await page.click('#play');
  await page.waitForTimeout(800);
  await page.click('#play');
  ok((await page.textContent('#time')).startsWith('0:0'), 'skok dopredu sa vráti (ochrana proti pretáčaniu)');
  await page.evaluate(() => { window.__speed = 7; }); // rýchlejšie by zastavila ochrana proti pretáčaniu
  await page.click('#play');
  await page.waitForTimeout(9500);
  await page.click('#play'); // pauza → záznam
  await page.waitForSelector('#to-quiz:not([hidden])');
  ok((await page.textContent('#video-notice')).includes('dopozerané'), 'dopozerané');
  await page.click('#to-quiz');
  await page.waitForSelector('#view-quiz:not([hidden])');
  ok((await page.$$('#quiz-form fieldset')).length === 8, '8 otázok');
  ok((await page.textContent('#quiz-info')).includes('aspoň 6'), 'info o hranici');
  const answer = async (correctIdx) => {
    for (let k = 0; k < 8; k++) await page.check(`input[name="q${k}"][value="${correctIdx(k)}"]`);
    await page.click('#quiz-submit');
    await page.waitForSelector('#view-result:not([hidden])');
  };
  const C = [0, 1, 2, 3, 0, 1, 2, 3];
  await answer((k) => (k < 3 ? (C[k] + 1) % 4 : C[k])); // 5 správnych
  ok((await page.textContent('#result-box')).includes('5 z 8'), 'nesplnený 5 z 8');
  ok((await page.textContent('#result-box')).includes('aspoň 6'), 'hranica vo výsledku');
  await page.click('#result-retry');
  await page.waitForSelector('#view-quiz:not([hidden])');
  ok(!(await page.$('.question.locked')), 'žiadne zamknuté otázky');
  await answer((k) => (k < 2 ? (C[k] + 1) % 4 : C[k])); // 6 správnych
  ok((await page.textContent('#result-box')).includes('úspešne splnili'), 'splnený 6 z 8');
  await page.screenshot({ path: OUT + '/3-result.png' });
  await page.click('#result-next');
  await page.waitForSelector('#view-home:not([hidden])');
  ok((await page.textContent('#progress')).includes('Povinné video: splnené'), 'povinné splnené');
  ok((await page.$$('#catalog [data-start]')).length === 9, 'odomknutých 9 voliteľných');
  ok(!(await page.$eval('#howto', (d) => d.open)), 'návod zbalený po začatí');

  // rozpracované video a zanechanie
  await page.click('#catalog [data-start="1"]');
  await page.waitForSelector('#view-video:not([hidden])');
  await page.waitForTimeout(300);
  await page.evaluate(() => { window.__speed = 7; });
  await page.click('#play');
  await page.waitForTimeout(1500);
  await page.click('#play');
  await page.waitForTimeout(400);
  await page.click('#video-back');
  await page.waitForSelector('#view-home:not([hidden])');
  ok((await page.textContent('#current')).includes('Najnovšie online trendy detí'), 'panel rozpracovaného videa');
  ok((await page.$$('#catalog [data-start]')).length === 0, 'ďalšie video sa nedá spustiť');
  ok((await page.textContent('#catalog')).includes('Najprv dokončite alebo zanechajte'), 'poznámka o rozpracovanom');
  ok((await page.textContent('#current')).includes('Pokračovať vo videu'), 'pokračovať');
  await page.screenshot({ path: OUT + '/4-inprogress.png', fullPage: true });
  await page.click('#current [data-abandon="1"]');
  await page.waitForTimeout(400);
  ok((await page.textContent('#current')) === '', 'po zanechaní nič rozpracované');
  ok((await page.$$('#catalog [data-start]')).length === 9, 'znova sa dá spustiť');
  ok(!(await page.$('#catalog [data-abandon="5"]')), 'povinné nemá Zanechať');

  // god mode – splnenie 5 voliteľných
  for (let k = 0; k < 5; k++) await page.click('#course-name');
  await page.waitForSelector('#god-bar:not([hidden])');
  for (const o of [1, 2, 4, 6, 7]) {
    await page.click(`#catalog [data-start="${o}"]`);
    await page.waitForSelector('#view-video:not([hidden])');
    await page.click('#god-pass');
    await page.waitForSelector('#view-home:not([hidden])');
  }
  const prog = await page.textContent('#progress');
  ok(prog.includes('splnené 5 z 5') && prog.includes('Vzdelávanie máte splnené'), 'splnené 1 + 5');
  ok((await page.$$('#catalog [data-start]')).length === 4, 'ďalšie videá sa dajú pozerať aj po splnení');
  await page.screenshot({ path: OUT + '/5-complete.png', fullPage: true });
  await page.click('#open-cert');
  await page.waitForSelector('#view-cert:not([hidden])');
  const cert = await page.textContent('#certificate');
  ok(/AKT-\d{4}-0001/.test(cert), 'číslo osvedčenia AKT');
  ok(cert.includes('10 vyučovacích hodín (1 vyučovacia hodina = 45 minút)'), 'rozsah');
  ok(!cert.includes('Úvod do informačnej'), 'bez zoznamu videí');
  await page.screenshot({ path: OUT + '/6-cert.png' });
  await page.click('#cert-back');

  // ďalšie video navyše
  await page.click('#catalog [data-start="8"]');
  await page.waitForSelector('#view-video:not([hidden])');
  await page.click('#god-pass');
  await page.waitForSelector('#view-home:not([hidden])');
  ok((await page.textContent('#progress')).includes('(navyše 1)'), 'video navyše');

  // opakované pozretie
  await page.click('#catalog [data-review="5"]');
  await page.waitForSelector('#view-video:not([hidden])');
  ok((await page.textContent('#video-title')).includes('opakované'), 'opakované pozretie');
  ok(await page.isVisible('#fwd30'), 'pretáčanie v opakovanom pozretí');
  await page.click('#video-back');

  // mobil
  await page.setViewportSize({ width: 390, height: 800 });
  await page.waitForTimeout(200);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  ok(!overflow, 'bez vodorovného posúvania na mobile');
  await page.screenshot({ path: OUT + '/7-mobile.png', fullPage: true });

  ok(errors.length === 0, 'bez chýb v konzole: ' + errors.join(' | '));
  console.log(`OK – ${checks} kontrol prešlo`);
  await browser.close();
})().catch((e) => { console.error('ZLYHANIE:', e.message); process.exit(1); });
