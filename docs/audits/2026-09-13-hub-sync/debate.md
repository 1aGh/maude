# Nezávislá debata po auditu

Datum: 2026-09-13. Protokol: `flow:debate-protocol`, divergentní návrh. Stav výsledku: **doporučení k prototypu; žádná architektura nebyla schválena k implementaci či nasazení**.

## Zadání a metoda

Nejdříve proběhl audit historie, kódu a živého provozu. Tři oddělené agentní perspektivy dostaly stejné [podklady](evidence.md), uživatelský kontrakt a zadání samostatně posoudit evoluci, nový dokumentový model i jednodušší serverovou pracovní kopii. Úvodní stanoviska vznikla nezávisle, před společnou syntézou.

Testovaná teze: „Je možné dosáhnout požadovaného Figma/FigJam UX dalšími opravami současného opaque Y.Text + file sync, bez změny autority a transakčního kontraktu?“

Všechna tři úvodní stanoviska tezi odmítla a konvergovala na evolučním hybridu. Proto se použilo pravidlo short-circuit: žádné umělé kolo sporů ani zbytečná otázka uživateli. Není to tvrzení, že proběhla dlouhá oponentní výměna nebo že existuje konsenzus celého oboru. Rozdíly a podmínky jsou zachovány níže.

## BUILDER — kontrakt přijetí změny

**Verdikt k tezi: BLOCK.** Jeden projektový žurnál přijatých transakcí, trvalý ACK mimo ephemeral renderer, odvozené checkouty. Browser, desktop, AI a externí soubory jsou různé vstupy do stejného přijímače.

- Každá akce má stabilní ID, autora, původ, bázi a preconditions; přesné hranice multi-file AI akcí a drag akcí.
- Pro native design postupně stabilní ID a strukturované operace, pro libovolný TSX zachovat zdroj/code islands. Nikdy nepředpokládat univerzální bezeztrátový round-trip.
- Osobní undo je podmíněná kompenzace; blob musí být durable před přijetím reference.
- Projekt se musí otevřít nezávisle na render kontejneru a stažení celé knihovny médií.

Hlavní riziko doporučení: zaměnit nový model za slib, že libovolný program lze bezpečně převést na Figma dokument. Jistota vysoká pro nutnost změny kontraktu, nižší pro přesnou reprezentaci dokumentu.

## BREAKER / OPS — ztráty, pády a migrace

**Verdikt k tezi: BLOCK.** Zachovat dobré části existujícího file plane a source fidelity; nejprve zpevnit přijímací kontrakt, ne provést velký přepis editoru.

- Největší riziko je starý writer, který obejde novou autoritu. Potřebuje vynucenou epochu/protocol fence, ne pouze doporučené pořadí nasazení.
- Immutable payloady nejprve, potom atomický commit metadata/head, potom ACK. Prokázat replay i crash v každém mezikroku.
- Revision manifest může být atomický pro renderer; běžný filesystem není atomický pro více souborů z pohledu externích nástrojů.
- Neinstrumentovaný editor neposkytuje spolehlivou hranici úmyslu ani multi-file akce; watcher idle ji nemůže dokazovat.
- Nutné skutečné testy obou backendů, starých klientů, velkého projektu a dvou počítačů. Parse-clean nestačí: musí přežít i záměr obou nezávislých změn.

Hlavní výhrada: nový document graph před ověřením základních přijímacích a durability vlastností by mohl vyrobit další migrační problém. Místo big-bang přepisu doporučuje postupný prototyp.

## USER ADVOCATE — práce designéra

**Verdikt k tezi: BLOCK.** Pozvánka → projektový výběr → automatická lokální kopie → práce. Žádná znalost složek, tokenů, WebSocketů či seedu v běžném toku.

- Nezávislé vlastnosti se slučují automaticky; nejednoznačný konflikt nesmí tiše přepsat práci a zmizet z UI.
- Osobní undo musí respektovat kolegu. Návrat do historie je viditelná nová projektová akce.
- Vadný kandidát nesmí zničit poslední dobrý sdílený render; zdroj musí zůstat obnovitelný.
- Velká média nesmějí blokovat začátek práce a vynechané soubory nesmějí být neviditelné.
- Role designéra musí pokrýt běžné editace i potřebné závislosti, při zachování samostatného code trust modelu.

Hlavní výhrada: cloud-only varianta by odstranila část složitosti za cenu porušení požadavku na lokální a offline práci. Výměna celé reprezentace zdroje by zase mohla poškodit existující projekty.

## Syntéza a porovnané alternativy

| Varianta | Posouzení |
|---|---|
| Jen další retry, diff a syntax opravy | Potřebné pro okamžité omezení škod; nezajišťují zachování báze, transakce a jednotnou autoritu |
| Celý systém přes Git | Historicky důkladně posouzené; neřeší live úmysl, undo, binární přenos ani rychlý onboarding |
| Pouze cloudový vzdálený checkout | Zjednodušuje některé souběhy, ale nesplní lokální/offline/AI kontrakt a zachová bottleneck rendereru |
| Okamžitý univerzální scene graph | Atraktivní dlouhodobě, ale neprokázaný bezeztrátový převod TSX a vysoké migrační riziko |
| Evoluční hybrid s jedním příjmem transakcí | Doporučen: zachová stávající práci, umožní přesnou historii a postupné strukturované operace |

Výsledek: doporučit společný transakční kontrakt a durability prototyp, souběžně uzavřít prokázané P0 chyby. Strukturovaný model až na ověřené podmnožině; žádná nucená konverze všech canvasů. Přibližná jistota syntézy: **0,9 pro změnu kontraktu, 0,7 pro konkrétní cílovou reprezentaci**. Jde o odhad úsudku, nikoli statistickou pravděpodobnost úspěchu.

Neuzavřené implementační otázky: konkrétní durable store/koordinátor pro oba backendy; rozsah native modelu; přesné pravidlo kolize stejné vlastnosti; atomicita exportu pro externí nástroje; časy a náklady migrace. Nevyžadují nyní výběr uživatele, protože zpráva doporučuje ověřovací práci a neprovádí migraci.

Předchozí DDR nejsou tímto automaticky superseded. Rozhodnutí o implementaci musí přijít až nad reviewovatelným prototypem a ověřenými acceptance gates popsanými v [auditu](README.md).
