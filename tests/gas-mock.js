// Jednoduchá simulácia Google Apps Script služieb pre testovanie Code.gs v Node (vm).
const fs = require('fs');
const vm = require('vm');

function makeEnv(codePath) {
  const code = fs.readFileSync(codePath, 'utf8');
  const sheets = {};
  const cache = {};
  let clock = Date.parse('2026-11-02T08:00:00Z');
  const RealDate = Date;
  class FakeDate extends RealDate {
    constructor(...a) { if (a.length) super(...a); else super(clock); }
    static now() { return clock; }
  }

  function makeSheet(name) {
    const sh = {
      name, data: [],
      width() { return this.data.reduce((m, r) => Math.max(m, r.length), 0); },
      getDataRange() {
        const w = Math.max(1, this.width());
        const rows = this.data.length ? this.data : [[]];
        return { getValues: () => rows.map(r => { const c = r.slice(); while (c.length < w) c.push(''); return c; }) };
      },
      getRange(r, c, nr, nc) {
        const self = this;
        if (typeof r === 'string') return { setNumberFormat() { return this; } };
        nr = nr || 1; nc = nc || 1;
        return {
          setValues(vals) {
            for (let i = 0; i < nr; i++) {
              while (self.data.length < r + i) self.data.push([]);
              const row = self.data[r + i - 1];
              for (let j = 0; j < nc; j++) {
                while (row.length < c + j) row.push('');
                row[c + j - 1] = vals[i][j];
              }
            }
            return this;
          },
          setValue(v) { return this.setValues([[v]]); },
          getValue() { const row = self.data[r - 1] || []; return row[c - 1] === undefined ? '' : row[c - 1]; },
          setFontWeight() { return this; },
          setNumberFormat() { return this; },
        };
      },
      appendRow(v) { this.data.push(v.slice()); },
      getLastRow() { return this.data.length; },
      deleteRow(n) { this.data.splice(n - 1, 1); },
      setFrozenRows() {},
    };
    return sh;
  }

  const ss = {
    getSheetByName: (n) => sheets[n] || null,
    insertSheet: (n) => (sheets[n] = makeSheet(n)),
    getSpreadsheetTimeZone: () => 'Europe/Bratislava',
  };
  const pad = (n) => String(n).padStart(2, '0');
  const ctxBase = {
    SpreadsheetApp: { getActive: () => ss },
    CacheService: { getScriptCache: () => ({ get: (k) => (k in cache ? cache[k] : null), put: (k, v) => { cache[k] = v; } }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    Utilities: {
      getUuid: () => 'u' + Math.random().toString(36).slice(2),
      formatDate: (d, tz, f) => {
        if (f === 'd. M. yyyy') return `${d.getUTCDate()}. ${d.getUTCMonth() + 1}. ${d.getUTCFullYear()}`;
        return `${d.getUTCDate()}. ${d.getUTCMonth() + 1}. ${d.getUTCFullYear()} o ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
      },
    },
    Session: { getScriptTimeZone: () => 'Europe/Bratislava' },
    UrlFetchApp: {
      fetch: (url) => {
        const tok = decodeURIComponent(url.split('id_token=')[1]);
        let t; try { t = JSON.parse(tok); } catch (e) { return { getResponseCode: () => 400, getContentText: () => '' }; }
        return { getResponseCode: () => 200, getContentText: () => JSON.stringify(t) };
      },
    },
    ContentService: {
      MimeType: { JSON: 'json' },
      createTextOutput: (s) => ({ text: s, setMimeType() { return this; } }),
    },
    console,
  };

  function run(fnName, ...args) {
    const ctx = vm.createContext(Object.assign({ Date: FakeDate, Math, JSON, Number, String, Object, Array, Error }, ctxBase));
    vm.runInContext(code + `\n;globalThis.__out = ${fnName}(...globalThis.__args);`, Object.assign(ctx, { __args: args }));
    return ctx.__out;
  }

  function post(req) {
    const out = run('doPost', { postData: { contents: JSON.stringify(req) } });
    return JSON.parse(out.text);
  }

  return {
    sheets, cache, ss, run, post, makeSheet,
    advance(sec) { clock += sec * 1000; cacheExpire(); },
    clearCache() { for (const k of Object.keys(cache)) if (k.indexOf('rows_') === 0) delete cache[k]; },
    now: () => clock,
  };
  function cacheExpire() { /* cache videí/otázok mažeme ručne cez clearCache */ }
}

module.exports = { makeEnv };
