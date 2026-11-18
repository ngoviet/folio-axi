/* global console, location */

// Re-probe for the whiteboard pins (test/whiteboard-pins.test.js): every diagram type the
// converter turns into editable shapes must still come out as Excalidraw elements carrying
// the diagram's own labels, not as the converter's image fallback. mermaid-to-excalidraw
// 2.x silently degraded class/ER/state diagrams and subgraph flowcharts to images when
// mermaid moved past 11.13 (mermaid-to-excalidraw#108); this fixture catches that class
// of regression on any converter bump.

import { parseMermaidToExcalidraw } from "@excalidraw/mermaid-to-excalidraw";
import { convertToExcalidrawElements } from "@excalidraw/excalidraw";

import { restoreMermaidLabelLineBreaks, sceneIsImageFallback } from "../../src/whiteboard-core.js";

const sources = {
  flowchart: `flowchart LR
  start[Start] --> check{Check}
  check -->|pass| ship[Ship]
  check -->|fail| fix[Fix]`,
  subgraph: `flowchart TB
  subgraph backend [Backend]
    api[Orders API] --> db[(Orders table)]
  end
  user[Customer] --> api`,
  sequence: `sequenceDiagram
  participant alice as Alice
  participant bob as Bob
  alice->>bob: Hello Bob
  bob-->>alice: Hi Alice`,
  class: `classDiagram
  class Animal {
    +String name
    +eat()
  }
  class Dog
  Animal <|-- Dog`,
  er: `erDiagram
  CUSTOMER ||--o{ ORDER : places
  ORDER ||--|{ LINE_ITEM : contains`,
  state: `stateDiagram-v2
  [*] --> Idle
  Idle --> Running : start
  Running --> Idle : stop
  Running --> [*]`,
};

async function probe(source) {
  const errors = [];
  const original = console.error;
  console.error = (...args) => {
    errors.push(args.map((arg) => (arg?.stack ? String(arg.stack).split("\n")[0] : String(arg))).join(" "));
  };
  let parsed;
  try {
    parsed = await parseMermaidToExcalidraw(source, { themeVariables: { fontSize: "16px" } });
  } finally {
    console.error = original;
  }
  const elements = restoreMermaidLabelLineBreaks(
    convertToExcalidrawElements(parsed.elements, { regenerateIds: true }),
  ).filter((element) => !element.isDeleted);
  const types = {};
  for (const element of elements) types[element.type] = (types[element.type] || 0) + 1;
  // Labels wrap inside narrow shapes, so compare them without whitespace.
  const labels = elements
    .filter((element) => element.type === "text")
    .map((element) => String(element.text || "").replace(/\s+/g, ""))
    .filter(Boolean)
    .sort();
  return {
    imageFallback: sceneIsImageFallback(elements),
    files: Object.keys(parsed.files || {}).length,
    types,
    labels,
    errors,
  };
}

async function run() {
  const diagrams = {};
  for (const [name, source] of Object.entries(sources)) {
    try {
      diagrams[name] = await probe(source);
    } catch (error) {
      diagrams[name] = { error: error?.message || String(error) };
    }
  }
  return { pass: true, diagrams };
}

function report(result) {
  location.replace(`/result?value=${encodeURIComponent(JSON.stringify(result))}`);
}

run().then(
  (result) => report(result),
  (error) => report({ pass: false, error: error?.stack || String(error) }),
);
