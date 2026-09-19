# Photo to print implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Photos in, caliper-guided dimensions, Codex writes CadQuery until a checker passes, STEP/STL/G-code out, projects on disk.

**Architecture:** A Hono server owns projects on disk, calls Codex CLI through a small adapter, runs a Python checker, and slices with PrusaSlicer. A Vite React app talks to it over JSON. Shared zod schemas in `src/shared/` are the contract for both and for Codex's output schema.

**Tech Stack:** pnpm, Vite 8, React 19, Tailwind 4, Hono, zod 4, Three.js, React Query, Python 3.12 venv with CadQuery 2.8.0 and pytest, Codex CLI 0.155, PrusaSlicer 2.9.

Spec: `docs/spec.md`. Research: `docs/research.md`.

---

## File map

```
package.json  tsconfig.json  vite.config.ts  index.html
src/main.tsx                  mounts App, React Query provider
src/style.css                 tailwind import, dark base
src/shared/types.ts           zod schemas: plan, dimension, dims file, check result, project, run
src/shared/api.ts             fetch client, no DOM/Node imports beyond fetch
src/app/App.tsx               router by hash: list, new, project
src/app/ProjectList.tsx
src/app/NewProject.tsx        photo upload
src/app/ProjectPage.tsx       photos+callouts, form, generate, runs
src/app/PhotoCallouts.tsx     image with SVG boxes
src/app/DimensionForm.tsx
src/app/RunPanel.tsx          run status, print plan, downloads
src/app/Viewer.tsx            three.js STL viewer
server/index.ts               hono app, routes
server/store.ts               project folders on disk
server/model.ts               ModelAdapter interface + codex impl + mock impl
server/prompts.ts             plan prompt, generate prompt, constants
server/generate.ts            run folder setup, codex call, check.json verification, slicing
server/slice.ts               prusa-slicer wrapper
cad/check.py                  checker, run by Codex inside a run folder
cad/examples/01_box_case.py ... 05_two_part_case.py
cad/tests/test_check.py, cad/tests/fixtures/
slicer/ender3v2.ini           flat PrusaSlicer config
slicer/flatten.py             resolves `inherits` from the Creality bundle
mock/plan.json  mock/run/     canned model outputs for UI work and demo fallback
scripts/smoke-codex.sh        one generate run from a hand-written dims.json
projects/                     gitignored
```

---

### Task 0: Prerequisites on this machine

**Files:** none

- [ ] **Step 1: Codex auth.** Copy Justin's `auth.json` into `~/.codex/auth.json` (or set `CODEX_HOME` to a folder that has it). Verify:

Run: `codex login status`
Expected: `Logged in` (any account line)

- [ ] **Step 2: PrusaSlicer.**

Run: `brew install --cask prusaslicer && ls /Applications/PrusaSlicer.app/Contents/MacOS/PrusaSlicer`
Expected: path prints. CLI binary is that path.

- [ ] **Step 3: Python venv.**

Run: `uv venv --python 3.12 .venv && uv pip install --python .venv/bin/python cadquery==2.8.0 pytest==8.4.1 && .venv/bin/python -c "import cadquery as cq; print(cq.__version__)"`
Expected: `2.8.0`

---

### Task 1: Scaffold app and server

**Files:**
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`, `index.html`, `src/main.tsx`, `src/style.css`, `src/app/App.tsx`, `server/index.ts`, `.gitignore` (modify)

- [ ] **Step 1: package.json**

```json
{
  "name": "photo-to-print",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "concurrently -k \"pnpm dev:server\" \"pnpm dev:web\"",
    "dev:web": "vite --host 127.0.0.1",
    "dev:server": "tsx watch server/index.ts",
    "typecheck": "tsc --noEmit",
    "test": "vitest run && .venv/bin/python -m pytest cad/tests -q"
  },
  "dependencies": {
    "@hono/node-server": "^1.15.0",
    "@tanstack/react-query": "^5.90.0",
    "hono": "^4.10.0",
    "react": "^19.3.0",
    "react-dom": "^19.3.0",
    "three": "^0.186.0",
    "zod": "^4.6.5"
  },
  "devDependencies": {
    "@tailwindcss/vite": "^4.2.0",
    "@types/node": "^26.6.1",
    "@types/react": "^19.3.0",
    "@types/react-dom": "^19.3.0",
    "@types/three": "^0.186.0",
    "@vitejs/plugin-react": "^5.0.0",
    "concurrently": "^9.2.0",
    "tailwindcss": "^4.2.0",
    "tsx": "^4.20.0",
    "typescript": "^7.0.2",
    "vite": "^8.3.0",
    "vitest": "^3.2.0"
  }
}
```

- [ ] **Step 2: tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2023", "module": "ESNext", "moduleResolution": "bundler",
    "jsx": "react-jsx", "strict": true, "noUncheckedIndexedAccess": true,
    "allowImportingTsExtensions": true, "noEmit": true, "skipLibCheck": true,
    "types": ["node", "vite/client"]
  },
  "include": ["src", "server", "vite.config.ts"]
}
```

- [ ] **Step 3: vite.config.ts**

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { proxy: { '/api': 'http://127.0.0.1:8787' } },
});
```

- [ ] **Step 4: index.html, src/main.tsx, src/style.css, src/app/App.tsx**

index.html:
```html
<!doctype html>
<html lang="en" class="dark">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Photo to print</title></head>
<body class="bg-neutral-950 text-white"><div id="root"></div><script type="module" src="/src/main.tsx"></script></body>
</html>
```

src/style.css:
```css
@import "tailwindcss";
```

src/main.tsx:
```tsx
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App } from './app/App';
import './style.css';

const client = new QueryClient();
createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={client}><App /></QueryClientProvider>,
);
```

src/app/App.tsx (placeholder until Task 7):
```tsx
export function App() {
  return <main className="p-6">Photo to print</main>;
}
```

- [ ] **Step 5: server/index.ts**

```ts
import { Hono } from 'hono';
import { serve } from '@hono/node-server';

export const app = new Hono();
app.get('/api/health', c => c.json({ ok: true }));

serve({ fetch: app.fetch, port: 8787 }, () => console.log('server on 8787'));
```

- [ ] **Step 6: .gitignore additions**

```
node_modules/
dist/
.context/
.venv/
projects/
.env*
!.env.example
```

- [ ] **Step 7: install and run**

Run: `pnpm install && pnpm typecheck && (pnpm dev:server & sleep 2; curl -s 127.0.0.1:8787/api/health; kill %1)`
Expected: `{"ok":true}`

- [ ] **Step 8: Commit**

```bash
git add -A && git commit -m "chore: scaffold vite app and hono server"
```

---

### Task 2: Shared types

**Files:**
- Create: `src/shared/types.ts`, `src/shared/types.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { expect, test } from 'vitest';
import { planSchema, dimsFileSchema } from './types';

test('plan schema rejects a dimension with no callout', () => {
  const bad = { title: 't', summary: 's', parts: [], question: '', dimensions: [{ id: 'a', name: 'n', why: 'w', critical: true, kind: 'extent_x', photo: 0, default_mm: null }] };
  expect(planSchema.safeParse(bad).success).toBe(false);
});

test('dims file requires values on critical dimensions', () => {
  const dims = { title: 't', plan: { title: 't', summary: 's', parts: [], question: '', dimensions: [] },
    dimensions: [{ id: 'a', name: 'n', kind: 'hole_x', hole: 'h1', value_mm: 12.5 }],
    constants: { fit_clearance_mm: 0.3, hole_compensation_mm: 0.2, wall_mm: 2.4 } };
  expect(dimsFileSchema.safeParse(dims).success).toBe(true);
});
```

- [ ] **Step 2: Run it**

Run: `pnpm vitest run src/shared`
Expected: FAIL, cannot resolve `./types`

- [ ] **Step 3: Write src/shared/types.ts**

```ts
import { z } from 'zod';

// Kinds the checker understands. `other` is only passed through to the model.
export const dimensionKind = z.enum(['extent_x', 'extent_y', 'extent_z', 'hole_diameter', 'hole_x', 'hole_y', 'other']);

