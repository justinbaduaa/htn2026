# Photo to print: 27-hour build spec

Written 2026-09-19. Deadline 2026-09-20 evening. Demo target: a printed case screwed onto the Hack the North badge.

## What it does

The user photographs an object, the model says which dimensions matter for fit and where to measure them, the user enters caliper readings, the model writes CadQuery until a checker passes, and the app hands back STEP, STL, G-code for an Ender 3 V2, and a print plan. Projects live on disk so a failed print can be reopened, annotated, and regenerated.

Not in this build: scanning, marker-mat photo, illustrated assembly, version tree, hosting, accounts, other printers. See docs/pipeline.md for the full list and docs/research.md for why.

## Principles

- Measurements come from the user, never from the model. The model decides what to ask for. The user decides the number.
- A fit-critical dimension without a reading blocks generation. A cosmetic dimension gets a stated default the user can edit.
- The checker validates that the part matches the entered dimensions. It cannot validate that the dimensions match reality. Calipers do that.
- Clearance and hole compensation are constants the app owns. The model is told the numbers, it does not choose them.

## Stack

Vite, React, TypeScript, Tailwind for the app. A Hono server on Node for the API and model orchestration. Python 3.12 venv with CadQuery 2.8.0 for generation and checking. Codex CLI (the user's ChatGPT login, no API key) handles photo analysis, measurement guidance and iterative CAD generation in a local sandbox. Setting PLANNER=responses with an OPENAI_API_KEY routes photo analysis through the OpenAI Responses API instead. PrusaSlicer 2.9.6 CLI produces G-code. Three.js powers the viewer. No database.

All model calls go through one adapter. `plan(photos, prompt)` and measurement clarifications are read-only Codex calls with schema-validated output (or Responses API calls when PLANNER=responses). `generate(runDir, prompt)` uses Codex CLI because it needs a filesystem, Python execution, and an iterative check-and-repair loop. Nothing outside the adapter needs to know which transport powers each stage.

Shared types (plan, dimension, run, check result) and the API client live in `src/shared/` with no browser or Node imports, so a React Native capture app can reuse them later.

## Project layout on disk

```
projects/<id>/
  project.json          title, created, notes, plan, dimensions, runs[]
  photos/<n>.jpg
  runs/<n>/
    dims.json           what the model was given
    part.py             what it wrote
    check.json          checker result
    <part>.step / .stl / .gcode   one set per printed part
    needs.json          present only if the model stopped to ask for a measurement
```

## Flow

### 1. New project

Upload two to four photos. Server resizes to 1600 px max side, stores them, creates the project.

### 2. Plan and dimension request

One Responses API call with the photos attached and a Zod-backed structured output schema. The prompt says: identify the object, propose the part or parts to print, list the dimensions needed for fit, mark each as critical or cosmetic, and for each give a callout box on one photo showing where to put the calipers. Cap of 12 dimensions. Critical means it affects whether the part fits: outline, hole centers, hole diameters, tallest component, mating surfaces. Everything else is cosmetic with a default in millimeters.

Schema:

```
{
  title, summary,
  parts: [{ name, printed: boolean, purpose }],
  dimensions: [{
    id, name, why, critical: boolean,
    photo: number, box: { x, y, w, h },   // normalized 0..1
    default_mm: number | null
  }],
  question: string   // non-empty only if the photos are unusable
}
```

The UI shows each photo with SVG boxes drawn over it. Clicking a box focuses its input. Critical inputs are required. Cosmetic inputs are prefilled with the default.

### 3. Caliper entry

A form of dimension inputs in millimeters. Generate is disabled until every critical dimension has a value. The user can add a dimension the model did not ask for, with a name and value. Saved to project.json on every change.

### 4. Generate

Server writes `runs/<n>/dims.json` from the form plus the app-owned constants:

```
{ "fit_clearance_mm": 0.3, "hole_compensation_mm": 0.2, "wall_mm": 2.4, "screw": "M4" }
```

Then runs `codex exec` in that folder with sandbox workspace-write, the venv on PATH, and a prompt that includes: dims.json, the plan from step 2, the previous run's part.py and the user's notes if this is a retry, five worked CadQuery examples, the failure-pattern list, and the instruction to write part.py and run `python check.py` until check.json reports ok. Timeout 8 minutes.

part.py must define `parts: dict[str, cq.Workplane]`, one entry per printed part, in millimeters, Z up, each sitting on Z=0 in its print orientation.

If the model finds it needs a measurement that is not in dims.json, it writes needs.json in the same shape as the dimensions array from step 2 and exits without producing parts. The server returns those to the UI, which adds them to the form as critical and waits for the user. This is the mid-generation clarification path.

### 5. Checker

`check.py` executes part.py and, for each part: `isValid()`, exactly one solid, volume above a floor, bounding box within 0.5 mm of any dimension in dims.json tagged as an outer extent, and a circle edge within 0.2 mm of each hole center in dims.json with radius matching the hole diameter plus compensation. Writes check.json with per-part pass/fail and reasons. On pass, exports `<part>.step` and `<part>.stl` at 0.01 mm tolerance.

The server trusts check.json only if it exists, parses, and every part passed. Anything else is a failed run shown to the user with the checker's reasons and a retry button.

### 6. Output

Three.js viewer loads each STL. Server runs PrusaSlicer per STL with the committed `slicer/ender3v2.ini` and stores the G-code. The page shows a print plan: each part, its file, orientation note, estimated time from the G-code header, and which parts are not printed (screws). Download buttons for STEP, STL, G-code, and a zip of the run.

### 7. Retry

Project page has a notes box. "It didn't fit, the holes are 0.5 mm too far apart" plus edited dimensions, then Generate again. The new run gets the previous part.py and the notes. Runs are listed with their check result so the user can go back to any of them.

## API

```
POST /projects                    photos -> { id }
POST /projects/:id/plan           -> plan + dimensions (step 2)
PUT  /projects/:id/dimensions     values
POST /projects/:id/generate       -> run id; poll GET /projects/:id/runs/:n
GET  /projects                    list
GET  /projects/:id                full project.json
GET  /projects/:id/runs/:n/files/:name
```

Generate is one at a time per server. A second request while one runs returns 409.

## Tests

- check.py against a committed known-good part.py and dims.json: passes. Against a part with a shifted hole: fails with the hole reason. Two tests, run with pytest.
- One UI check with a canned plan response and a canned run folder, verifying the callout boxes render, critical dimensions block Generate, and the viewer loads the STL.

No tests for Codex output quality. That is checked by printing the badge case.

## Schedule

| Hour | Milestone |
|---|---|
| 0 to 3 | Repo, venv with CadQuery, check.py with tests, PrusaSlicer config exported and committed, Codex smoke test producing one STEP from a hand-written dims.json. |
| 3 to 8 | Server: projects on disk, plan call, generate call, slice. |
| 8 to 14 | UI: upload, callouts, dimension form, viewer, downloads, project list. |
| 14 | First badge case print starts. |
| 14 to 20 | Retry flow, print plan, notes. Fix whatever the first print showed. |
| 20 to 24 | Second print if needed. Polish the demo path only. |
| 24 to 27 | Buffer. Marker-mat photo only if everything above is done by hour 20. |

## Risks

- Codex in workspace-write refuses or wanders. Mitigation: `--ask-for-approval never`, the folder contains only what it needs, prompt says do not touch anything outside the folder.
- CadQuery install fails on the demo machine. Mitigation: pin cadquery==2.8.0, install in hour 0, keep the venv in the repo's .gitignore but never delete it.
- The model's callout boxes land in the wrong place. Mitigation: boxes are hints, the dimension name and "why" text stand alone. User can still measure.
- PrusaSlicer CLI hits the mixed-technology error. Mitigation: pass `--printer-technology FFF`, confirmed in research.
