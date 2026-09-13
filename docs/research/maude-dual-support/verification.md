# Důkazy a reprodukce auditu Maude

Auditní baseline: 2026-09-13, commit `d50954df2a435f7bbd45598395855305b2b0328f`, Maude 1.2.0. Tato příloha dokládá [hlavní report](README.md). Výsledky platí pro uvedené verze a rozsah sond.

## 1. Identita prostředí

| Sonda | Výsledek |
| --- | --- |
| Skutečný Codex: `/Users/iagh/.local/bin/codex --version` | `codex-cli 0.154.0` |
| `claude --version` | `2.1.270 (Claude Code)` |
| `node --version` | `v24.13.0` |
| `bun --version` | `1.3.3` |
| `agent-browser --version` | `0.36.0` |
| `agent-device --version` | `0.20.10` |
| `kg version` | `1.6.0` |
| `kg config get store` | `source: project`, `value: ../.kgai-shared` |
| `node cli/bin/maude.mjs kg resolve --json` | `active: true`, `mode: auto`, konfigurace `engineVersion: v1.5.1`, scope `maude/dev` |

Na PATH byly nalezeny Node, Bun, git, jq, ffmpeg, ffprobe, Python, whisper-cli a Ollama. `svg2pptx` nalezen nebyl. To neověřuje modelové soubory, Chromium, export, připojená zařízení ani přihlašovací údaje mediálních služeb.

`command -v codex` ukázalo na `/Users/iagh/.claude/bin/codex`. Tento shell wrapper spouští `maude codex` a v již probíhající bridgované relaci vrátil:

```text
maude: refusing recursive maude codex launch; set MAUDE_CODEX_REAL to the real binary
```

Nejde o neexistující Codex ani prokázanou chybu běžného spuštění v novém terminálu. Pro sondy se použila přímo skutečná binárka.

Uživatelská konfigurace měla povolené `design@maude`, `flow@maude` a `kgai@kgai-marketplace`. Nainstalované Maude cache obsahovaly 33 a 52 `SKILL.md`, bez `agents/openai.yaml`. Kontrolovaný Codex model byl `gpt-6-astra`, effort `high`. V počátečním snapshotu kořene projektu nebyl `AGENTS.md` ani `.codex/config.toml`; kontrolovaný uživatelský config neobsahoval `project_doc_fallback_filenames`.

Závěrečné `git status` již ukázalo neversionované `AGENTS.md`, `.codex/` a `.agents/`; jejich filesystem mtime byl 13. 9. 2026 11:26:51 místního času. Audit je nevytvářel ani neupravoval přímou editací; původ přírůstku není prokázaný. Nový `AGENTS.md` má 53 564 bytů a 239 řádků, s mechanicky změněnými názvy jako `.Codex-plugin` a `@anthropic-ai/Codex`. `.codex/config.toml` nastavuje shell inheritance `core` a Claude agent-teams proměnnou. `.agents/skills` obsahuje `bug-autofix`, `whats-new-entry`, `maude-positioning`, `desktop-e2e`. Jsou vedeny jako dodatečný lokální nález, nikoli přidané pluginové skills nebo výsledek implementace doporučení.

Z konfigurací byly vypsány pouze vybrané názvy pluginů, nastavení modelu a relevantní metadata. Zakázané `.env`, privátní klíče a secrets se nečetly. Před auditem již existovala změna `.claude/settings.json`; audit ji neupravoval.

## 2. Inventář zdrojů

Prošly se všechny `commands/**/*.md`, `skills/**/SKILL.md` a `agents/**/*.md` pod `plugins/design` a `plugins/flow`. Soubor bez frontmatteru v adresáři agentů je veden jako podpůrná reference, nikoli zamýšlená role.

| Plugin | Příkazy | Skills | Zamýšlení agenti | Podpůrné MD mezi agenty |
| --- | ---: | ---: | ---: | ---: |
| design | 24 | 9 | 20 | 2 |
| flow | 31 | 21 | 11 | 1 |
| Celkem | 55 | 30 | 31 | 3 |

[inventory.csv](inventory.csv) má jeden řádek pro každou z těchto položek. SHA-256 se počítá z celého zdrojového souboru. `codex_discovery_0_154_0` je výsledek skutečného discovery níže pro příkazy a skills; u agentů vyjadřuje politiku existujícího bridge. Není to hodnocení provedení workflow.

