# Aktualizačné vzdelávanie učiteľov – webová aplikácia

Ročné aktualizačné vzdelávanie pre učiteľov ZŠ Štefana Koháriho II. s VJM. Učiteľ sa prihlási školským Google účtom (@koharysuli.sk), pozrie povinné video, potom si z katalógu vyberie ďalšie videá. Po každom videu nasleduje test a po splnení všetkých podmienok si stiahne osvedčenie.

## Pravidlá vzdelávania

- **Povinné video:** ostatné videá sa odomknú až po splnení jeho testu.
- **Voliteľné videá:** učiteľ si vyberie 5 ľubovoľných videí v ľubovoľnom poradí.
- **Katalóg:** pri každom videu je názov, dĺžka, anotácia, nálepky a stav (nezačaté, rozpracované, splnené). Videá sa dajú hľadať v názve a anotácii a filtrovať kliknutím na nálepky. Pri viacerých zapnutých nálepkách sa zobrazia videá s aspoň jednou z nich.
- **Rozpracované video:** naraz môže byť rozpracované len jedno video, od spustenia po splnenie testu. Tlačidlo **Zanechať video** vynuluje pozretý čas aj pokusy a video sa vráti medzi nezačaté. Povinné video sa zanechať nedá.
- **Test:** 8 otázok, na splnenie treba 6 (75 %). Test nemá časový limit a dá sa opakovať ľubovoľný počet krát. Správne odpovede sa nezobrazujú a prehliadač ich nikdy nedostane.
- **Prehrávač:**
  - video sa nedá pretáčať dopredu ani zrýchliť,
  - pri odchode z okna sa pozastaví,
  - za dopozerané sa ráta pri 95 % dĺžky,
  - splnené video si učiteľ môže pozrieť znova a voľne pretáčať.
- **Osvedčenie:** vydá sa po splnení povinného videa a 5 voliteľných. Obsahuje:
  - rozsah 10 vyučovacích hodín,
  - dátum a čas ukončenia,
  - číslo v tvare `AKT-RRRR-NNNN`,
  - bez zoznamu videí a bez podpisu (podpisuje ho riaditeľ školy).

  Osvedčenie si učiteľ môže stiahnuť kedykoľvek, aj po vypnutí vzdelávania. Videá navyše učiteľ môže pozerať ďalej, kým je vzdelávanie otvorené, do osvedčenia sa však nerátajú.
- **Čas:** vzdelávanie sa zapína a vypína ručne v hárku **Nastavenia**. Nemá denný ani časový limit.
- **Administrátori** (`ADMINS` v `Code.gs`) môžu aplikáciu používať aj pri vypnutom vzdelávaní a zapnúť testovací režim.

Ochrana na serveri: server zaznamenáva pozretý čas podľa reálne uplynutého času. Video sa preto nedá „dopozerať“ rýchlejšie, ani keď niekto obíde prehrávač.

## Ako to funguje

| Časť | Kde beží | Súbory |
|---|---|---|
| Webová stránka | GitHub Pages (zadarmo) | `index.html`, `app.js`, `style.css`, `config.js`, `demo-api.js` |
| Server a údaje | Google Apps Script + Google tabuľka | `apps-script/Code.gs` |
| Videá | YouTube („Nezverejnené“, s povoleným vkladaním) | – |
| Testy | Node + Playwright (spúšťa Claude pred nahratím) | `tests/` |
| Pravidlá tvorby obsahu | – | `docs/tvorba-obsahu.md` |

Kým nie je vyplnené `API_URL` v `config.js`, aplikácia beží v **ukážkovom režime**. Dá sa vyskúšať bez Google prihlásenia. Video sa v ňom ráta ako dopozerané po 1 minúte a v teste je správna odpoveď označená.

## Hárky tabuľky