export const requestedDimensionSchema = z.strictObject({
  id: z.string().min(1).max(40),
  name: z.string().max(80),
  why: z.string().max(200),
  critical: z.boolean(),
  kind: dimensionKind,
  hole: z.string().max(20).nullable(),   // groups hole_x, hole_y, hole_diameter for one hole
  photo: z.number().int().min(0),
  box: z.strictObject({ x: z.number().min(0).max(1), y: z.number().min(0).max(1), w: z.number().min(0).max(1), h: z.number().min(0).max(1) }),
  default_mm: z.number().nullable(),
});

export const planSchema = z.strictObject({
  title: z.string().max(100),
  summary: z.string().max(800),
  parts: z.array(z.strictObject({ name: z.string().max(60), printed: z.boolean(), purpose: z.string().max(200) })).max(8),
  dimensions: z.array(requestedDimensionSchema).max(12),
  question: z.string().max(400),   // non-empty only when photos are unusable
});
export type Plan = z.infer<typeof planSchema>;
export type RequestedDimension = z.infer<typeof requestedDimensionSchema>;

// What the user entered. Model-requested dimensions keep their id; user-added ones get `user_<n>`.
export const enteredDimensionSchema = z.strictObject({
  id: z.string(),
  name: z.string(),
  kind: dimensionKind,
  hole: z.string().nullable().default(null),
  value_mm: z.number().positive(),
});
export const constantsSchema = z.strictObject({ fit_clearance_mm: z.number(), hole_compensation_mm: z.number(), wall_mm: z.number() });
export const dimsFileSchema = z.strictObject({
  title: z.string(),
  plan: planSchema,
  dimensions: z.array(enteredDimensionSchema),
  constants: constantsSchema,
  notes: z.string().default(''),
});
export type DimsFile = z.infer<typeof dimsFileSchema>;

export const checkResultSchema = z.strictObject({
  ok: z.boolean(),
  parts: z.array(z.strictObject({ name: z.string(), ok: z.boolean(), reasons: z.array(z.string()), volume_mm3: z.number(), bbox_mm: z.tuple([z.number(), z.number(), z.number()]) })),
  error: z.string().nullable(),
});
export type CheckResult = z.infer<typeof checkResultSchema>;

// Written by the model when it needs a measurement it does not have.
export const needsFileSchema = z.strictObject({ dimensions: z.array(requestedDimensionSchema).min(1).max(6) });

export const runSchema = z.strictObject({
  n: z.number().int(),
  started: z.string(),
  status: z.enum(['running', 'needs_dimensions', 'failed', 'done']),
  error: z.string().nullable(),
  check: checkResultSchema.nullable(),
  needs: z.array(requestedDimensionSchema).nullable(),
  files: z.array(z.strictObject({ part: z.string(), step: z.string(), stl: z.string(), gcode: z.string().nullable(), minutes: z.number().nullable() })),
});
export type Run = z.infer<typeof runSchema>;

export const projectSchema = z.strictObject({
  id: z.string(),
  title: z.string(),
  created: z.string(),
  photos: z.array(z.string()),
  plan: planSchema.nullable(),
  values: z.record(z.string(), z.number()),          // dimension id -> mm
  extra: z.array(enteredDimensionSchema),            // user-added dimensions
  notes: z.string(),
  runs: z.array(runSchema),
});
export type Project = z.infer<typeof projectSchema>;
```

- [ ] **Step 4: Run tests**

Run: `pnpm vitest run src/shared`
Expected: 2 passed

- [ ] **Step 5: Commit**

```bash
git add src/shared && git commit -m "feat: shared schemas for plan, dimensions, runs, projects"
```

---

### Task 3: Checker

**Files:**
- Create: `cad/check.py`, `cad/tests/test_check.py`, `cad/tests/fixtures/dims.json`, `cad/tests/fixtures/good_part.py`, `cad/tests/fixtures/shifted_hole.py`

Coordinate rule, repeated in the prompt: the object's outline corner is at X=0, Y=0; hole_x/hole_y in dims.json are in that frame; every printed part sits on Z=0 in its print orientation. The checker looks for circle edges at those XY coordinates, ignoring Z.

- [ ] **Step 1: Fixtures**

cad/tests/fixtures/dims.json:
```json
{
  "title": "Test plate",
  "plan": { "title": "Test plate", "summary": "", "parts": [{ "name": "plate", "printed": true, "purpose": "" }], "dimensions": [], "question": "" },
  "dimensions": [
    { "id": "w", "name": "board width", "kind": "extent_x", "hole": null, "value_mm": 60 },
    { "id": "h", "name": "board height", "kind": "extent_y", "hole": null, "value_mm": 40 },
    { "id": "h1x", "name": "hole 1 x", "kind": "hole_x", "hole": "h1", "value_mm": 5 },
    { "id": "h1y", "name": "hole 1 y", "kind": "hole_y", "hole": "h1", "value_mm": 5 },
    { "id": "h1d", "name": "hole 1 diameter", "kind": "hole_diameter", "hole": "h1", "value_mm": 4 }
  ],
  "constants": { "fit_clearance_mm": 0.3, "hole_compensation_mm": 0.2, "wall_mm": 2.4 },
  "notes": ""
}
```

cad/tests/fixtures/good_part.py:
```python
import cadquery as cq
plate = cq.Workplane("XY").box(64, 44, 3, centered=False).translate((-2, -2, 0))
plate = plate.faces(">Z").workplane().pushPoints([(5, 5)]).hole(4.2)
parts = {"plate": plate}
```

cad/tests/fixtures/shifted_hole.py: same as good_part.py with `pushPoints([(6, 5)])`.

- [ ] **Step 2: Write the failing tests**

cad/tests/test_check.py:
```python
import json, shutil, subprocess, sys
from pathlib import Path

HERE = Path(__file__).parent
CHECK = HERE.parent / "check.py"

def run(tmp_path, part_file):
    shutil.copy(HERE / "fixtures" / "dims.json", tmp_path / "dims.json")
    shutil.copy(HERE / "fixtures" / part_file, tmp_path / "part.py")
    subprocess.run([sys.executable, str(CHECK)], cwd=tmp_path, check=False, capture_output=True)
    return json.loads((tmp_path / "check.json").read_text())

def test_good_part_passes_and_exports(tmp_path):
    result = run(tmp_path, "good_part.py")
    assert result["ok"], result
    assert (tmp_path / "plate.step").exists() and (tmp_path / "plate.stl").exists()

def test_shifted_hole_fails_with_reason(tmp_path):
    result = run(tmp_path, "shifted_hole.py")
    assert not result["ok"]
    assert any("h1" in r for r in result["parts"][0]["reasons"])
```

- [ ] **Step 3: Run**

Run: `.venv/bin/python -m pytest cad/tests -q`
Expected: 2 failed (check.json missing)

- [ ] **Step 4: Write cad/check.py**

```python
"""Checks part.py against dims.json in the current folder, writes check.json, exports STEP and STL on pass.

Run by Codex inside a run folder. Exit code 0 on pass, 1 on any failure. Never raises.
"""
import json, math, sys, traceback
from pathlib import Path

HOLE_TOL = 0.2      # mm, center and radius
EXTENT_TOL = 0.5    # mm
MIN_VOLUME = 50.0   # mm^3

def load_part(path):
    ns = {}
    exec(compile(path.read_text(), str(path), "exec"), ns)
    parts = ns.get("parts")
    if not isinstance(parts, dict) or not parts:
        raise ValueError("part.py must define parts: dict[str, cq.Workplane] with at least one entry")
    return parts

def holes_from(dims):
    groups = {}
    for d in dims:
        if d["hole"] and d["kind"] in ("hole_x", "hole_y", "hole_diameter"):
            groups.setdefault(d["hole"], {})[d["kind"]] = d["value_mm"]
    return {k: v for k, v in groups.items() if {"hole_x", "hole_y", "hole_diameter"} <= v.keys()}

