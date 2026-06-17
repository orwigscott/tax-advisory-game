# CLAUDE.md — Tax Advisory Game Engine

## What this is
A web-based learning game that reinforces tax concepts for CPE audiences (interns to
partners). It is a **reinforcement tool**, not a credit-bearing CPE course — no NASBA
self-study measurement requirements apply.

The first topic is **entity selection** (C corp vs. S corp vs. partnership vs. sole prop).
The first mechanic is the **advisory scenario**: the learner reads a client situation,
chooses an entity, and gets scored with feedback that explains the *tradeoff* — not just
right/wrong.

## Non-negotiable principles
1. **Content is data; the engine is generic.** All scenarios live in JSON content packs
   under `/content`. The engine renders any pack that matches the schema below. Never
   hardcode a scenario into the engine.
2. **The author owns right/wrong. The model never judges answers.** Scoring, verdicts, and
   feedback are author-set in the content pack. The app must not call any AI model to grade
   a learner's choice. Correctness is fully deterministic and lives in the data.
3. **Feedback teaches the tradeoff.** Every option's feedback explains *why*, keyed to the
   weighted factors — never a bare "correct"/"incorrect."
4. **Verdict tiers, not binary.** Options can be `best`, `defensible`, or `wrong`. Entity
   selection is a weighing; the scoring reflects that.

## Content pack schema (the contract)
A pack is `{ pack_id, title, topic, schema_version, scenarios[] }`. Each scenario:

| Field          | Meaning |
|----------------|---------|
| `id`           | Unique scenario id |
| `title`        | Short display title |
| `level`        | `foundational` \| `intermediate` \| `advanced` (intern → partner) |
| `client_brief` | The situation the learner reads |
| `options[]`    | `{ id, label }` — the entities to choose from (varies per scenario) |
| `factors[]`    | `{ id, label, weight, favors, note }` — the considerations that justify scoring; `favors` is an option id or `"none"`. **This array also powers the future "spot the flaw" mode, so author it carefully.** |
| `scoring`      | Map of option id → `{ verdict, points }` |
| `feedback`     | Map of option id → explanation string shown after the learner picks |

See `/content/entity-selection.json` for four worked scenarios with different best answers
(C corp, partnership, S corp, sole prop) — variety is intentional so learners can't just
memorize one answer.

## Tech constraints (v1)
- **Vanilla JS, no framework, no build step.** Plain `index.html` + `app.js` + `styles.css`.
- **Static and hostable from a link.** No backend, no database, no auth. Must run as static
  files so it can be served from any static host / CDN and scale to thousands of users.
- **Installable PWA.** Include a `manifest.webmanifest` and a service worker so learners can
  "Add to Home Screen" and play offline.
- **No browser storage assumptions beyond the session for v1.** Progress persistence is out
  of scope; keep state in memory.
- Clean, modern, legible UI. This is a polished product with the company's name on it, not a
  prototype — but no heavy dependencies.

## Out of scope for v1 (do not build yet)
- Progress tracking / accounts / leaderboards
- The "spot the flaw" social-media mode (the engine should stay generic so it can be added
  later, but don't build it now)
- Animations beyond simple, tasteful transitions
- CPE credit / completion records

## Project layout
```
/index.html
/app.js
/styles.css
/manifest.webmanifest
/sw.js
/content/entity-selection.json
/CLAUDE.md
```

## Working agreement
Build the smallest thing that fully works end-to-end against the schema, then stop for
review before adding scenarios or modes. Flag any place where you're tempted to put answer
logic in code instead of the content pack — that's a signal something belongs in the data.
