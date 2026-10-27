# Tvorba obsahu: anotácie, testy, nálepky

Pravidlá vyladené s administrátorom. Platia pre každé nové video.

## Postup pri každej dávke videí

1. Používateľ nahrá video na YouTube („Nezverejnené“, s povoleným vkladaním) a pošle:
   - **YouTube ID**,
   - **presnú dĺžku z YouTube Studia**,
   - **titulky** (.sbv alebo .srt).
2. Claude prevedie titulky na čistý text s časmi a **prečíta celý prepis**.
3. Claude video zanalyzuje (pozri Analýza prepisu nižšie).
4. Claude pripraví anotáciu a 8 otázok a zapíše ich do tabuľky cez konektor Google Sheets.
5. Claude **prejde nálepky všetkých videí v katalógu**, nielen nových (pozri Nálepky).
6. Používateľ skontroluje a prípadne požiada o úpravy.
7. Pracuje sa po dávkach (3–5 videí naraz).

Odkaz na tabuľku nie je v repozitári, lebo repozitár je verejný a tabuľka obsahuje správne odpovede. Vypýtaj si ho od používateľa.

## Analýza prepisu (hlásiť používateľovi pri každom videu)

- **Časť s otázkami a odpoveďami** na konci webinára: najviac 10 minút je v poriadku, dlhšiu treba strihať. Uveď presné časy.
- **Prázdne úseky:** ankety, čakanie na účastníkov, technické problémy, aktivity, do ktorých sa divák zo záznamu nemôže zapojiť. Uveď presné časy a navrhni strih.
- **Varovné signály:** všetko nevhodné alebo podozrivé, napríklad:
  - vulgarizmy,
  - osobné údaje (e-maily, mená žiakov na obrazovke, žiaci so ŠVVP),
  - rady na obchádzanie podmienok služieb,
  - vypínanie moderovania pre žiakov,
  - súkromné rozhovory,
  - reklama,
  - faktické chyby,
  - citlivé témy (napríklad pre školu s VJM).
- Na konci daj **prehľadovú tabuľku** s odporúčaním: bez strihu, drobný strih, strihať alebo vyradiť.
- O strihaní a vyradení rozhoduje používateľ. Po strihu pošle novú dĺžku, prípadne nové titulky. Do otázok nikdy nedávaj obsah z úsekov navrhnutých na strih ani obsah, ktorý bol z videa vystrihnutý.

## Otázky

- **8 otázok**, možnosti A–D, jedna správna. Na splnenie treba 6 z 8.
- **Rozloženie:** 6 praktických a 2 vedomostné.
  - **Praktická otázka:** situácia zo školskej praxe („Kolega…“, „Na hodine chcete…“, „Žiak tvrdí…“) a čo urobiť.
  - **Vedomostná otázka:** dôležitý pojem alebo princíp z videa. **Žiadne triviálne fakty** (čísla, limity, počty, roky, ceny, mená).
- **Nikdy otázky na dopĺňanie.**
- **Jednoslovné odpovede** A–D nie sú povinné, použi ich len tam, kde sa hodia.
- Ostatné možnosti sú krátke vety podobnej dĺžky. **Správna odpoveď nesmie byť nápadne najdlhšia.**
- **Každú správnu odpoveď over v prepise.** Nič si nevymýšľaj nad rámec videa. Faktické chyby lektora do otázok nedávaj.
- **Správne písmená rozlož rovnomerne:** pri 8 otázkach 2× A, 2× B, 2× C, 2× D.
- **Nesprávne možnosti** majú byť vierohodné, ale podľa videa jednoznačne nesprávne.
- **Jazyk:** spisovná slovenčina, typografické úvodzovky „…“, pomlčka –.

## Anotácia

- 2–3 vety: čo sa učiteľ vo videu naučí a pre koho je užitočné.
- Bez marketingových fráz.

## Nálepky (stĺpec Nálepky v hárku Videa)

- Každé video má **2–5 nálepiek**, oddelených čiarkou.
- Nálepky idú od všeobecných (napr. AI, Kyberbezpečnosť, Prevencia) po predmetové (Biológia, Chémia…) a všetko medzi nimi.
- **Nálepky sa majú prekrývať:**
  - každá všeobecná nálepka má aspoň 2 videá,
  - nálepka s jediným videom je povolená len pri predmetoch,
  - predmety zastrešujú skupinové nálepky (Prírodné vedy, Humanitné predmety).
- **Pri každej novej dávke prejdi nálepky celého katalógu:**
  - starším videám pridaj novú nálepku, ak sa hodí,
  - podobné nálepky zlúč alebo premenuj,
  - nálepku, ktorá ostala len pri jednom videu, zruš alebo nahraď.
- Na konci pošli prehľad:
  - čo sa zmenilo pri starších videách,
  - zoznam všetkých nálepiek s počtom videí.
- Vo filtri aplikácie platí logika **ALEBO**: pri viacerých zapnutých nálepkách sa zobrazia videá s aspoň jednou z nich.

## Zápis do tabuľky (dôležité)

- **Dĺžka videa v sekundách musí presne sedieť s YouTube.** Ak je v tabuľke väčšia, učiteľ video nikdy nedokončí a test sa neodomkne.
- **YouTube ID nikdy nezapisuj bez dĺžky.** Server riadok bez dĺžky preskočí, ale aj tak ID bez dĺžky nenechávaj.
- Video bez otázok server nezobrazí (test bez otázok by sa rátal ako splnený). Nové videá sa preto dajú zapísať do hárku Videa hneď a v aplikácii sa objavia, až keď majú otázky.
- **Číslo v stĺpci Poradie sa nemení.** Otázky aj priebeh sú naň naviazané. Pri vyradení videa ostane v číslovaní medzera.
- **Riadky v hárku Priebeh sa nikdy nemažú.**
- Po zápise vždy over obsah cez `get_values`.
- Pri vkladaní otázok medzi existujúce riadky použi vloženie riadkov (`insert_dimension`) a skontroluj stĺpec Video.
- YouTube ID zapisuj do stĺpca formátovaného ako text.