def check_part(name, wp, dims, holes, comp):
    reasons = []
    solids = wp.solids().vals()
    if len(solids) != 1:
        reasons.append(f"{name}: expected 1 solid, got {len(solids)}")
    shape = wp.val()
    if not shape.isValid():
        reasons.append(f"{name}: shape is not valid (BRepCheck)")
    volume = float(shape.Volume())
    if volume < MIN_VOLUME:
        reasons.append(f"{name}: volume {volume:.1f} mm^3 is below {MIN_VOLUME}")
    bb = shape.BoundingBox()
    bbox = (bb.xlen, bb.ylen, bb.zlen)
    if bb.zmin < -0.01:
        reasons.append(f"{name}: part goes below Z=0 (zmin {bb.zmin:.2f}); place it on the bed")
    circles = [(e.arcCenter(), e.radius()) for e in wp.edges("%CIRCLE").vals()]
    for hid, h in holes.items():
        want_r = (h["hole_diameter"] + comp) / 2
        hit = any(abs(r - want_r) <= HOLE_TOL and math.hypot(c.x - h["hole_x"], c.y - h["hole_y"]) <= HOLE_TOL for c, r in circles)
        if not hit:
            reasons.append(f"{name}: no circle edge for hole {hid} at ({h['hole_x']}, {h['hole_y']}) with diameter {h['hole_diameter'] + comp:.2f} (diameter {h['hole_diameter']} plus compensation {comp})")
    return {"name": name, "ok": not reasons, "reasons": reasons, "volume_mm3": volume, "bbox_mm": bbox}

def check_extents(results, dims):
    """The union of printed parts must be at least as big as the object in X and Y."""
    reasons = []
    for axis, i in (("extent_x", 0), ("extent_y", 1)):
        for d in dims:
            if d["kind"] == axis and max(r["bbox_mm"][i] for r in results) + EXTENT_TOL < d["value_mm"]:
                reasons.append(f"parts are smaller than object {axis} {d['value_mm']} mm")
    return reasons

def main():
    out = {"ok": False, "parts": [], "error": None}
    try:
        dims = json.loads(Path("dims.json").read_text())
        parts = load_part(Path("part.py"))
        holes = holes_from(dims["dimensions"])
        comp = dims["constants"]["hole_compensation_mm"]
        results = [check_part(name, wp, dims["dimensions"], holes, comp) for name, wp in parts.items()]
        # holes only need to exist in one part; drop hole reasons from parts if any part has the hole
        for hid in holes:
            if any(not any(hid in r for r in res["reasons"]) for res in results):
                for res in results:
                    res["reasons"] = [r for r in res["reasons"] if f"hole {hid} " not in r]
                    res["ok"] = not res["reasons"]
        extent_reasons = check_extents(results, dims["dimensions"])
        if extent_reasons and results:
            results[0]["reasons"].extend(extent_reasons); results[0]["ok"] = False
        out["parts"] = results
        out["ok"] = all(r["ok"] for r in results)
        if out["ok"]:
            for name, wp in parts.items():
                wp.export(f"{name}.step")
                wp.export(f"{name}.stl", tolerance=0.01, angularTolerance=0.1)
    except Exception:
        out["error"] = traceback.format_exc(limit=6)
    Path("check.json").write_text(json.dumps(out, indent=2))
    print(json.dumps(out, indent=2))
    sys.exit(0 if out["ok"] else 1)

if __name__ == "__main__":
    main()
```

- [ ] **Step 5: Run tests**

Run: `.venv/bin/python -m pytest cad/tests -q`
Expected: 2 passed

- [ ] **Step 6: Commit**

```bash
git add cad && git commit -m "feat: cadquery checker with hole and extent validation"
```

---

### Task 4: Worked examples and prompts

**Files:**
- Create: `cad/examples/01_plate_with_holes.py`, `02_tray_case.py`, `03_two_part_case.py`, `04_standoffs.py`, `05_cutouts.py`, `server/prompts.ts`

- [ ] **Step 1: Examples.** Each file is a complete part.py in the coordinate convention. Contents:

01_plate_with_holes.py:
```python
# Flat plate under a 60x40 board with two M4 holes. Object corner at (0,0). Plate sits on Z=0.
import cadquery as cq
W, H, T = 60, 40, 3
CL, WALL = 0.3, 2.4
plate = cq.Workplane("XY").box(W + 2*WALL, H + 2*WALL, T, centered=False).translate((-WALL, -WALL, 0))
plate = plate.faces(">Z").workplane().pushPoints([(5, 5), (55, 35)]).hole(4 + 0.2)
parts = {"plate": plate}
```

02_tray_case.py:
```python
# Open-top tray the board drops into. Floor 2.4, walls 2.4, inner size = board + clearance.
import cadquery as cq
W, H, D = 60, 40, 12          # board width, height, tallest component
CL, WALL = 0.3, 2.4
outer = cq.Workplane("XY").box(W + 2*CL + 2*WALL, H + 2*CL + 2*WALL, D + WALL, centered=False).translate((-CL - WALL, -CL - WALL, 0))
inner = cq.Workplane("XY").box(W + 2*CL, H + 2*CL, D + 1, centered=False).translate((-CL, -CL, WALL))
tray = outer.cut(inner)
tray = tray.faces("<Z").workplane().pushPoints([(5, 5), (55, 35)]).hole(4 + 0.2)   # screw holes through the floor
tray = tray.edges("|Z").fillet(2)
parts = {"tray": tray}
```

03_two_part_case.py:
```python
# Base plate plus lid, screwed together through the board's holes. Both parts on Z=0 in print orientation.
import cadquery as cq
W, H, D = 60, 40, 12
CL, WALL = 0.3, 2.4
HOLES = [(5, 5), (55, 35)]
base = cq.Workplane("XY").box(W + 2*CL + 2*WALL, H + 2*CL + 2*WALL, WALL, centered=False).translate((-CL - WALL, -CL - WALL, 0))
base = base.faces(">Z").workplane().pushPoints(HOLES).hole(4 + 0.2)
lid = cq.Workplane("XY").box(W + 2*CL + 2*WALL, H + 2*CL + 2*WALL, D + WALL, centered=False).translate((-CL - WALL, -CL - WALL, 0))
lid = lid.cut(cq.Workplane("XY").box(W + 2*CL, H + 2*CL, D + 1, centered=False).translate((-CL, -CL, -1)))   # open bottom, printed upside down so its top is on the bed
lid = lid.faces(">Z").workplane().pushPoints(HOLES).hole(4 + 0.2)
parts = {"base": base, "lid": lid}
```

04_standoffs.py:
```python
# Plate with standoffs so the board floats above it; holes go through standoff and plate.
import cadquery as cq
W, H = 60, 40
CL, WALL, STANDOFF = 0.3, 2.4, 4
HOLES = [(5, 5), (55, 35)]
plate = cq.Workplane("XY").box(W + 2*WALL, H + 2*WALL, WALL, centered=False).translate((-WALL, -WALL, 0))
posts = cq.Workplane("XY").workplane(offset=WALL).pushPoints(HOLES).circle(4).extrude(STANDOFF)
plate = plate.union(posts)
plate = plate.faces(">Z").workplane().pushPoints(HOLES).hole(4 + 0.2)
parts = {"plate": plate}
```

05_cutouts.py:
```python
# Tray with a side cutout for a USB-C port on the +X wall, centered at y=20, 10 wide, 4 tall, floor of cutout 3 above the board floor.
import cadquery as cq
W, H, D = 60, 40, 12
CL, WALL = 0.3, 2.4
outer = cq.Workplane("XY").box(W + 2*CL + 2*WALL, H + 2*CL + 2*WALL, D + WALL, centered=False).translate((-CL - WALL, -CL - WALL, 0))
inner = cq.Workplane("XY").box(W + 2*CL, H + 2*CL, D + 1, centered=False).translate((-CL, -CL, WALL))
tray = outer.cut(inner)
port = cq.Workplane("XY").box(WALL + 2*CL + 2, 10 + 2*CL, 4 + 2*CL, centered=False).translate((W - 1, 20 - 5 - CL, WALL + 3))
tray = tray.cut(port)
parts = {"tray": tray}
```

- [ ] **Step 2: server/prompts.ts**

```ts
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { DimsFile } from '../src/shared/types';

export const constants = { fit_clearance_mm: 0.3, hole_compensation_mm: 0.2, wall_mm: 2.4 };