| Hárok | Obsah |
|---|---|
| **Videa** | Poradie, Názov, YouTube ID, Dĺžka (sekundy), Anotácia, Nálepky (oddelené čiarkou). Riadok bez YouTube ID alebo bez dĺžky aplikácia preskočí. |
| **Otazky** | Video (číslo z hárku Videa), Otázka, A, B, C, D, Správna (A–D) |
| **Priebeh** | jeden riadok na učiteľa a video: pozretý čas, pokusy, najlepšie skóre, splnenie, čas spustenia, počet zanechaní. Riadky sa nemažú. |
| **Osvedcenia** | vydané osvedčenia s číslami |
| **Ucastnici** | čas prvého prihlásenia učiteľa (len evidencia) |
| **Nastavenia** | pravidlá vzdelávania, pozri nižšie |

Otázky a priebeh sú naviazané na **číslo v stĺpci Poradie**, nie na poradie riadkov. Čísla videí sa preto nemajú meniť. Zmeny v hárkoch Videa a Otazky sa v aplikácii prejavia do 1 minúty.

### Nastavenia

| Nastavenie | Príklad | Význam |
|---|---|---|
| Vzdelávanie aktívne | `1` / `0` | Pri `0` učitelia vidia návod a katalóg, ale nespustia videá ani testy. Administrátor môže testovať. |
| Názov programu | | Zobrazí sa v hlavičke a na osvedčení. |
| Povinné video (číslo z hárku Videa) | `5` | Číslo zo stĺpca Poradie. Prázdne = žiadne povinné video. |
| Počet voliteľných videí | `5` | Koľko voliteľných videí treba na osvedčenie. |
| Hranica úspešnosti (%) | `75` | Pri 8 otázkach treba 6 správnych. |
| Rozsah vzdelávania (text na osvedčení) | `10 vyučovacích hodín (1 vyučovacia hodina = 45 minút)` | Na osvedčení: „Vzdelávanie v rozsahu …“ |
| Predpona čísla osvedčenia | `AKT` | Číslo osvedčenia: `AKT-2026-0001` |
| Otvorené do (text pre učiteľov) | `30. 11. 2026` | Nepovinné. Zobrazí sa učiteľom v upozornení a v návode. |

Pre ďalší rok stačí nová tabuľka s rovnakými hárkami, nové Nastavenia a nové nasadenie skriptu z novej tabuľky.

---

## Nasadenie krok za krokom

### 1. Google tabuľka a Apps Script
1. Tabuľka už existuje (vytvorená školským účtom) a hárky **Videa** a **Otazky** sú vyplnené.
2. V tabuľke otvorte **Rozšírenia → Apps Script**.
3. Obsah súboru `Code.gs` nahraďte celým obsahom `apps-script/Code.gs` z tohto repozitára a uložte.
4. **Nastavenia projektu** (ikona ozubeného kolesa vľavo) → **Časové pásmo**: `(GMT+01:00) Central European Time – Bratislava` (alebo Praha).
5. Hore vyberte funkciu **setup** a kliknite **Spustiť**. Povoľte požadované oprávnenia.
   Funkcia vytvorí chýbajúce hárky (Priebeh, Osvedcenia, Ucastnici, Nastavenia). Existujúce hárky nemení.
6. V hárku **Nastavenia** vyplňte názov programu a povinné video. Hodnotu `Vzdelávanie aktívne` nechajte na `0` až do spustenia.

### 2. Google prihlásenie (Client ID)
Použije sa rovnaký Client ID ako pri súčasnej aplikácii, stačí doplniť novú adresu:
1. Otvorte https://console.cloud.google.com/ (školským účtom) a vyberte projekt súčasnej aplikácie.
2. **APIs & Services → Credentials** → kliknite na existujúci **OAuth client ID** (typ Web application).
3. Do **Authorized JavaScript origins** pridajte `https://zsmladeznicka-stack.github.io`, ak tam ešte nie je. Neskôr pridáte aj vlastnú adresu (krok 5).
4. Uložte. Client ID je už vyplnený v `Code.gs` aj v `config.js`.

### 3. Zverejnenie servera (Apps Script)
1. V Apps Scripte kliknite **Nasadiť → Nové nasadenie → typ: Webová aplikácia**.
   - Spustiť ako: **Ja**
   - Kto má prístup: **Ktokoľvek**. Overenie školského účtu robí samotný skript.
