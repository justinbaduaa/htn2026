# CADEX

![CADEX](public/cadex-logo.png)

**Your CAD engineer. From an idea and a few measurements to validated, printable geometry.**

[View the project on Devpost](https://devpost.com/software/cadex) | [Watch the demo](https://youtu.be/ib4n04WRrVw)

CADEX is a photo-to-print workflow for creating custom parts that fit things in the real world. Start with a prompt and a few reference photos, and CADEX identifies the geometry that matters, shows exactly where to measure, and turns those measurements into a parametric CAD model.

For our Hack the North demo, we used CADEX to design and print a custom case for our badges. To our slight surprise, it fit perfectly: every screw lined up and the case assembled as intended. We also designed a replacement foosball handle and a custom cup holder for problems we found around the venue.

## What it does

1. **Describe the part.** Upload reference photos and explain what you want to build.
2. **Measure what matters.** CADEX returns a structured measurement plan with priorities and visual callouts showing where to place the calipers.
3. **Generate the model.** Enter the requested dimensions and CADEX writes a parametric CadQuery program for the part.
4. **Validate and iterate.** An automated checker verifies the geometry, dimensions, and hole placement. Failed checks are returned to the model so it can revise the design.
5. **Inspect and fabricate.** Preview the result in 3D and export STEP, STL, and, when PrusaSlicer is available, G-code files.

CADEX also derives dimensioned engineering views and IKEA-style assembly instructions from the finished STEP geometry. The result is more than a raw model: it is a design that can be inspected, understood, adjusted, and manufactured.

## How it works

CADEX uses OpenAI in two complementary ways:

- **Responses API for measurement planning.** The Node server sends the uploaded photos as image inputs and uses Zod-backed Structured Outputs to receive predictable, schema-validated JSON. The response describes the proposed parts, required and optional dimensions, measurement priorities, and normalized coordinates for visual callouts. Follow-up measurement questions use the same structured vision path.
- **Codex CLI for agentic CAD generation.** The server launches `codex exec` non-interactively inside an isolated, writable run directory. Codex receives the confirmed measurements and design context, writes `part.py`, runs the Python geometry checker, reads exact failures, and revises the model until the checker passes or it determines that another measurement is required.

This separation is intentional. The Responses API handles the bounded image-to-data step, while Codex CLI provides the filesystem and execution loop needed to write, run, inspect, and repair CAD code.

```text
Prompt + photos
      |
      v
OpenAI Responses API  ->  structured measurement plan + photo callouts
      |
      v
User-entered caliper measurements
      |
      v
Codex CLI  <->  CadQuery program  <->  geometry checker
      |
      v
STEP + STL  ->  Three.js preview, engineering views, instructions
      |
      v
PrusaSlicer  ->  printer-ready G-code
```

Every project is stored on disk with its photos, measurements, generated source, validation results, and fabrication files. Previous successful models and user notes are carried into later runs, making it possible to correct a dimension or describe a failed fit without starting over.

## Validation harness

Photos are useful for understanding an object, but they are not physical ground truth. Perspective, reflections, and hidden features make millimeter-level guessing unsafe, so CADEX asks the user for the fit-critical dimensions and owns fixed rules for clearance, wall thickness, and hole compensation.

Generated models must define one CadQuery solid per printable part. The checker verifies that each model is valid, has a sensible volume and solid count, matches entered outer dimensions within tolerance, and places holes at the expected coordinates and diameters. A passing run exports STEP and STL at manufacturing-friendly tolerances; a failing run gives Codex specific reasons to try again.

## Tech stack

| Layer | Technology |
| --- | --- |
| Web app | React 19, TypeScript, Vite, Tailwind CSS, TanStack Query |
| 3D visualization | Three.js |
| API server | Node.js, Hono, Zod |
| Measurement intelligence | OpenAI Responses API with image inputs and Structured Outputs |
| CAD agent | Codex CLI in workspace-write sandbox mode |
| Geometry | Python 3.12, CadQuery 2.8 |
| Fabrication | PrusaSlicer CLI with an Ender 3 V2 profile |
| Storage | Local project and run directories; no database |

## Local setup

The current development setup targets macOS or Linux. On Windows, use WSL so the Python environment is available at `.venv/bin`.

### Prerequisites

- Node.js with Corepack and pnpm
- Python 3.12
- Codex CLI, authenticated and available as `codex`
- An OpenAI API key
- PrusaSlicer 2.9 or later for G-code export (optional)

### Install

```bash
corepack enable
pnpm install

python3.12 -m venv .venv
.venv/bin/python -m pip install cadquery==2.8.0 pytest==8.4.1

codex login status
```

Create a `.env` file in the repository root:

```dotenv
OPENAI_API_KEY=your_api_key

# Optional overrides
# OPENAI_MODEL=gpt-6-astra
# CODEX_MODEL=gpt-6-astra
# PRUSA_SLICER=/Applications/PrusaSlicer.app/Contents/MacOS/PrusaSlicer
```

`PRUSA_SLICER` may point to the PrusaSlicer executable on another platform. If it is unavailable, CADEX still produces STEP and STL files but skips G-code generation.

### Run

```bash
pnpm dev
```

Open [http://127.0.0.1:5173](http://127.0.0.1:5173). The Hono API runs on port `8787`, and Vite proxies `/api` requests to it.

## Tests

```bash
pnpm typecheck
pnpm exec vitest run
.venv/bin/python -m pytest cad/tests -q
```

The TypeScript tests cover shared schemas, measurement planning, project generation, drawing views, assembly instructions, and UI behavior. The Python tests exercise the geometry checker and STEP measurement extraction against known-good and intentionally incorrect parts.

## Repository structure

```text
src/app/        React workflow, 3D viewer, drawings, and instructions
src/shared/     Shared API types, schemas, annotations, and CAD geometry
server/         Hono API, OpenAI adapter, project storage, and generation loop
cad/            CadQuery checker, geometry extraction, examples, and tests
slicer/         Ender 3 V2 PrusaSlicer profile
docs/           Design specification, pipeline notes, and research
projects/       Generated local projects and run artifacts (gitignored)
```