Sloupce `portability_flags_heuristic` a `referenced_capabilities_heuristic` jsou vyhledávací pomůcka. Zahrnují i zmínky v příkladech a historickém textu; nelze je používat jako přesný tranzitivní dependency resolver. [dependencies.csv](dependencies.csv) odděleně zachycuje všech 24 deklarací z obou `dependencies.json`, včetně původní tvrdosti a popsaného fallbacku. Je to inventář deklarací, nikoli výsledek spuštění jejich instalačních příkazů.

### Striktní YAML

Frontmatter byl načten závislostí repozitáře `yaml@2.9.0` přes `parseDocument`. Chyby se našly v těchto 11 souborech:

```text
plugins/design/commands/draw.md
plugins/design/commands/edit.md
plugins/design/commands/photo.md
plugins/design/commands/reel.md
plugins/design/commands/video-analyze.md
plugins/design/skills/design-system/SKILL.md
plugins/design/agents/design-system-keeper.md
plugins/design/agents/footage-analyst.md
plugins/design/agents/footage-director.md
plugins/design/agents/media-generation-director.md
plugins/flow/commands/record-retro.md
```

Typická chyba: `Nested mappings are not allowed in compact mappings`; `record-retro` má chybně zapsaný `argument-hint: [plan-path] [record-execution-path]`. Tyto soubory současné tolerantní loadery mohou přijmout. Audit to výslovně ověřil u discovery skills, takže chyba striktního parseru není prezentována jako 11 nefunkčních workflows.

## 3. Nativní instalace Codex pluginů

Test běžel v `/tmp/maude-dual-audit-20260913/native-probe` s oddělenými `HOME`, `CODEX_HOME` a `XDG_CONFIG_HOME`. Nepřebíral autentizaci uživatele a nespouštěl modelový turn.

Nejprve vznikly dvě minimální fixtures se stejným harmless skillem:

- portable: kořenový `plugin.json` s Agent Plugins schema;
- compat: `.codex-plugin/plugin.json`, `skills: ./skills/`.

Obě položky byly přidané do lokálního `.agents/plugins/marketplace.json` s local source. Skutečný Codex provedl:

```text
plugin marketplace add <isolated-marketplace> --json       exit 0
plugin add audit-portable@maude-audit --json               exit 0
plugin add audit-compat@maude-audit --json                 exit 0
plugin list --json                                       exit 0
```

Oba pluginy byly `installed: true`, `enabled: true`. Dále `--strict-config doctor --json` vrátil `config.load.status: ok`. Celkový exit doctoru byl **1**, protože izolované prostředí nemělo credentials; není prezentován jako kompletně úspěšný health check.

### Skutečný katalog Maude

Do izolovaného marketplace byly zkopírovány adresáře `commands`, `skills`, `agents`, `templates`, `hooks`, `.claude-plugin` a oba dependency soubory každého pluginu. Command wrappers byly vytvořeny existujícími funkcemi `snapshotCommandFiles`, `parseClaudeCommand` a `renderCommandSkill` z `cli/lib/harness/codex-runtime.mjs`. Přidán byl kompatibilní Codex manifest stejných základních polí, jaká generuje bridge.

```text
plugin add design@maude-audit --json                      exit 0
plugin add flow@maude-audit --json                        exit 0
```

Následoval autentizačně nezávislý discovery dotaz přes lokální Codex App Server:

```json
{"id":1,"method":"initialize","params":{"clientInfo":{"name":"maude-audit","version":"1.0"},"capabilities":{"experimentalApi":true}}}
{"method":"initialized","params":{}}
{"id":2,"method":"skills/list","params":{"cwds":["<isolated-cwd>"],"forceReload":true}}
```

Výsledek: **93 skills celkem**, z toho **85 Maude**, dvě minimální auditní fixtures a šest systémových skills. `errors: []`. Maude rozpad: **33 design + 52 flow**. Přesná nalezená jména jsou spárována v inventáři.

Nebyl spuštěn `thread/start` ani `turn/start`; hooky nebyly schvalovány a nebyla testována agentní izolace. Instalace těchto fixture balíčků neověřuje úplnou produkční package closure, protože účelem bylo změřit discovery. Pro shell, browser, export a role zůstávají samostatné akceptační scénáře.

Lokální dočasné výstupy: `native-probe/skills-list.json`, `native-probe/4.json`, `native-probe/appserver.stderr` pod auditním `/tmp` adresářem. Nejsou přiloženy jako trvalá uživatelská konfigurace.

## 4. kgai Stop hook

Použil se skutečný instalovaný soubor `kgai/1.6.0/hooks/auto-capture-stop.sh`. Testovací `KGAI_HOME` obsahoval pouze inertní executable `bin/kg`, aby prošla kontrola přítomnosti engine. Sám hook žádný engine příkaz nespouští; v tomto testu se nečetl ani neupravoval skutečný graf.