2. Skopírujte URL webovej aplikácie (končí na `/exec`). Do `API_URL` v `config.js` ju vloží Claude.

> **Po každej zmene `Code.gs`:** Nasadiť → Spravovať nasadenia → upraviť (ceruzka) → **Verzia: Nová verzia** → Nasadiť. URL zostane rovnaká. Zmeny v tabuľke (videá, otázky, nastavenia) nové nasadenie nepotrebujú.

### 4. Zverejnenie stránky na GitHub Pages
1. Repozitár: https://github.com/zsmladeznicka-stack/aktualizacne_vzdelavanie
2. **Settings → Pages → Source: Deploy from a branch → main / (root) → Save**.
3. Po pár minútach bude stránka na https://zsmladeznicka-stack.github.io/aktualizacne_vzdelavanie/

### 5. Vlastná adresa (napr. https://aktualizacne.koharysuli.sk)
- **DNS (Websupport, hlavný zákaznícky účet školy, nie správa schránok):** záznam `CNAME`, názov napr. `aktualizacne`, cieľ `zsmladeznicka-stack.github.io`.
- **Repozitár:** súbor `CNAME` s adresou (pridá Claude).
- **GitHub:** Settings → Pages → Custom domain, zapnúť **Enforce HTTPS**.
- **Google Cloud Console:** do Authorized JavaScript origins pridať novú adresu.

### 6. Pilot a spustenie
1. Vyskúšajte aplikáciu ako administrátor pri `Vzdelávanie aktívne` = `0`.
2. Pilot s 2–3 kolegami (hodnota `1` na krátky čas).
3. Spustenie pre celý zbor: hodnota `1`. Po skončení vzdelávania hodnota `0`.

Ak máte v prehliadači prihlásených viac Google účtov a Apps Script editor sa neotvorí, použite anonymné okno alebo `/u/1/` v adrese.

---

## Testovací režim (god mode)

Administrátor ho zapne 5 kliknutiami na názov programu v hlavičke do 3 sekúnd. Ponúka tieto tlačidlá:
- **Preskočiť video:** rozpracované video sa ráta ako dopozerané.
- **Splniť test:** test rozpracovaného videa sa ráta ako splnený.
- **Vynulovať môj priebeh:** zmaže vlastný priebeh aj osvedčenie.

V teste sú v tomto režime označené správne odpovede.

## Časté otázky

**Dá sa test opakovať?** Áno, neobmedzene. Do tabuľky sa zapisuje počet pokusov aj najlepšie skóre.

**Čo ak učiteľ zavrie prehliadač uprostred videa?** Pri ďalšom prihlásení pokračuje od miesta, kde skončil (s presnosťou na približne 20 sekúnd).

**Čo urobí Zanechať video?** Vynuluje pozretý čas a pokusy v teste. V hárku Priebeh sa zvýši počet zanechaní. Video si učiteľ môže vybrať znova a začne od začiatku.

**Ako overím pravosť osvedčenia?** Číslo osvedčenia je v hárku **Osvedcenia** spolu s menom a dátumom.

**Ako vynulujem priebeh učiteľa?** V hárku **Priebeh** jeho riadky **nemažte** (server zapisuje podľa čísla riadku). Vymažte v nich obsah buniek od stĺpca Pozreté ďalej, prípadne celý obsah riadku. Ak treba, zmažte jeho riadok v hárku **Osvedcenia**.

**Hláška „Server odpovedal nečakane“ počas videa?** Zvyčajne ide o jeden neúspešný záznam počas nasadzovania novej verzie skriptu. Aplikácia ho potichu zopakuje a varovanie ukáže až po troch chybách za sebou. Pozretý čas sa nestratí.

**Hranice ochrany:** obmedzenia v prehliadači zastavia bežného používateľa. Minimalizácii okna sa zabrániť nedá, video sa iba pozastaví. Technicky zdatný človek by však mohol nechať video bežať napríklad stlmené na druhej obrazovke.