export const planPrompt = `You are helping someone 3D print a part that fits a real object shown in the attached photos, usually a case, mount, bracket, or replacement piece.
Return JSON matching the schema. Rules:
- Identify the object and propose the printed part or parts. List parts that are NOT printed (screws, the object itself) with printed=false.
- List the dimensions the user must measure with calipers. Mark critical=true for anything that affects fit: outline extents, hole centers, hole diameters, tallest component height, mating surfaces, port positions. Mark critical=false for cosmetic dimensions and give a default_mm.
- Coordinate frame: the object's bottom-left corner in the main photo is X=0,Y=0; X to the right, Y up. Hole positions are measured from that corner. Give hole_x, hole_y, hole_diameter as three dimensions sharing the same hole id.
- kinds: extent_x, extent_y, extent_z (tallest point), hole_x, hole_y, hole_diameter, other.
- For every dimension give photo index and a normalized box (0..1) around where the calipers go. Boxes are hints; the name and why must stand on their own.
- At most 12 dimensions. Prefer fewer. Do not ask for anything you can default safely.
- If the photos are unusable, set question to what you need and leave dimensions empty. Otherwise question is "".`;

export function generatePrompt(dims: DimsFile, previous: string | null) {
  const examples = readdirSync(join(process.cwd(), 'cad/examples')).sort()
    .map(f => `### ${f}\n\`\`\`python\n${readFileSync(join(process.cwd(), 'cad/examples', f), 'utf8')}\`\`\``).join('\n\n');
  return `Write part.py in this folder: CadQuery code that builds the printed part(s) for the object described in dims.json, then run \`python check.py\` and fix part.py until check.json says ok=true. The venv on PATH has cadquery 2.8.0.

Contract for part.py:
- Define parts: dict[str, cq.Workplane], one entry per printed part, keys matching the plan's printed part names in snake_case.
- Millimeters, Z up. Each part sits on Z=0 in the orientation it will be printed. A lid with an open bottom is printed upside down, so model it with its closed face on Z=0.
- The object's outline corner is X=0,Y=0. hole_x/hole_y in dims.json are in that frame. Every hole in dims.json must exist in at least one part at those XY coordinates with diameter = hole_diameter + hole_compensation_mm.
- Add fit_clearance_mm around the object where it sits inside a part. Walls are wall_mm unless a dimension says otherwise.
- One solid per part. No threads. Fillets only on outer vertical edges and only if the wall allows the radius.
- Do not write any other files. Do not read anything outside this folder. Do not use network.

If you need a measurement that dims.json does not have and cannot default safely, write needs.json as {"dimensions":[{id,name,why,critical:true,kind,hole,photo:0,box:{x,y,w,h},default_mm:null}]} and stop without writing part.py.

Common failures to avoid: wrong workplane or cut direction; fillet radius larger than the wall; calling methods that do not exist (there is no .cone() or .array()); filleting before a solid exists; holes at the wrong coordinates because a box was centered; parts that touch at an edge instead of overlapping.

dims.json:
\`\`\`json
${JSON.stringify(dims, null, 2)}
\`\`\`
${previous ? `\nPrevious part.py (the user's notes above say what was wrong with it; keep what worked):\n\`\`\`python\n${previous}\`\`\`\n` : ''}
Worked examples in the same contract:

${examples}`;
}
```

- [ ] **Step 3: Verify every example passes its own checker contract**

Run: `for f in cad/examples/*.py; do d=$(mktemp -d); cp $f $d/part.py; cp cad/tests/fixtures/dims.json $d/dims.json; (cd $d && ../../..$(pwd | sed "s|$d||")/.venv/bin/python $(pwd)/cad/check.py >/dev/null; echo "$f $?"); done`

Simpler: run each in a temp folder with the fixture dims and the checker, expect exit 0 for 01, 02, 03, 04 (holes at 5,5 and 55,35 with diameter 4). Example 05 has no holes matching the fixture, so expect exit 1 with hole reasons only. If an example fails for another reason, fix the example.

- [ ] **Step 4: Commit**

```bash
git add cad/examples server/prompts.ts && git commit -m "feat: worked cadquery examples and model prompts"
```

---

### Task 5: Model adapter

**Files:**
- Create: `server/model.ts`

- [ ] **Step 1: Write server/model.ts**

```ts
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, writeFile, rm, cp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { z } from 'zod';
import { planSchema, type Plan } from '../src/shared/types';

const run = promisify(execFile);
const MODEL = process.env.CODEX_MODEL ?? 'gpt-6-astra';
const VENV_BIN = join(process.cwd(), '.venv', 'bin');

export interface ModelAdapter {
  /** Photos in, plan out. Read-only, structured. */
  plan(photoPaths: string[], prompt: string): Promise<Plan>;
  /** Runs inside runDir with write access; returns when the model stops. Caller inspects the folder. */
  generate(runDir: string, prompt: string, signal: AbortSignal): Promise<void>;
}

const baseFlags = ['--ask-for-approval', 'never', 'exec', '--ignore-user-config', '--ephemeral', '--skip-git-repo-check',
  '--disable', 'multi_agent', '--disable', 'skill_search', '-c', 'web_search="disabled"', '-c', 'project_doc_max_bytes=0', '--model', MODEL];

export const codex: ModelAdapter = {
  async plan(photoPaths, prompt) {
    const dir = await mkdtemp(join(tmpdir(), 'plan-'));
    try {
      const { $schema, ...schema } = z.toJSONSchema(planSchema);
      const schemaPath = join(dir, 'schema.json'), out = join(dir, 'out.json');
      await writeFile(schemaPath, JSON.stringify(schema));
      const images = photoPaths.flatMap(p => ['--image', p]);
      await run('codex', [...baseFlags, '--sandbox', 'read-only', '--disable', 'shell_tool', '-c', 'model_reasoning_effort="medium"',
        '--cd', dir, '--output-schema', schemaPath, '--output-last-message', out, prompt, ...images], { timeout: 240_000, maxBuffer: 4_000_000 });
      return planSchema.parse(JSON.parse(await readFile(out, 'utf8')));
    } finally { await rm(dir, { recursive: true, force: true }); }
  },
  async generate(runDir, prompt, signal) {
    await run('codex', [...baseFlags, '--sandbox', 'workspace-write', '-c', 'model_reasoning_effort="high"', '--cd', runDir,
      '--output-last-message', join(runDir, 'last.md'), prompt],
      { timeout: 480_000, maxBuffer: 8_000_000, signal, env: { ...process.env, PATH: `${VENV_BIN}:${process.env.PATH}` } });
  },
};

/** Canned outputs from mock/ for UI work and as a demo fallback. MODEL=mock in .env.local. */
export const mock: ModelAdapter = {
  async plan() { return planSchema.parse(JSON.parse(await readFile('mock/plan.json', 'utf8'))); },
  async generate(runDir) { await cp('mock/run', runDir, { recursive: true }); },
};

export const model: ModelAdapter = process.env.MODEL === 'mock' ? mock : codex;
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add server/model.ts && git commit -m "feat: codex and mock model adapters"
```

---

### Task 6: Store, generate, slice, routes

**Files:**
- Create: `server/store.ts`, `server/slice.ts`, `server/generate.ts`, `slicer/flatten.py`, `slicer/ender3v2.ini`
- Modify: `server/index.ts`

- [ ] **Step 1: server/store.ts**

```ts
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { projectSchema, type Project } from '../src/shared/types';

export const ROOT = join(process.cwd(), 'projects');
export const dir = (id: string) => join(ROOT, id);
export const runDir = (id: string, n: number) => join(dir(id), 'runs', String(n));

export async function list(): Promise<Project[]> {
  await mkdir(ROOT, { recursive: true });
  const ids = (await readdir(ROOT, { withFileTypes: true })).filter(d => d.isDirectory()).map(d => d.name);
  const projects = await Promise.all(ids.map(id => load(id).catch(() => null)));
  return projects.filter((p): p is Project => p !== null).sort((a, b) => b.created.localeCompare(a.created));
}

export async function load(id: string): Promise<Project> {
  return projectSchema.parse(JSON.parse(await readFile(join(dir(id), 'project.json'), 'utf8')));
}

export async function save(project: Project) {
  await mkdir(dir(project.id), { recursive: true });
  await writeFile(join(dir(project.id), 'project.json'), JSON.stringify(project, null, 2));
}

export async function create(photos: { name: string; data: Uint8Array }[]): Promise<Project> {
  const id = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  await mkdir(join(dir(id), 'photos'), { recursive: true });
  const names: string[] = [];
  for (const [i, p] of photos.entries()) {
    const name = `${i}.jpg`;
    await writeFile(join(dir(id), 'photos', name), p.data);
    names.push(name);
  }
  const project: Project = { id, title: 'Untitled', created: new Date().toISOString(), photos: names, plan: null, values: {}, extra: [], notes: '', runs: [] };
  await save(project);
  return project;
}
```

Photo resizing is skipped: Codex accepts phone JPEGs directly. If a plan call times out on large photos, add `sharp` here and resize to 1600 px.

- [ ] **Step 2: slicer/flatten.py and slicer/ender3v2.ini**

flatten.py downloads the Creality bundle and resolves `inherits` for the three sections into one flat ini:

```python
"""Builds slicer/ender3v2.ini from PrusaSlicer's Creality vendor bundle. Run once: .venv/bin/python slicer/flatten.py"""
import configparser, urllib.request
from pathlib import Path

URL = "https://raw.githubusercontent.com/prusa3d/PrusaSlicer-settings/master/live/Creality/0.3.0.ini"
PRINTER, PRINT, FILAMENT = "printer:Creality Ender-3 V2 (0.4 mm nozzle)", "print:0.20 mm NORMAL (0.4 mm nozzle) @CREALITY", "filament:Generic PLA @CREALITY"

text = urllib.request.urlopen(URL).read().decode()
cp = configparser.RawConfigParser(strict=False, interpolation=None, delimiters=("=",))
cp.optionxform = str
cp.read_string(text)

def resolve(section):
    prefix = section.split(":")[0]
    out = {}
    chain = []
    while section:
        chain.append(section)
        parent = cp.get(section, "inherits", fallback="")
        section = f"{prefix}:{parent}" if parent else None
    for s in reversed(chain):
        for k, v in cp.items(s):
            if k != "inherits":
                out[k] = v
    return out

flat = {}
for s in (PRINTER, PRINT, FILAMENT):
    flat.update(resolve(s))
flat.pop("printer_model", None); flat.pop("printer_variant", None)
Path(__file__).with_name("ender3v2.ini").write_text("\n".join(f"{k} = {v}" for k, v in sorted(flat.items())) + "\n")
print(f"wrote {len(flat)} keys")
```

Run: `.venv/bin/python slicer/flatten.py`
Expected: `wrote N keys` with N above 200. If the bundle URL or section names have moved, open PrusaSlicer, pick those three profiles, File > Export > Export Config, save as `slicer/ender3v2.ini`.

- [ ] **Step 3: server/slice.ts**

```ts
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const run = promisify(execFile);
const BIN = process.env.PRUSA_SLICER ?? '/Applications/PrusaSlicer.app/Contents/MacOS/PrusaSlicer';
const CONFIG = join(process.cwd(), 'slicer', 'ender3v2.ini');

/** Slices one STL in place. Returns the G-code path and estimated minutes from the file footer, or null if the slicer is unavailable. */
export async function slice(stlPath: string): Promise<{ gcode: string; minutes: number | null } | null> {
  const gcode = stlPath.replace(/\.stl$/, '.gcode');
  try {
    await run(BIN, ['--export-gcode', '--printer-technology', 'FFF', '--load', CONFIG, '--output', gcode, stlPath], { timeout: 180_000 });
  } catch (error) {
    console.error('slice failed', error);
    return null;
  }
  const text = await readFile(gcode, 'utf8');
  const m = /estimated printing time \(normal mode\) = (?:(\d+)h )?(?:(\d+)m )?(?:(\d+)s)?/.exec(text);
  const minutes = m ? Number(m[1] ?? 0) * 60 + Number(m[2] ?? 0) : null;
  return { gcode, minutes };
}
```

- [ ] **Step 4: server/generate.ts**

```ts
import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { checkResultSchema, dimsFileSchema, needsFileSchema, type DimsFile, type Project, type Run } from '../src/shared/types';
import { model } from './model';
import { constants, generatePrompt } from './prompts';
import { slice } from './slice';
import * as store from './store';

let active: string | null = null;
export const isBusy = () => active !== null;

function buildDims(project: Project): DimsFile {
  if (!project.plan) throw new Error('No plan yet');
  const requested = project.plan.dimensions.flatMap(d => {
    const value = project.values[d.id] ?? d.default_mm;
    if (value == null) { if (d.critical) throw new Error(`Missing critical dimension: ${d.name}`); return []; }
    return [{ id: d.id, name: d.name, kind: d.kind, hole: d.hole, value_mm: value }];
  });
  return dimsFileSchema.parse({ title: project.title, plan: project.plan, dimensions: [...requested, ...project.extra], constants, notes: project.notes });
}

/** Starts a run and returns immediately. Progress is written to project.json. */
export async function start(id: string): Promise<Run> {
  if (active) throw new Error('busy');
  const project = await store.load(id);
  const dims = buildDims(project);
  const n = project.runs.length;
  const dirPath = store.runDir(id, n);
  await mkdir(dirPath, { recursive: true });
  await writeFile(join(dirPath, 'dims.json'), JSON.stringify(dims, null, 2));
  await writeFile(join(dirPath, 'check.py'), await readFile(join(process.cwd(), 'cad', 'check.py')));
  const previousRun = [...project.runs].reverse().find(r => r.status === 'done');
  const previous = previousRun ? await readFile(join(store.runDir(id, previousRun.n), 'part.py'), 'utf8').catch(() => null) : null;
  const run: Run = { n, started: new Date().toISOString(), status: 'running', error: null, check: null, needs: null, files: [] };
  project.runs.push(run);
  await store.save(project);
  active = id;
  void execute(id, n, dirPath, dims, previous).finally(() => { active = null; });
  return run;
}

async function execute(id: string, n: number, dirPath: string, dims: DimsFile, previous: string | null) {
  const update = async (patch: Partial<Run>) => {
    const project = await store.load(id);
    project.runs[n] = { ...project.runs[n]!, ...patch };
    await store.save(project);
  };
  try {
    await model.generate(dirPath, generatePrompt(dims, previous), new AbortController().signal);
    const files = await readdir(dirPath);
    if (files.includes('needs.json')) {
      const needs = needsFileSchema.parse(JSON.parse(await readFile(join(dirPath, 'needs.json'), 'utf8')));
      await update({ status: 'needs_dimensions', needs: needs.dimensions });
      return;
    }
    if (!files.includes('check.json')) { await update({ status: 'failed', error: 'The model finished without running the checker.' }); return; }
    const check = checkResultSchema.parse(JSON.parse(await readFile(join(dirPath, 'check.json'), 'utf8')));
    if (!check.ok) { await update({ status: 'failed', check, error: check.error ?? 'Checker rejected the part.' }); return; }
    const outputs: Run['files'] = [];
    for (const part of check.parts) {
      const stl = join(dirPath, `${part.name}.stl`);
      const sliced = await slice(stl);
      outputs.push({ part: part.name, step: `${part.name}.step`, stl: basename(stl), gcode: sliced ? basename(sliced.gcode) : null, minutes: sliced?.minutes ?? null });
    }
    await update({ status: 'done', check, files: outputs });
  } catch (error) {
    await update({ status: 'failed', error: error instanceof Error ? error.message : String(error) });
  }
}
```

- [ ] **Step 5: Routes in server/index.ts**

```ts
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { z } from 'zod';
import { model } from './model';
import { planPrompt } from './prompts';
import * as store from './store';
import * as generate from './generate';
import { enteredDimensionSchema, requestedDimensionSchema } from '../src/shared/types';
import { join } from 'node:path';

export const app = new Hono();
app.get('/api/health', c => c.json({ ok: true, busy: generate.isBusy() }));
app.get('/api/projects', async c => c.json(await store.list()));
app.get('/api/projects/:id', async c => c.json(await store.load(c.req.param('id'))));

app.post('/api/projects', async c => {
  const form = await c.req.formData();
  const files = form.getAll('photos').filter((f): f is File => f instanceof File).slice(0, 4);
  if (files.length === 0) return c.json({ error: 'Add at least one photo.' }, 400);
  const photos = await Promise.all(files.map(async f => ({ name: f.name, data: new Uint8Array(await f.arrayBuffer()) })));
  return c.json(await store.create(photos));
});

app.post('/api/projects/:id/plan', async c => {
  const project = await store.load(c.req.param('id'));
  const paths = project.photos.map(p => join(store.dir(project.id), 'photos', p));
  const plan = await model.plan(paths, planPrompt);
  project.plan = plan; project.title = plan.title;
  await store.save(project);
  return c.json(project);
});

const valuesBody = z.strictObject({ values: z.record(z.string(), z.number()), extra: z.array(enteredDimensionSchema), notes: z.string() });
app.put('/api/projects/:id/dimensions', async c => {
  const body = valuesBody.parse(await c.req.json());
  const project = await store.load(c.req.param('id'));
  Object.assign(project, body);
  await store.save(project);
  return c.json(project);
});

// Adds model-requested extra dimensions (from a needs_dimensions run) to the plan as critical.
app.post('/api/projects/:id/accept-needs/:n', async c => {
  const project = await store.load(c.req.param('id'));
  const run = project.runs[Number(c.req.param('n'))];
  if (!run?.needs || !project.plan) return c.json({ error: 'No pending dimensions.' }, 400);
  const known = new Set(project.plan.dimensions.map(d => d.id));
  project.plan.dimensions.push(...run.needs.filter(d => !known.has(d.id)).map(d => requestedDimensionSchema.parse({ ...d, critical: true })));
  run.needs = null;
  await store.save(project);
  return c.json(project);
});

app.post('/api/projects/:id/generate', async c => {
  if (generate.isBusy()) return c.json({ error: 'A generation is already running.' }, 409);
  try { return c.json(await generate.start(c.req.param('id'))); }
  catch (error) { return c.json({ error: error instanceof Error ? error.message : 'Could not start.' }, 400); }
});

app.use('/api/files/*', serveStatic({ root: './projects', rewriteRequestPath: p => p.replace(/^\/api\/files/, '') }));

serve({ fetch: app.fetch, port: 8787 }, () => console.log('server on 8787'));
```

File URLs are `/api/files/<id>/photos/<name>` and `/api/files/<id>/runs/<n>/<file>`.

- [ ] **Step 6: Mock fixtures for UI work**

mock/plan.json: a plan for a 60x40 board with two M4 holes and one tallest-component dimension, seven dimensions total, boxes anywhere plausible. mock/run/: copy `cad/tests/fixtures/good_part.py` as `part.py`, run the checker in that folder once so `check.json`, `plate.step`, `plate.stl` exist, commit them.

- [ ] **Step 7: End-to-end with the mock**

Run with `MODEL=mock pnpm dev:server` in one terminal, then:
```
id=$(curl -s -F photos=@cad/tests/fixtures/any.jpg 127.0.0.1:8787/api/projects | jq -r .id)
curl -s -X POST 127.0.0.1:8787/api/projects/$id/plan | jq .title
curl -s -X PUT -H 'content-type: application/json' -d '{"values":{"w":60,"h":40,"h1x":5,"h1y":5,"h1d":4},"extra":[],"notes":""}' 127.0.0.1:8787/api/projects/$id/dimensions >/dev/null
curl -s -X POST 127.0.0.1:8787/api/projects/$id/generate | jq .status
sleep 3; curl -s 127.0.0.1:8787/api/projects/$id | jq '.runs[0].status'
```
Expected: `"running"` then `"done"` (or `"failed"` with a slice error if PrusaSlicer is missing, which still counts: files list has gcode null).

Any photo works for the mock; add a small jpg to `mock/` for this.

- [ ] **Step 8: Commit**

```bash
git add server slicer mock && git commit -m "feat: project store, generate pipeline, slicing, api routes"
```

---

### Task 7: UI

**Files:**
- Create: `src/shared/api.ts`, `src/app/ProjectList.tsx`, `src/app/NewProject.tsx`, `src/app/ProjectPage.tsx`, `src/app/PhotoCallouts.tsx`, `src/app/DimensionForm.tsx`, `src/app/RunPanel.tsx`, `src/app/Viewer.tsx`
- Modify: `src/app/App.tsx`

Design rules from Justin: dark, white primary text, dense, no card chrome, no gray subtitle lines, minimal copy, no continuous animations.

- [ ] **Step 1: src/shared/api.ts**

```ts
import { projectSchema, runSchema, type Project, type Run } from './types';

async function json<T>(input: string, init?: RequestInit): Promise<T> {
  const res = await fetch(input, init);
  const body = await res.json();
  if (!res.ok) throw new Error(body.error ?? res.statusText);
  return body as T;
}

export const api = {
  list: () => json<Project[]>('/api/projects').then(p => p.map(x => projectSchema.parse(x))),
  get: (id: string) => json<Project>(`/api/projects/${id}`).then(p => projectSchema.parse(p)),
  create: (photos: File[]) => { const f = new FormData(); photos.forEach(p => f.append('photos', p)); return json<Project>('/api/projects', { method: 'POST', body: f }); },
  plan: (id: string) => json<Project>(`/api/projects/${id}/plan`, { method: 'POST' }),
  saveDimensions: (id: string, body: Pick<Project, 'values' | 'extra' | 'notes'>) =>
    json<Project>(`/api/projects/${id}/dimensions`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  acceptNeeds: (id: string, n: number) => json<Project>(`/api/projects/${id}/accept-needs/${n}`, { method: 'POST' }),
  generate: (id: string) => json<Run>(`/api/projects/${id}/generate`, { method: 'POST' }).then(r => runSchema.parse(r)),
  fileUrl: (id: string, ...parts: string[]) => `/api/files/${id}/${parts.join('/')}`,
};
```

- [ ] **Step 2: App.tsx with hash routing**

```tsx
import { useEffect, useState } from 'react';
import { ProjectList } from './ProjectList';
import { NewProject } from './NewProject';
import { ProjectPage } from './ProjectPage';

function useHash() {
  const [hash, setHash] = useState(location.hash);
  useEffect(() => { const on = () => setHash(location.hash); addEventListener('hashchange', on); return () => removeEventListener('hashchange', on); }, []);
  return hash;
}

export function App() {
  const hash = useHash();
  const id = hash.startsWith('#p/') ? hash.slice(3) : null;
  return (
    <main className="mx-auto max-w-6xl p-6 text-sm">
      <header className="mb-6 flex items-baseline gap-4">
        <a href="#" className="text-base font-semibold">Photo to print</a>
        <a href="#new" className="text-neutral-400 hover:text-white">New</a>
      </header>
      {id ? <ProjectPage id={id} /> : hash === '#new' ? <NewProject /> : <ProjectList />}
    </main>
  );
}
```

- [ ] **Step 3: ProjectList.tsx and NewProject.tsx**

```tsx
// ProjectList.tsx
import { useQuery } from '@tanstack/react-query';
import { api } from '../shared/api';

export function ProjectList() {
  const { data } = useQuery({ queryKey: ['projects'], queryFn: api.list });
  if (!data) return null;
  if (data.length === 0) return <p>No projects. <a className="underline" href="#new">Start one</a>.</p>;
  return (
    <table className="w-full">
      <tbody>{data.map(p => (
        <tr key={p.id} className="border-t border-neutral-800">
          <td className="py-2"><a href={`#p/${p.id}`} className="hover:underline">{p.title}</a></td>
          <td className="text-neutral-400">{p.runs.length} runs</td>
          <td className="text-neutral-400">{p.runs.at(-1)?.status ?? 'no runs'}</td>
        </tr>))}
      </tbody>
    </table>
  );
}
```

```tsx
// NewProject.tsx
import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { api } from '../shared/api';

