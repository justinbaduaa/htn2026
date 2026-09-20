# The CADEX harness: why CadQuery, and how the loop is built around the way Astra was scored

This is the technical thesis behind the generation step. It is written so a judge with an engineering background can follow it in five minutes and so we can answer follow-up questions without hand-waving. Numbers about the model and the benchmark come from the research pass in `docs/research.md`, which links every source; nothing here is claimed beyond what those sources say.

## The thesis in one paragraph

A language model cannot output a solid. It can output a program that, when a geometry kernel runs it, produces a solid. So the whole question of "can an LLM do CAD" reduces to three things: which program language, which kernel checks the result, and what loop lets the model see the kernel's verdict and fix its own mistakes. GPT-6 Astra's headline CAD score was earned under exactly those conditions: CadQuery programs, an OpenCascade kernel, and an agentic sandbox where the model could render, measure and iterate before submitting. CADEX gives the model the same three things, then tightens the loop around the one thing benchmarks never test: fitting a real object whose dimensions came from a person with calipers.

## 1. What CadQuery is

CadQuery is a Python library for parametric solid modelling. A part is a script. The script builds geometry by selecting a plane, drawing a 2D sketch on it, and extruding, cutting, or revolving that sketch into or out of a solid, then repeating on a face of the result. Underneath, every operation calls Open CASCADE Technology (OCCT), the same boundary-representation kernel used by FreeCAD and several commercial tools.

Three properties matter for us:

- **It is exact, not approximate.** OCCT stores faces as analytic surfaces (planes, cylinders, cones) with topology (which edges bound which faces). A 5.2 mm hole is a cylinder of radius 2.6 with two circular edges, not a ring of triangles. That is what makes the result checkable and what makes it exportable to STEP, the interchange format every CAD package and machine shop reads.
- **It is text.** A part is a few hundred lines of Python. Language models read and write Python better than any other CAD representation, and every intermediate value (a wall thickness, a clearance, a hole centre) is a named number the model can reason about and the checker can compare.
- **It is deterministic.** Re-running the script with changed inputs regenerates the part. Our retry loop depends on this: the model gets its previous script back, edits it, and the kernel rebuilds everything.

A minimal example from our own worked-example set, a plate under a 60 × 40 mm board with two M4 clearance holes:

```python
import cadquery as cq
W, H, T = 60, 40, 3
CL, WALL = 0.3, 2.4
plate = cq.Workplane("XY").box(W + 2*WALL, H + 2*WALL, T, centered=False).translate((-WALL, -WALL, 0))
plate = plate.faces(">Z").workplane().pushPoints([(5, 5), (55, 35)]).hole(4 + 0.2)
parts = {"plate": plate}
```

`box` makes a solid, `faces(">Z")` selects its top face, `workplane` puts a sketch plane on it, `pushPoints` places two points in the object's own coordinate frame, and `hole` cuts through. The last line is our contract: every generated script ends by defining `parts`, a dictionary of named solids.

## 2. Why code-CAD instead of the alternatives

There were three ways to get a part out of a model, and two of them fail for our use case.

| Approach | What the model emits | Why it fails for "make a part that fits my thing" |
|---|---|---|
| Direct mesh generation (text-to-3D diffusion, point clouds) | Triangles | No exact holes, no dimensions to check against, no STEP, no way to say "the hole is 0.4 mm off" and have it corrected. Fine for figurines, useless for a bracket. |
| Direct CAD-file generation (STEP, 3MF, OpenSCAD text) | A file format | STEP is a serialised kernel dump nobody writes by hand. OpenSCAD is code-CAD too but has a mesh kernel (CGAL), so no exact edges to measure and far less presence in the literature. |
| Code-CAD on a B-rep kernel (CadQuery, build123d) | A Python program | The program is the model's reasoning made explicit, the kernel is the ground truth, and every dimension can be asserted. |

Within code-CAD, CadQuery over build123d was a deliberate call. build123d has cleaner type hints, but reported hallucination rates are the same and CadQuery has the larger footprint in training data and in every 2025 to 2026 CAD benchmark. When a model has seen more of a language, it invents fewer methods that do not exist, which is one of the top failure modes we had to design around (see section 5).

## 3. The benchmark Astra was scored on, and what the score really means

OpenAI's launch material for `gpt-6-astra` reports 95.9% on BenchCAD, against 83 to 84% for the next models. BenchCAD's ground truth is 17,900 execution-verified CadQuery programs across 106 ISO/DIN part families, scored by voxel intersection-over-union at 256³ between the generated solid and the reference.

