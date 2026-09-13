## The graph shape (few stable elements, many decisions)

kgai's model is "few stable domain elements shaped by many immutable decisions" — so the importer does NOT turn every DDR into an island node. Instead, per DDR:

- one `decision:DDR-NNN` element (so `kg context --about DDR-NNN` resolves), carrying `title`,
- shaping an `area:<primary-tag>` element (the DDR's first tag) via an `ABOUT` link,
- remaining tags → `topic:` elements, `area —TOUCHES→ topic`,
- `repo:`/`dept:` scope tags from `config.knowledgeGraph.scope` + `IN_REPO`/`IN_DEPT` links (model A — DDR-189),
- the **entire source document** as the decision `rationale` (not an excerpt — see below), real `Date` preserved.