export function NewProject() {
  const [files, setFiles] = useState<File[]>([]);
  const create = useMutation({ mutationFn: api.create, onSuccess: p => { location.hash = `#p/${p.id}`; } });
  return (
    <form onSubmit={e => { e.preventDefault(); create.mutate(files); }} className="flex flex-col gap-4">
      <label>Photos of the object, 1 to 4, the first one straight on
        <input type="file" accept="image/*" multiple className="mt-2 block" onChange={e => setFiles([...(e.target.files ?? [])].slice(0, 4))} />
      </label>
      <button disabled={files.length === 0 || create.isPending} className="w-fit bg-white px-3 py-1 text-black disabled:opacity-40">Create project</button>
      {create.error && <p className="text-red-400">{create.error.message}</p>}
    </form>
  );
}
```

- [ ] **Step 4: PhotoCallouts.tsx**

```tsx
import type { RequestedDimension } from '../shared/types';

type Props = { src: string; dimensions: RequestedDimension[]; active: string | null; onPick: (id: string) => void };

/** Photo with one SVG box per dimension. Boxes are normalized 0..1 so the SVG viewBox is 0 0 1 1 stretched over the image. */
export function PhotoCallouts({ src, dimensions, active, onPick }: Props) {
  return (
    <div className="relative">
      <img src={src} className="block w-full" alt="" />
      <svg viewBox="0 0 1 1" preserveAspectRatio="none" className="absolute inset-0 h-full w-full">
        {dimensions.map(d => (
          <g key={d.id} onClick={() => onPick(d.id)} className="cursor-pointer">
            <rect x={d.box.x} y={d.box.y} width={d.box.w} height={d.box.h} fill={active === d.id ? 'rgba(255,255,255,0.15)' : 'transparent'}
              stroke={d.critical ? '#fff' : '#888'} strokeWidth={0.004} vectorEffect="non-scaling-stroke" />
          </g>
        ))}
      </svg>
      {dimensions.map(d => (
        <span key={d.id} onClick={() => onPick(d.id)} className="absolute cursor-pointer bg-black/70 px-1 text-xs"
          style={{ left: `${d.box.x * 100}%`, top: `${(d.box.y + d.box.h) * 100}%` }}>{d.name}</span>
      ))}
    </div>
  );
}
```

- [ ] **Step 5: DimensionForm.tsx**

```tsx
import type { Project, RequestedDimension } from '../shared/types';

