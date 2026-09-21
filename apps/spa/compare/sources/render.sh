#!/bin/sh
# DSL -> PlantUML (structurizr) -> PNG/SVG (plantuml, which shells out to graphviz dot)
set -e
cd "$(dirname "$0")"
structurizr export -w workspace.dsl -f plantuml/structurizr-dark -o out
plantuml -tsvg out/structurizr-landscape.puml out/structurizr-full.puml
plantuml -tpng -Sdpi=243 out/structurizr-landscape.puml
plantuml -tpng -Sdpi=135 out/structurizr-full.puml
cp out/structurizr-landscape.png landscape.png; cp out/structurizr-full.png full.png
cp out/structurizr-landscape.svg landscape.svg; cp out/structurizr-full.svg full.svg