Two details from the leaderboard change how you should read that number:

1. **It is the "with tools" score.** The model had a Python sandbox where it could execute its CadQuery, render it, measure it, and iterate before submitting. No zero-shot number was published.
2. **It is vendor self-reported**, in the agentic setting only.

We could not find any source saying Astra was trained or fine-tuned on CadQuery specifically. What the evidence supports is narrower and more useful: **the model is very good at CadQuery when it can run the kernel and look at what it made.** That is a statement about the loop, not about the model in isolation. So the harness had to reproduce the loop. A single-shot "return JSON with the geometry" call would be asking the model to perform under conditions it was never scored under.

The literature says the same thing from the other direction. The largest reported gains in LLM-to-CAD papers come from kernel-measured validation plus a repair loop (CADSmith: IoU 0.81 to 0.96, mean Chamfer distance 28.4 to 0.74), then from feeding tracebacks back for a retry (execution rate 53% to 85%), then from worked examples (compile rate 92% to 96%). Plan-before-code helps constraint satisfaction. Voting across samples helps but saturates. We built the first three and the fourth; voting was cut for time.

## 4. What the harness does, condition by condition

The generation step is `codex exec` running Astra inside a run folder, with a workspace-write sandbox, the CadQuery virtual environment on `PATH`, and a prompt built by `server/prompts.ts`. Each row below is one benchmark condition and how we reproduce or exceed it.

| Benchmark condition | CADEX implementation |
|---|---|
| Output is a CadQuery program | `part.py` must define `parts: dict[str, cq.Workplane]`, millimetres, Z up, each part sitting on Z=0 in its print orientation. |
| Model can execute the kernel | Sandbox has Python 3.12 with CadQuery 2.8.0. The model runs `python check.py` itself, as many times as it needs, within one session. |
| Model can measure what it made | `check.py` measures with the kernel and writes `check.json` with per-part pass/fail and plain-language reasons. The model reads it and edits. |
| Model can iterate before submitting | The prompt says: write `part.py`, run the checker, fix until `ok=true`. Across the six badge-case runs tonight the checker was invoked three to five times per run, meaning the model used the loop every time and converged within a handful of edits. |
| Scored by geometric agreement with a reference | There is no reference part; the user's object is the reference. The checker asserts fit against the measurements instead of IoU against ground truth (section 5). |

Beyond the benchmark, three things are ours:

**Plan before code, with structured outputs.** Generation is the third model call, not the first. The first call looks at the photos and returns a JSON plan under a strict schema: which parts to print, which not (screws, the object itself), and a list of the atomic caliper readings the part depends on, each with a callout drawn on a photo. Priorities gate what is required before generation is allowed. The second call answers the user's questions about a reading. Only then does generation run, with the plan and every reading in `dims.json`. The model is never asked to guess a dimension it could have asked for.

**The app owns the tolerances.** Fit clearance (0.3 mm), FDM hole compensation (0.2 mm) and wall thickness (2.4 mm) are constants written into `dims.json` by the server. The model is told them and never chooses them. A generated part that fits does so because of a rules layer, not because the model happened to know how PLA shrinks.

**The model can refuse to guess.** If generation needs a reading that `dims.json` lacks and cannot default safely, the model writes `needs.json` in the same schema as the plan and stops. The server pushes those readings into the form as required, the user measures, and generation resumes. This is the mid-run clarification path, and it is why a run can end in `needs_dimensions` instead of a part that is wrong in a way nobody can see.

## 5. The checker, in detail

`cad/check.py` is 100 lines and is the most important file in the pipeline. It runs inside the sandbox, executes `part.py`, and for every part asserts:

- **Exactly one solid.** A part that is two disconnected bodies, or a wall that only touches at an edge, fails here.
- **`isValid()` from BRepCheck.** The kernel's own topology validation. Self-intersections and non-manifold results fail.
- **Volume above a floor** (50 mm³), which catches a sketch that never got extruded.
- **Nothing below Z=0**, so the part is actually sitting on the bed in the orientation it claims to print in.
- **Every mounting hole from `dims.json` exists.** For each hole the checker collects every circular edge in the part and looks for one whose centre is within 0.2 mm of the measured X, Y and whose radius matches the measured diameter plus compensation within 0.2 mm. A hole only has to exist in one part of a multi-part assembly, so a front plate and a rear plate can share the same four screw holes.
- **The parts are at least as big as the object** in X and Y, within 0.5 mm, so a case cannot silently shrink to fit a smaller board.