type Props = {
  project: Project;
  active: string | null;
  onFocus: (id: string) => void;
  onChange: (patch: Pick<Project, 'values' | 'extra' | 'notes'>) => void;
};

export function missingCritical(project: Project): RequestedDimension[] {
  return project.plan?.dimensions.filter(d => d.critical && project.values[d.id] == null) ?? [];
}

export function DimensionForm({ project, active, onFocus, onChange }: Props) {
  const plan = project.plan!;
  const set = (id: string, raw: string) => {
    const values = { ...project.values };
    const v = Number(raw);
    if (raw === '' || Number.isNaN(v)) delete values[id]; else values[id] = v;
    onChange({ values, extra: project.extra, notes: project.notes });
  };
  return (
    <div className="flex flex-col gap-2">
      {plan.dimensions.map(d => (
        <label key={d.id} className={`grid grid-cols-[1fr_6rem] items-center gap-2 px-1 ${active === d.id ? 'bg-neutral-900' : ''}`}>
          <span>
            {d.name}{d.critical && <span className="ml-1 text-neutral-400">required</span>}
            <span className="block text-xs text-neutral-400">{d.why}</span>
          </span>
          <input id={`dim-${d.id}`} type="number" step="0.01" inputMode="decimal" aria-label={d.name} onFocus={() => onFocus(d.id)}
            value={project.values[d.id] ?? (d.default_mm ?? '')} placeholder="mm" onChange={e => set(d.id, e.target.value)}
            className="bg-neutral-900 px-2 py-1 text-right" />
        </label>
      ))}
      <button type="button" className="w-fit text-neutral-400 hover:text-white" onClick={() => {
        const name = prompt('Dimension name');
        const value = Number(prompt('Value in mm'));
        if (name && value > 0) onChange({ values: project.values, extra: [...project.extra, { id: `user_${project.extra.length}`, name, kind: 'other', hole: null, value_mm: value }], notes: project.notes });
      }}>+ add a measurement the model did not ask for</button>
      {project.extra.map(x => <div key={x.id} className="px-1 text-neutral-400">{x.name}: {x.value_mm} mm</div>)}
      <textarea value={project.notes} placeholder="Notes for the next generation, e.g. holes were 0.5 mm too far apart"
        onChange={e => onChange({ values: project.values, extra: project.extra, notes: e.target.value })}
        className="mt-2 min-h-20 bg-neutral-900 p-2" />
    </div>
  );
}
```

`prompt()` is a browser dialog. It is acceptable here because no browser automation runs against this UI; if that changes, replace with two inputs.

- [ ] **Step 6: Viewer.tsx**

```tsx
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

