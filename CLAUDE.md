# Pokyny pre Claude

Aplikácia na ročné aktualizačné vzdelávanie učiteľov ZŠ Štefana Koháriho II. s VJM (doména koharysuli.sk). Pravidlá a nasadenie sú v `README.md`, pravidlá tvorby obsahu (anotácie, testy, nálepky, analýza prepisov) v `docs/tvorba-obsahu.md`.

## Spolupráca

- Komunikuj po slovensky, stručne a vecne. Používateľ (administrátor) je fazekas.csaba@koharysuli.sk. Google tabuľku a Apps Script edituje sám a kód vkladá ručne.
- Keď sa používateľ pýta „len otázku“, neimplementuj. Odpovedz a navrhni.
- Pri väčších rozhodnutiach daj odporúčanie a krátke možnosti.
- **Na konci každej zmeny napíš, či treba znova nasadiť Apps Script.** Postup: Nasadiť → Spravovať nasadenia → ceruzka → Verzia: Nová verzia → Nasadiť. Pri väčšej zmene nech používateľ vloží celý `apps-script/Code.gs`, pri malej mu napíš, ktorý riadok prepísať.
- Súčasnú aplikáciu `zsmladeznicka-stack/it_vzdelavanie` ani jej tabuľku nemeň.
- Odkaz na tabuľku nie je v repozitári (repozitár je verejný, tabuľka obsahuje správne odpovede). Vypýtaj si ho.
- Do commitov ani súborov nedávaj identifikátor modelu.

## Texty v aplikácii

- Krátke a vecné, bez zbytočných viet.
- Nespomínať percentá pozretia (95 %).
- Upozornenia (vzdelávanie zapnuté alebo vypnuté) majú byť výrazné. Admin banner sa odlišuje farbou.

## Technické zásady

- Pred nahratím otestuj:
  - server: `node tests/test-server.js apps-script/Code.gs`,
  - stránku: spusti `python3 -m http.server 8765 --bind 127.0.0.1` v koreni repozitára, potom `node tests/test-ui.js <priečinok na snímky>`.

  Chromium a Playwright sú predinštalované. YouTube a CDN sa v teste nahrádzajú falošnými skriptami.
- Pri zmene logiky servera uprav rovnako aj `demo-api.js` (ukážkový režim).
- Videá a otázky sú naviazané na číslo v stĺpci **Poradie**.
- Riadky v hárku **Priebeh** sa nemažú. Heartbeat beží bez globálneho zámku a zapisuje iba stĺpce Pozreté, Dĺžka, Video dopozerané a Posledný záznam podľa čísla riadku. Riadok vytvára spustenie videa (so zámkom).
- Titulky YouTube sa vo vloženom prehrávači nedajú spoľahlivo vypnúť. Používateľ rozhodol, že to neriešime.
- GitHub Pages môže mať pár minút oneskorenie a prehliadač cachuje asi 10 minút (pomôže Ctrl+F5).