On pass it exports STEP and a fine STL (0.01 mm chord tolerance, because the default 0.1 mm visibly faceted the holes). On fail it writes the reasons and exits non-zero, which is the signal the model reacts to.

The checker is a fit test, not an aesthetics test. It cannot tell a good-looking case from an ugly one, and it does not check openings for ports or screens. That is intentional. Those are the things the user can see in the viewer and fix with a note. What the user cannot see, a hole 0.4 mm off, is what the checker exists for.

**Failure patterns we prompt against.** The prompt carries a list drawn from the literature and from our own failed runs: a workplane on a `<Z` face mirrors X, so cut holes with an XY cylinder in global coordinates; fillet radius larger than the wall raises `BRep_API: command not done`; `.cone()` and `.array()` do not exist; filleting before a solid exists; holes at the wrong coordinates because a box was centred; parts that touch at an edge instead of overlapping. Each of these was a real failure mode in published work, and each one costs a loop iteration if the model hits it, so we pay a few hundred tokens to steer around them up front.

**Worked examples.** Five short CadQuery scripts in `cad/examples`, all in the same contract: a plate with holes, a tray case, a two-part case, standoffs, cutouts. Few-shot examples in the same output format are the cheapest reliability gain in the literature, and they double as the specification of our contract.

## 6. Nothing downstream trusts the model

Everything the user sees after generation is measured from the STEP file by the kernel, never taken from the model's description of what it built.

- `cad/measure.py` reads the exported STEP topology back: bounds, every cylindrical bore and boss with its axis, centre, radius and extent, and every planar profile with its levels and outline. It explicitly ignores the generated Python and the scan inputs.
- The 3D viewer's dimensions, the engineering drawing sheets (top, front, right, isometric, plus any face with features) and the feature schedule all come from that measurement.
- The assembly instructions are planned from the same measurement: counterbored holes identify the part that takes screw heads, six-sided pockets identify nut seats, and the two parts are matched by testing which flip lines their hole patterns up. No model call is involved, and the booklet cannot describe a part that does not exist.

The principle is the same one the checker uses: the kernel is the only source of truth about geometry. The model proposes, the kernel disposes.

## 7. Why calipers and not a scan

The original plan assumed a phone scan would supply geometry. The research pass killed that. Phone object capture lands at 1 to 2 mm error on small parts, photogrammetry output is dimensionless without a scale reference, and a PCB is the worst possible subject: dark, glossy, thin, with reflective components. Meshing tools auto-fill M3-sized holes. Meanwhile M4 boss placement on a case needs about 0.2 mm.

So the dimension source is a person with calipers, guided by the model. The plan call decomposes the object into atomic readings, draws each one on the photo (a line where the jaws go, a circle around a hole), groups them by feature, and ranks them so the user measures the fifteen that matter before the thirty that are cosmetic. The scan is optional in the product's language because it was never going to be accurate enough to replace this step; it can only ever add rough shape.

## 8. What happened tonight, as evidence

Six generations of the two-part badge case, each producing a front plate and a rear plate, each passing the checker on the same four hole positions to 0.2 mm. The third run's parts were printed; later runs changed only the front plate, then only the rear plate to add a charging port slot, and the checker held the hole positions fixed across all of them so a new plate can be swapped onto an already printed one. A cup holder and a foosball handle went through the same loop from photos to sliced files in under fifteen minutes each. The checker was invoked three to five times in every run, which is the loop doing its job: the model wrote, measured, fixed, and stopped when the kernel agreed.

## 9. Honest limits

- The 95.9% figure is self-reported and agentic-only. We reproduce the conditions; we cannot reproduce the number, and we do not claim to.
- The checker tests fit at mounting holes and outer extents. Openings for ports, screens and switches are checked by a human in the viewer.
- One candidate per run. Medoid voting across several samples is a known gain we did not build.
- Tolerances are FDM constants for PLA on a Bambu A1 mini. Other processes need their own rules layer.
- A generation at xhigh reasoning runs one to six minutes. That is the price of the loop.

## The sixty-second version for the judges

Astra is the best model in the world at CadQuery, but only when it can run the kernel and look at what it built; that is how its score was earned. So we never ask it for geometry. We ask it for a program, we give it the kernel, and we give it a checker that measures the result against the user's own caliper readings and tells it exactly what is wrong. It rewrites until the kernel agrees. Everything you see after that, the drawings, the dimensions, the assembly booklet, is measured from the STEP file by the kernel, never taken from the model's word. That is why the parts fit.