/** Loads each STL URL as a mesh, laid out side by side along X. Renders on demand only (no animation loop). */
export function Viewer({ urls }: { urls: string[] }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current!;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(el.clientWidth, 420); renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene(); scene.background = new THREE.Color('#0a0a0a');
    const camera = new THREE.PerspectiveCamera(40, el.clientWidth / 420, 1, 2000);
    scene.add(new THREE.HemisphereLight('#ffffff', '#333333', 1.2));
    const dir = new THREE.DirectionalLight('#ffffff', 1.5); dir.position.set(1, -1, 2); scene.add(dir);
    const controls = new OrbitControls(camera, renderer.domElement);
    const render = () => renderer.render(scene, camera);
    controls.addEventListener('change', render);
    const loader = new STLLoader();
    let offset = 0;
    const group = new THREE.Group(); scene.add(group);
    Promise.all(urls.map(u => loader.loadAsync(u))).then(geometries => {
      for (const g of geometries) {
        g.computeBoundingBox();
        const b = g.boundingBox!;
        const mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: '#d4d4d4', roughness: 0.7 }));
        mesh.position.x = offset - b.min.x; offset += b.max.x - b.min.x + 10;
        group.add(mesh);
      }
      const box = new THREE.Box3().setFromObject(group); const size = box.getSize(new THREE.Vector3()); const center = box.getCenter(new THREE.Vector3());
      camera.up.set(0, 0, 1);
      camera.position.set(center.x + size.length(), center.y - size.length(), center.z + size.length() * 0.8);
      controls.target.copy(center); controls.update(); render();
    });
    return () => { controls.dispose(); renderer.dispose(); el.removeChild(renderer.domElement); };
  }, [urls.join('|')]);
  return <div ref={ref} className="w-full" />;
}
```

- [ ] **Step 7: RunPanel.tsx**

```tsx
import { api } from '../shared/api';
import type { Project, Run } from '../shared/types';
import { Viewer } from './Viewer';

export function RunPanel({ project, run, onAcceptNeeds }: { project: Project; run: Run; onAcceptNeeds: () => void }) {
  const url = (f: string) => api.fileUrl(project.id, 'runs', String(run.n), f);
  return (
    <section className="flex flex-col gap-3 border-t border-neutral-800 pt-3">
      <div className="flex items-baseline gap-3"><span>Run {run.n + 1}</span><span className="text-neutral-400">{run.status}</span></div>
      {run.status === 'needs_dimensions' && run.needs && (
        <div>
          <p>The model needs {run.needs.length} more measurement{run.needs.length > 1 ? 's' : ''}:</p>
          <ul className="list-disc pl-5">{run.needs.map(d => <li key={d.id}>{d.name}. {d.why}</li>)}</ul>
          <button onClick={onAcceptNeeds} className="mt-2 bg-white px-3 py-1 text-black">Add them to the form</button>
        </div>
      )}
      {run.status === 'failed' && (
        <div className="text-red-400">
          <p>{run.error}</p>
          {run.check?.parts.flatMap(p => p.reasons).map((r, i) => <p key={i}>{r}</p>)}
        </div>
      )}
      {run.status === 'done' && (
        <>
          <Viewer urls={run.files.map(f => url(f.stl))} />
          <table className="w-full">
            <thead><tr className="text-left text-neutral-400"><th>Part</th><th>Print</th><th>Files</th></tr></thead>
            <tbody>
              {run.files.map(f => (
                <tr key={f.part} className="border-t border-neutral-800">
                  <td className="py-1">{f.part}</td>
                  <td>{f.minutes != null ? `${Math.round(f.minutes)} min, Ender 3 V2, 0.2 mm PLA` : 'slicer unavailable'}</td>
                  <td className="flex gap-3">
                    <a className="underline" href={url(f.step)} download>STEP</a>
                    <a className="underline" href={url(f.stl)} download>STL</a>
                    {f.gcode && <a className="underline" href={url(f.gcode)} download>G-code</a>}
                  </td>
                </tr>
              ))}
              {project.plan?.parts.filter(p => !p.printed).map(p => (
                <tr key={p.name} className="border-t border-neutral-800 text-neutral-400"><td className="py-1">{p.name}</td><td colSpan={2}>not printed. {p.purpose}</td></tr>
              ))}
            </tbody>
          </table>
          <p className="text-neutral-400">Print order: as listed. Each part is oriented with its flat face on the bed. Copy the G-code to the SD card.</p>
        </>
      )}
    </section>
  );
}
```

- [ ] **Step 8: ProjectPage.tsx**

```tsx
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../shared/api';
import { PhotoCallouts } from './PhotoCallouts';
import { DimensionForm, missingCritical } from './DimensionForm';
import { RunPanel } from './RunPanel';