Dvě syntetické transcriptové fixtures:

```json
{"type":"user","message":{"content":"change module boundary"}}
{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Edit","input":{"file_path":"src/module.ts"}}]}}
```

```json
{"type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"change module boundary"}]}}
{"type":"response_item","payload":{"type":"custom_tool_call","name":"apply_patch","input":"*** Begin Patch\n*** Add File: src/module.ts\n+x\n*** End Patch"}}
```

Každý test předal na stdin `{"stop_hook_active":false,"transcript_path":"<fixture>"}`.

| Fixture | Exit | Stdout |
| --- | ---: | --- |
| Claude Edit | 0 | JSON s `decision: block` a připomenutím capture |
| Codex apply_patch shape | 0 | Prázdný |

To potvrzuje statické čtení implementace: parser hledá Claude `message.content[]/tool_use` a Claude názvy nástrojů. Codex fixture je modelový příklad odlišného formátu, nikoli export aktuálního skutečného transcriptu. Přesnou podobu historie konkrétního klienta a pokrytí shell/server edits je nutné testovat samostatně.

## 5. Testy existující implementace

Spuštěná sada:

```sh
node --test --test-reporter=spec \
  cli/lib/harness/*.test.mjs \
  cli/lib/harness/targets/codex.test.mjs \
  cli/commands/codex.test.mjs \
  cli/lib/plugin-cli-reachability.test.mjs \
  cli/lib/plugin-name-namespace.test.mjs
```

Výsledek: **178 testů, 176 PASS, 2 FAIL**, přibližně 56 sekund. Záznam byl uložen do `/tmp/maude-dual-audit-20260913/tests.log`.

### Fail A: conformance fixture

Test `committed fixture has exhaustive provenance, safe target statuses, and golden output trees`, `cli/lib/harness/conformance.test.mjs:42`:

```text
Expected values to be strictly equal:
+ actual - expected
+ 'production'
- 'test'
```

Selhání nastává při očekávaném `project:NODE_ENV`. Cílené zopakování stejného testu znovu selhalo stejně. Materiál fixture obsahuje projektové `settings.json`; očekávaná lokální přepisující vrstva není v prohlédnutém inventáři fixture. Audit neprovedl opravu a neoznačuje za prokázanou závadu algoritmu precedence. Zelený conformance baseline však chybí.

### Fail B: Codex smoke přes wrapper

Test `isolated CODEX_HOME strict config smoke passes when codex is installed` selhal na parsování odpovědi, protože spustil `codex` wrapper. Zpráva o rekurzivním spuštění je uvedena v §1.

Cílené opakování se skutečnou binárkou na začátku PATH:

```sh
PATH=/Users/iagh/.local/bin:$PATH node --test --test-reporter=spec \
  --test-name-pattern='isolated CODEX_HOME' \
  cli/lib/harness/targets/codex.test.mjs
```

Výsledek: **1 PASS, 0 FAIL**. Tato opravená sonda prokazuje načtení vygenerované konfigurace na 0.154.0, nikoli úplné workflow chování a nikoli obcházení version policy produkčního migrátoru. Celá sada po této úpravě znovu spuštěna nebyla.

### Claude plugin validace

```sh
claude plugin validate ./plugins/design
claude plugin validate ./plugins/flow
```

Obě validace prošly s warnings. Design upozornil na chybějící frontmatter `_draw-design-rules.md` a `_draw-motion-rules.md`; flow na `_security-regex-catalog.md`. Není to ověření execution semantics skills ani agentních oprávnění.

## 6. Co dosud není ověřeno

- 31 vlastních rolí skutečně spuštěných pod Codexem 0.154.0 a jejich negativní permission testy.
- Nativní relay, přerušení, obnovení a souběžné otázky ve všech podporovaných TUI režimech.
- Kompletní lifecycle hooků v nové relaci, po resume a po compact.
- kgai capture na skutečné historii Codex klienta, shell edits a serverové writes.
- Úplný flow cyklus a design cyklus nad společnou fixture, včetně screenshotů a všech gates.
- Médium/export/browser/device skutečně provedené na všech podporovaných platformách.
- Kvalita, délka běhu a cena jednotlivých workflow pro každou zamýšlenou modelovou konfiguraci.
- Instalace publikovaného produkčního release do úplně čistého stroje bez autorova CLI a cache.

To jsou konkrétní podmínky pro budoucí prohlášení funkční parity, nikoli důvod zahodit existující katalog.
