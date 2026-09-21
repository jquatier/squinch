# The compare page's sources

Everything `/compare/` shows that Squinch did not draw. Each tool was driven by
its own coding agent on 2026-09-20, from `examples/microservices/shop.squinch`
read as a specification, under the rules the page states. The pictures in
`../img/` are these files' renders, resized to 1600px wide and nothing else.

The site build cannot regenerate them — it would need four toolchains — so
they are committed. To refresh one, re-run its tool and replace the picture.

| Tool | Version | Files | Render |
|---|---|---|---|
| Mermaid | mermaid-cli 11.17 | `landscape.mmd`, `full.mmd` | `mmdc -i full.mmd -o full.png -t dark -b '#1f2020' --iconPacks @iconify-json/logos`, scaled with `-s` to about 2000px |
| D2 | 0.9.0 | `shop.d2` (root board and the `full` scenario) | the command in the file's header comment |
| Structurizr | structurizr 2026.09.19, PlantUML, Graphviz 16.1 | `workspace.dsl` | `render.sh` |
| Python diagrams | diagrams 0.25.1, Graphviz 16.1 | `diagrams-landscape.py`, `diagrams-full.py` | `python diagrams-full.py` |

Squinch's own two pictures are `examples/microservices`' committed renders,
copied in by `apps/spa/scripts/sync-media.ts`.