export function ProjectPage({ id }: { id: string }) {
  const qc = useQueryClient();
  const [active, setActive] = useState<string | null>(null);
  const { data: project } = useQuery({
    queryKey: ['project', id], queryFn: () => api.get(id),
    refetchInterval: q => q.state.data?.runs.some(r => r.status === 'running') ? 2000 : false,
  });
  const invalidate = () => qc.invalidateQueries({ queryKey: ['project', id] });
  const plan = useMutation({ mutationFn: () => api.plan(id), onSuccess: invalidate });
  const save = useMutation({ mutationFn: (body: Parameters<typeof api.saveDimensions>[1]) => api.saveDimensions(id, body), onSuccess: invalidate });
  const generate = useMutation({ mutationFn: () => api.generate(id), onSuccess: invalidate });
  const accept = useMutation({ mutationFn: (n: number) => api.acceptNeeds(id, n), onSuccess: invalidate });
  if (!project) return null;

  const focusDim = (dimId: string) => { setActive(dimId); document.getElementById(`dim-${dimId}`)?.focus(); };
  const missing = missingCritical(project);
  const running = project.runs.some(r => r.status === 'running');
  const activeDim = project.plan?.dimensions.find(d => d.id === active);
  const photoIndex = activeDim?.photo ?? 0;

  return (
    <div className="grid gap-6 md:grid-cols-[3fr_2fr]">
      <div className="flex flex-col gap-3">
        <h1 className="text-lg font-semibold">{project.title}</h1>
        {project.plan && <p>{project.plan.summary}</p>}
        <PhotoCallouts src={api.fileUrl(id, 'photos', project.photos[photoIndex]!)} active={active} onPick={focusDim}
          dimensions={project.plan?.dimensions.filter(d => d.photo === photoIndex) ?? []} />
        <div className="flex gap-2">
          {project.photos.map((p, i) => <img key={p} src={api.fileUrl(id, 'photos', p)} onClick={() => setActive(project.plan?.dimensions.find(d => d.photo === i)?.id ?? null)}
            className={`h-16 cursor-pointer ${i === photoIndex ? 'opacity-100' : 'opacity-50'}`} alt="" />)}
        </div>
        {!project.plan && (
          <button onClick={() => plan.mutate()} disabled={plan.isPending} className="w-fit bg-white px-3 py-1 text-black disabled:opacity-40">
            {plan.isPending ? 'Looking at the photos' : 'Identify part and measurements'}
          </button>
        )}
        {plan.error && <p className="text-red-400">{plan.error.message}</p>}
        {project.plan?.question && <p className="text-yellow-300">{project.plan.question}</p>}
      </div>
      <div className="flex flex-col gap-4">
        {project.plan && (
          <>
            <DimensionForm project={project} active={active} onFocus={setActive} onChange={body => save.mutate(body)} />
            <button onClick={() => generate.mutate()} disabled={missing.length > 0 || running || generate.isPending}
              className="w-fit bg-white px-3 py-1 text-black disabled:opacity-40">
              {running ? 'Generating' : project.runs.length ? 'Generate again' : 'Generate'}
            </button>
            {missing.length > 0 && <p className="text-neutral-400">Measure {missing.map(d => d.name).join(', ')} first.</p>}
            {generate.error && <p className="text-red-400">{generate.error.message}</p>}
          </>
        )}
        {[...project.runs].reverse().map(run => <RunPanel key={run.n} project={project} run={run} onAcceptNeeds={() => accept.mutate(run.n)} />)}
      </div>
    </div>
  );
}
```

- [ ] **Step 9: Run with the mock end to end in the browser**

Run: `MODEL=mock pnpm dev`, open http://127.0.0.1:5173, create a project with any photo, identify, fill the required fields, generate. Expect: boxes drawn, Generate disabled until required fields are filled, run panel shows the viewer and download links within a few seconds.

- [ ] **Step 10: Typecheck and commit**

```bash
pnpm typecheck && git add src && git commit -m "feat: project ui with callouts, dimension form, viewer, run panel"
```

---

### Task 8: Codex smoke test, then the badge

**Files:**
- Create: `scripts/smoke-codex.sh`

- [ ] **Step 1: scripts/smoke-codex.sh**

```sh
#!/bin/sh
# One real generate run from the fixture dims, no UI. Needs codex login and the venv.
set -eu
d=$(mktemp -d)
cp cad/tests/fixtures/dims.json "$d/dims.json"
cp cad/check.py "$d/check.py"
node --experimental-strip-types -e "
import { generatePrompt } from './server/prompts.ts';
import { codex } from './server/model.ts';
import { readFileSync } from 'node:fs';
const dims = JSON.parse(readFileSync('$d/dims.json','utf8'));
await codex.generate('$d', generatePrompt(dims, null), new AbortController().signal);
"
cat "$d/check.json"
ls "$d"
```

- [ ] **Step 2: Run it**

Run: `sh scripts/smoke-codex.sh`
Expected: check.json with ok true, plate.step and plate.stl present. If ok is false, read `last.md` and the reasons, adjust the generate prompt, rerun. Budget: one hour. If it still fails, fall back to `MODEL=mock` for the UI and keep iterating on the prompt separately.

- [ ] **Step 3: The badge.** Photograph the HTN badge, run the real flow, measure with calipers, generate, slice, print. Start printing by hour 14.

- [ ] **Step 4: Commit**

```bash
git add scripts && git commit -m "chore: codex smoke test script"
```

---

### Task 9: Only if hours 20 to 27 are free

Marker-mat photo: `cad/measure.py` with OpenCV ChArUco detection producing hole centers and outline in millimeters, surfaced as prefilled values in the dimension form. Not planned in detail on purpose. Do not start it before the badge case is printed and fits.

---

## Self-review

Spec coverage: capture (T6 create, T7 NewProject), plan with callouts and cap (T4 prompt, T2 schema max 12, T7 callouts), caliper entry with required criticals and user-added dimensions (T7 form, T6 buildDims throws), constants owned by the app (T4 constants, T6 buildDims), generate via Codex in workspace-write with venv (T5), needs.json clarification path (T4 prompt, T6 execute, T7 RunPanel and accept-needs route), checker rules (T3), server trusts only a passing check.json (T6), viewer, slicing, downloads, print plan, non-printed parts (T6 slice, T7 RunPanel), retry with notes and previous part.py (T6 start, T7 form notes), projects on disk (T6 store), 409 when busy (T6 route), adapter with two implementations (T5, mock stands in for the future API implementation), shared types without DOM imports (T2, api.ts uses only fetch), tests (T2, T3, T7 step 9 manual check with mock). Gap: the spec's UI test is manual here, not automated. Accepted for the deadline.

Type consistency: `Run.files[].gcode` nullable in T2, T6, T7. `Project.values` is a record in T2, T6, T7. `requestedDimensionSchema` fields used identically in T4 prompt and T7 callouts. `api.saveDimensions` body matches the T6 route schema.
