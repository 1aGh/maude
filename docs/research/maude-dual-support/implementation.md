# Minimální nativní distribuce a optimalizace Markdownu

Implementováno 13. září 2026 po zpřesnění zadání. Pro tento rozsah nahrazuje
původní návrh generovaných adaptérů: Maude má vlastní nativní manifesty,
společné postupy a krátké vstupní Markdowny. Studio ACP je pouze
[samostatný follow-up](acp-follow-up.md).

## Co se změnilo

- Dva `.codex-plugin/plugin.json` a repozitářový `.agents/plugins/marketplace.json`.
  Claude manifesty, názvy 55 příkazů a 31 agentních rolí zůstávají zachované.
- 55 krátkých Codex vstupů odkazuje na existující postupy. Názvy
  `source-command-*` navazují na současnou instalaci. Codex metadata nastavují
  explicitní spouštění; Claude skryje doplňkové aliasy z uživatelského menu.
  Aliasy nejsou v Claude zakázané pro interní použití.
- Zkráceno všech 85 popisů původních skills a příkazů. Čtrnáct velkých skills a
  příkazy `design:new` / `design:edit` mají vstup s pravidly a rozcestníkem;
  původní detaily jsou v referencích podle operace či fáze.
- Společné konvence vysvětlují skutečné hostitelské nástroje, argumenty, cesty,
  otázky, subagenty a dědění modelu. Není potřeba překlad názvů modelů ani
  nový orchestration runtime. Native tool permissions se nepředstírají Markdownem.
- kgai má explicitní checkpointy v obou hostech, respektování engine-resolved
  store a lokálního režimu. Doporučení instalovat staré kgai 1.0.0 bylo nahrazeno
  minimem 1.5.1. Cizí kgai plugin ani jeho hooky se neupravovaly.
- `claude-md-keeper` a oba init postupy rozlišují `CLAUDE.md` a `AGENTS.md`.
  Skill loader odlišuje dostupný skill od skutečně načteného obsahu.
- Stávající launcher po ověření hashů kopie respektuje vlastní Codex manifest
  pluginu. Je to krátká výjimka z automatického převodu, nikoli nový adaptér.
  Bez ní by přepsal ruční vstupy a poškodil relativní odkazy. Přibyl regresní test.
- Stávající release skripty zahrnují oba nové manifesty. Verze zůstává 1.2.0;
  neproběhla publikace, instalace do osobního profilu ani změna Studio chatu.

## Měřená velikost

Velikost v bytech UTF-8, zaokrouhlená na desetinné KB. Nejde o měření tokenů
konkrétního modelu ani o příslib stejné úspory celého běhu.

| Vstup | Před | Po |
| --- | ---: | ---: |
| 30 společných `SKILL.md` dohromady | 401 KB | 132 KB |
| Jejich popisy v katalogu | 14 481 znaků | 3 129 znaků |
| `design/SKILL.md` | 72 KB | 4,8 KB |
| `video-comp/SKILL.md` | 27 KB | 3,7 KB |
| `agent-device/SKILL.md` | 26 KB | 2,5 KB |
| `kgai-backend/SKILL.md` | 26 KB | 3,7 KB |
| `commands/new.md` | 111 KB | 4,7 KB |
| `commands/edit.md` | 66 KB | 4,2 KB |

Všech 30 společných vstupů je pod 8 KB; největší má 7 384 bytů. Úspora součtu
vstupů je přibližně 67 %, popisů přibližně 78 %. Kompletní procedury nezmizely:
náročný workflow musí stále načíst všechny své relevantní kroky. Počet souborů
vzrostl hlavně přesunem sekcí do referencí a krátkými vstupy, nikoli duplikací
implementace. Další instalované pluginy mohou dál zatěžovat globální katalog;
tato změna sama nezaručuje odstranění všech varování v uživatelském profilu.

## Ověření

- Oficiální lokální plugin validator: oba pluginy prošly, včetně skill frontmatter
  a Codex metadata. Minimální validator sdíleného design skillu také prošel.
- Claude Code 2.1.270: oba pluginy validní; pouze původní tři upozornění na
  podpůrné Markdowny v adresářích agentů bez frontmatter.
- Codex CLI 0.154.0: izolovaný `HOME` / `CODEX_HOME`, instalace obou pluginů
  přímo z nové nativní marketplace. `skills/list`: **85/85 enabled**, nulové
  chyby, správná jména a odkazy všech 55 vstupů na sdílené příkazy.
- V instalované kopii přítomno 55 explicit-only policy souborů.
  `skills/list` nevystavuje pole policy, takže z tohoto API nelze měřit samotné
  vyloučení z automatického promptu; to je nastavení podle dokumentovaného
  [Codex skill contractu](https://learn.chatgpt.com/docs/build-skills).
- **355 nových navigačních odkazů** na host konvence, sdílené příkazy a přesunuté
  reference bylo zkontrolováno proti existujícím souborům.
- U všech **14 rozdělených skills** součet referencí rekonstruuje přesný obsah
  těla bezprostředně před rozdělením (SHA-256), po obnovení oddělovacích prázdných
  řádků evidovaných v `reference_boundary_newlines_removed`. Koncové prázdné
  řádky jednotlivých referencí byly při uzavření sjednoceny kvůli Git kontrole.
  U dvou příkazů byly zachovány
  všechny fragmenty v původním pořadí a přepočteny relativní Markdown odkazy.
  Záměrné obsahové změny kompatibility proběhly před rozdělením a jsou uvedené výše.
- **30/30 cílených testů** prošlo: launcher, ověření neměnnosti nativní kopie,
  odmítnutí změněného hashe, CLI argumenty, namespace a dosah helperů.
  Biome kontrola dvou upravených JS souborů prošla.
- Kontrola verze prošla pro Claude i Codex manifesty; `git diff --check` bez chyb.

Sonda nezahájila modelový turn, neschvalovala hooky a nekopírovala přihlašovací
údaje do testovacího profilu. Proto jde o důkaz instalovatelnosti, discovery,
statických kontraktů a zachování obsahu, **nikoli o E2E certifikaci všech 85
workflow na každém modelu**. Z předchozího auditu zůstává rozdíl v tvrdé izolaci
rolí, externích závislostech a kgai transcript hooku. Příslušné workflow tyto
limity přizná; neoznačí chybějící kontrolu za úspěšnou.

Strojová data k velikostem, instalaci a zachování přesunutých těles jsou v
[implementation-evidence.json](implementation-evidence.json). Implementované rozhodnutí
je uložené také v lokálním kgai jako `maude/native-markdown-plugin-distribution`.

Pro používání viz [instalace a mapování příkazů](../../native-plugins.md).
Následné doplnění docs webu a praktická zkouška Studia jsou v
[Studio verification](studio-verification.md), včetně dosud neověřeného vizuálního kola.
Původní inventáře, hashe a audit zachycují stav před touto implementací;
nejsou očekávanými hashi nových souborů.
