# Follow-up: Studio chat a ACP

Odloženo podle zadání. Nativní instalace skills a pluginů v terminálovém Codexu
na této práci nezávisí. Stávající `design:chat` zůstává příkazem pro otevření
současného panelu; není důkazem Codex ACP podpory.

Až se bude řešit Studio chat:

1. Zmapovat dnešní start ACP procesu, výběr hostu, subscription/auth, env-scrub,
   pracovní adresář a napojení na již nainstalované nativní pluginy.
2. Rozhodnout použití nativního Codex protokolu podle tehdejší dokumentace.
   Znovu nezavádět generování kopií těchto Markdown postupů.
3. Ověřit streaming, tool calls, obrázky, otázky/approval, přerušení, resume,
   životní cyklus subagentů a dostupnost CLI/MCP závislostí v procesu Studia.
4. Provést end-to-end scénáře v obou hostech: načtení canvasu, editace,
   screenshot/critic, kgai checkpoint a návrat do rozpracovaného workflow.

Akceptace: Studio zachová současný Claude chat a nabídne ověřený Codex chat bez
záměny identity, oprávnění, modelových nastavení nebo úložiště rozhodnutí.
