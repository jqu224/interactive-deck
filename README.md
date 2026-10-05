<div align="center"><img src="docs/assets/hero.svg" width="100%" alt="Interactive Deck — one JSON spec builds one self-contained interactive deck site: flow canvas with minimap, camera viewport and nav dock"/></div>

<div align="center">
<pre>~/interactive-deck (main*)  2 decks · 11 nodes · 4 polls · dist = single-file HTML</pre>
</div>

<div align="center">

[![English](docs/assets/lang-en-on.svg)](./README.md)
[![中文](docs/assets/lang-zh-off.svg)](./README.zh-CN.md)

</div>

## interactive-deck

**A complete, interactive, permission-aware HTML deck platform**
— one JSON spec builds one self-contained site: edit live, present, put it to a vote.

<div align="center">

[![build](docs/assets/badge-build.svg)](scripts/build.mjs)
[![runtime](docs/assets/badge-runtime.svg)](src/)
[![agents](docs/assets/badge-agents.svg)](decks/)
<br/>
[![present](docs/assets/badge-present.svg)](docs/realtime-plan.md)
[![node](docs/assets/badge-node.svg)](https://nodejs.org/)

</div>

Decks are flow canvases: every page is a node on a shared canvas, edges carry the route, and the camera travels the flow with a sense of direction.

## Tips for getting started

| | |
| --- | --- |
| **Read** | [decks/01-internal-beta-review.json](decks/01-internal-beta-review.json) — a whole deck is one JSON spec |
| **Run** | `node scripts/build.mjs && npx --yes serve dist -l 5173` |
| **Output** | `dist/<slug>/index.html` — one self-contained file per deck, ready for any static host |

---

## Positioning

| Layer | What it means here |
| --- | --- |
| **Create** | A deck is `decks/*.json`; agents (Codex / Workbody / Claude Code) read and write the same spec humans do |
| **Build** | One command inlines CSS + JS + spec into a single HTML file per deck, plus a hub page |
| **Navigate** | Directional prev/next travel, keyboard + dock + progress dots, `#node` deep links, fork edges with route labels ("pass" / "conclusion only") |
| **Orient** | Top-right minimap: node boxes, live edges, a dashed camera-viewport frame, poll/edited markers, click any node to jump |
| **Present** | Host edits in place while the deck is on screen; realtime roles designed for ≤ 50 viewers ([design](docs/realtime-plan.md)) |
| **Interact** | Option polls with animated ratio bars; 1–5 star ratings reporting mean and median |
| **Control** | Host / collaborator / audience roles; bitable sources (Feishu bitable, Mingdao, Workbody docs & tables) feed the same room |

## Pipeline

```text
 decks/*.json ──► scripts/build.mjs ──► dist/<slug>/index.html ──► any static host
     ▲    ▲                 │
     │    │                 ▼
     │    └─ agents write      npx serve dist -l 5173 (local preview)
     │         the same spec
     └────── host edits in place during the session (kept in the exported file)
```

| Stage | Where | Contract |
| --- | --- | --- |
| **1 · Spec** | `decks/*.json` — nodes (`id` `kind` `x` `y` `html` `poll`), `edges`, `start`, `order` | unique ids; `kind` ∈ start / step / decision / end |
| **2 · Build** | `node scripts/build.mjs` | spec inlined as `window.__DECK__`; output is fully self-contained |
| **3 · Publish** | `dist/<slug>/index.html` | single file, opens from `file://`, deploys anywhere static |
| **4 · Present** | host in-place editing + camera travel | role gates per docs/realtime-plan.md; rooms sized ≤ 50 viewers |
| **5 · Interact** | polls / ratings / annotation pins | votes tally live; ratings report mean + median |

## Repository layout

| Path | Role |
| --- | --- |
| [`decks/`](decks/) | Deck specs — the content source of truth |
| [`src/`](src/) | `flowdeck.js` / `flowdeck.css` — the rendering engine (vanilla JS, zero dependencies) |
| [`scripts/build.mjs`](scripts/build.mjs) | Spec → self-contained HTML builder |
| [`dist/`](dist/) | Build output (committed, deploy-ready) |
| [`docs/assets/hero.svg`](docs/assets/hero.svg) | Repository hero banner |
| [`docs/realtime-plan.md`](docs/realtime-plan.md) | Realtime layer & permission design: roles, rooms, message protocol |
| [`dev/`](dev/) | Dev harness that loads `src/` directly, no rebuild needed |

## Usage

```bash
node scripts/build.mjs          # rebuild all decks + hub page
npx --yes serve dist -l 5173    # preview at http://localhost:5173
```

Inside a deck: `→` `Space` next · `←` back · `E` edit in place · `A` annotate · `Esc` exit · click the minimap to jump. **Export single file** in the top bar packs live edits into one HTML you can hand to anyone.

## For audiences

| Role | What you get | Entry |
| --- | --- | --- |
| **Author / agent** | one spec, one site; edit `decks/*.json` directly and rebuild | [decks/](decks/) |
| **Host** | in-place editing, single-file export, annotation review | [docs/realtime-plan.md](docs/realtime-plan.md) |
| **Viewer** | directional travel, polls, ratings, minimap navigation | [dist/](dist/) |
