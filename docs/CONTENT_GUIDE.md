# Content guide

Course content is plain data in `js/content/<section>.js`. A large section may split into
`js/content/<section>/<part>.js` files that the section file imports and concatenates.
Run `node tests/validate.mjs` after every change; it must print `OK`.

## Section module

```js
export default {
  id: 'electronics',                 // fixed, do not change
  title: 'Electronics', track: 'hardware', requires: ['foundations'],   // fixed, do not change
  tagline: 'One sentence shown on cards.',
  intro: `Markdown shown at the top of the section page.`,
  skills: [ { id: 'elec-divider', name: 'Design a voltage divider for a given load', track: 'hardware' } ],
  lessons: [ /* Lesson */ ], labs: [ /* Lab */ ],
  glossary: [ { term: 'Pull-up resistor', def: 'Markdown definition.' } ],
  troubleshooting: [ { symptom: 'ESP32 resets when the motor starts', area: 'Power', causes: 'md', fix: 'md' } ],
  refs: [ { org: 'Espressif', title: 'ESP32 Technical Reference Manual', url: 'https://…', note: 'optional' } ],
};
```
Skill `track` is one of `hardware | programming | security | competition | foundations`.
Skills are things a learner can *do* ("Decode a UART frame from a logic capture"), not topics.
Every skill must be referenced by at least one lesson or lab.

## Lesson

```js
{ id: 'elec-ohm',            // globally unique, prefix with a short section tag
  title: "Ohm's law", minutes: 25, summary: 'One line under the title.',
  skills: ['elec-ohm-calc'],
  blocks: [ /* Block */ ],
  quiz: [ /* Question, at least 5 */ ] }
```

### Teaching sequence (required)
Every lesson follows this arc. Do not present a finished solution before the learner has had to think.
1. Open with a concrete engineering **problem** (a thing that breaks, or a decision to make).
2. Explain the **theory** in plain language.
3. Show how it appears on **actual hardware** (name pins, registers, parts, datasheet parameters).
4. A **worked example** with numbers or code.
5. A `predict` block: the learner commits to a prediction *before* the explanation.
6. An `exercise` (or interactive `widget` challenge) requiring independent reasoning, with graded `hints`.
7. The solution is revealed only after an attempt.
8. Finish with a **harder application** that transfers the idea to a new situation.
Also include: at least one `mistake` callout (a real, common error), and where a design choice is made, a
`decision` callout explaining why this choice and not the alternatives.
When teaching code, explain what each important line does to the processor, memory or peripheral — use the
`explain` field of code blocks.

### Blocks
A block is either a Markdown string or an object:

| Block | Fields |
|---|---|
| `'markdown string'` | Headings `##`/`###`, lists, tables, fenced code, `**bold**`, `` `code` ``, `[text](https://url)`, `[[Glossary term]]` |
| `{t:'callout', kind, md, title?}` | kind: `why` `warn` `mistake` `note` `security` `sim` `hw` `decision` |
| `{t:'code', lang, code, caption?, status, explain?}` | status: see below. `explain: [{lines:'3-5', md}]` |
| `{t:'predict', q, code?, choices?, reveal}` | With `choices` ([{t, ok?, why}]) it is a commit-then-reveal question; without, a free-text prediction |
| `{t:'exercise', prompt, code?, hints:[md], solution, answer?}` | `answer: {type:'number', value, tol?, unit?}` or `{type:'text', accept:[regex…], nudge?}`; omit for open-ended |
| `{t:'widget', name, props?, caption?, title?}` | Interactive tool; names and props in `docs/WIDGET_GUIDE.md` |
| `{t:'figure', svg, caption?}` | Inline SVG string. Use `currentColor` and `var(--sig1..6)`, `var(--line)`, `var(--surface)`; include a `viewBox` |
| `{t:'ascii', text, caption?}` | Monospace diagram (wiring tables, timing sketches, memory layouts) |
| `{t:'refs', items:[{title,url,note?}]}` | Primary sources for this lesson |

### Code status — be honest
Every `code` block (and lab step code) declares how it was verified:
- `host-tested` — you compiled it with `gcc -Wall -Wextra -std=c11` and ran it in this repo's environment. Only claim this if you did.
- `interp` — it runs in the app's C interpreter (`js/sim/cinterp.js`).
- `idf-built` — the complete program was compiled for the `esp32` target with ESP-IDF v6.1 (see `tools/idf-check/`). Not run on a board.
- `idf-checked` — every ESP-IDF call, type and constant was checked against the ESP-IDF v6.1 headers, but the block was not compiled as a whole.
- `reviewed` — written against vendor documentation (ESP-IDF, MSDK, TI SDK); not compiled or run on a board here.
- `hw` — only meaningful on physical hardware.
- `pseudo` — an illustrative fragment.
Never write prose such as "when we ran this on the board we measured…". Nothing in this repo was run on physical
hardware. Say "you should see", and tell the learner how to check.

### Questions
```js
{ q: 'Markdown question', code?: '…', kind: 'concept'|'code'|'circuit'|'arch'|'security',
  choices: [ { t: 'answer text', ok: true, why: 'why this is right' },
             { t: 'distractor',  why: 'the misconception behind this answer, WITHOUT naming the right answer' } ] }
```
Exactly one `ok` choice, 3–4 choices, every choice has `why`. Distractors must be plausible misconceptions.
A wrong pick shows only that choice's `why`, so it must teach, not just say "incorrect".
Prefer questions that require reasoning about a new situation over recall. Mix the `kind`s.

## Lab (guided laboratory, project, scenario or capstone)

```js
{ id: 'esp-lab-blink', title: 'Project 1: LED control and GPIO fundamentals', kind: 'Project', minutes: 90,
  summary: '…', skills: ['…'], requires?: ['section-id'],
  objectives: ['…'], hardware: ['…'], software: ['…'],
  background: `md` | [blocks],
  diagram: [blocks],                       // circuit (ascii wiring table + figure/widget) or architecture diagram
  steps: [ { title: 'Wire the LED', md: '…', code?: '…', lang?: 'c', status?: 'reviewed', blocks?: [blocks] } ],
  walkthrough: `md` | [blocks],            // what each important line does at hardware level
  testing: `md` | [blocks],                // how to confirm it works; expected observations phrased as "you should see"
  troubleshooting: [ { symptom, cause, fix } ],
  challenge: `md` | [blocks],              // independent extension, no solution given
  quiz: [ Question × ≥4 ],
  requirements?: { functional: ['…'], security: ['…'] },   // scenarios and capstones
  rubric?: [ { criterion, points, evidence } ] }
```

## Accuracy rules
- Do not invent specifications. If you are not certain of a number, give the method and point at the datasheet section.
- Cite primary sources (manufacturer docs, standards, MITRE eCTF docs) in `refs`. No blogs when a primary source exists.
- Name the competition year for any eCTF hardware statement. Do not present simulated exercises as official MITRE material.
- Say when something differs between chips (ESP32 vs ESP32-S3 vs C3; Cortex-M4 vs M0+).
- Security material targets intentionally vulnerable simulations or hardware the learner owns. State that where relevant.
- Simulations are labelled automatically; in prose, never describe simulated output as a hardware measurement.

## Style
Plain, direct, second person. Sentence-case headings. Explain *why* before *how*. No filler, no hype.
JS strings: use backtick template literals; escape backticks as \` and `${` as `\${`; C backslashes inside
template literals must be doubled (`\\n`) — or wrap the code in `String.raw\`…\``.
