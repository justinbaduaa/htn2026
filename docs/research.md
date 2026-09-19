# Research, 2026-09-19

Four parallel research passes on the premises in the original brief. Summary first, sources after. Every number below has a link in its section.

## Summary

| Premise from the brief | Finding |
|---|---|
| Astra 6 exists and takes images | Confirmed. `gpt-6-astra`, released 2026-09-03. Image input, structured outputs, function calling, code interpreter, hosted shell. 1.05M context. $10/M in, $50/M out. |
| Optimized for a CAD benchmark that runs CadQuery | Half right. OpenAI reports 95.9% on BenchCAD, whose ground truth is 17,900 CadQuery programs. But the score is self-reported, "with tools" only, and the model had a Python sandbox to render, measure, and iterate. No zero-shot number exists. No source says it was trained or tuned on CadQuery. |
| Codex CLI can drive it | Confirmed. Hidden model entry since Codex 0.153, `--image`, `--output-schema`, workspace-write sandbox runs Python. Responses API is the recommended route. |
| Best harness is unknown, needs research | Known enough to build. Kernel-measured validation plus repair loop is the largest reported lever (CADSmith: IoU 0.81 to 0.96, mean CD 28.4 to 0.74). Traceback retry second (exec 53% to 85%). |
| iPhone object scan gives useful geometry | No. Phone scans land at 1 to 2 mm error on small parts, need a caliper reading to set scale at all, and a PCB is the worst subject (dark, glossy, thin, reflective parts). |
| Photogrammetry as an alternative | Same problem. Scale is ambiguous without a reference. |
| Not in the brief: single photo on a marker mat | Yes. Top-down photo on a printed ChArUco or ArUco sheet, undistort, rectify, fit circles: ±0.1 to 0.3 mm on hole centers and outline. Component heights still need a caliper. |
| G-code for Ender 3 V2 from a fixed preset | Feasible. PrusaSlicer 2.9.6 CLI, one flat `.ini` exported from the stock Creality Ender-3 V2 profile. |

The one correction that changes the build: Astra's CAD score was earned inside an agentic loop with a Python sandbox. Our harness has to give it the same loop, not a one-shot JSON response.

## 1. gpt-6-astra

Model page: https://developers.openai.com/api/docs/models/gpt-6-astra. Context 1,050,000; max output 128K; input text and image; knowledge cutoff 2026-04-30; reasoning effort low through max. Pricing $10/M input, $1/M cached, $50/M output; requests over 272K input tokens bill 2x. Features: structured_outputs, function_calling, image_input, code_interpreter, hosted_shell. Tool calling requires the Responses API (https://developers.openai.com/api/docs/guides/latest-model).

System card: https://deploymentsafety.openai.com/gpt-6-astra. No section on CAD, 3D, or geometry.

Launch post (https://openai.com/index/gpt-6-astra/) BenchCAD row: Astra 95.9, GPT-5.6 Sol 83.3, Claude Fable 5.1 84.3, Opus 5 82.1. Text: "With tools, GPT-6 Astra reaches 95.9% geometric-overlap score." No attempt count, no sandbox description, no language named.

BenchCAD (arXiv 2605.10865): 17,900 execution-verified CadQuery programs, 106 ISO/DIN part families, voxel IoU at 256^3. Leaderboard (https://benchcad.com/leaderboard) marks Astra's row as vendor self-reported, agentic setting only, "the model gets a Python sandbox to render, measure and iterate before submitting."

Codex CLI: `codex exec` with `--output-schema`, `--image` (must follow the prompt), `--sandbox read-only | workspace-write | danger-full-access`. Astra catalog entry merged 2026-09-03 (https://github.com/openai/codex/pull/42605). Schemas need `additionalProperties: false` and every key in `required`.

Community: HN thread https://news.ycombinator.com/item?id=49676577 has anecdotes of Astra one-shotting models from photographs and producing STEP via build123d. No measured failure rates anywhere.

## 2. LLM-to-CAD harness literature

CadQuery is the language every 2025-2026 benchmark scores. Metrics: Chamfer distance, IoU, invalidity rate. Cross-paper CD numbers do not compare (https://arxiv.org/pdf/2603.11831).

Techniques with numbers:

- Kernel validation plus repair loop. CADSmith (https://arxiv.org/html/2603.26512): zero-shot 95% exec, IoU 0.81, mean CD 28.4, to 100%, 0.96, 0.74. Dropping the render from the judge keeps IoU 0.956 but mean CD rises to 18.2, so vision catches gross outliers and kernel numbers do the rest. Repo: https://github.com/jabarkle/CADSmith.
- Traceback retry. Text-to-CadQuery (https://arxiv.org/html/2505.06507v1): exec 53% to 85%. Three retries is the standard protocol in Text2CAD-Bench (https://arxiv.org/html/2605.18430v1).
- Visual question-answering. CADCodeVerify (https://arxiv.org/html/2410.05340): point-cloud distance 0.153 to 0.132. Gains stop after two iterations.
- Few-shot. Compile 92% to 96% on GPT-4. CADSmith ships 28 worked examples plus 25 error-pattern fixes.
- Plan before code. CIT-CAD (https://arxiv.org/html/2609.07434): constraint satisfaction 17% to 38%, IoU barely moves.
- Medoid voting. Sample N, pick the medoid by pairwise CD (https://arxiv.org/html/2608.09706v1). Beats a VLM verifier, saturates at N=9.
- Incremental build with measurement tools. build123d-mcp raised one model's CADGenBench score 0.360 to 0.457 and validity 88% to 100% (https://github.com/pzfreo/build123d-mcp).

Failure modes to check for: wrong workplane or cut direction, fillet radius exceeding wall (`BRep_API: command not done`), hallucinated methods (`.cone()`, `.array()`), filleting before a solid exists, misplaced holes with high IoU, thin features breaking connectivity, near-miss non-manifold gaps that pass `isValid` and fixed render views, sweep/loft/shell collapsing exec rates.

Recommended loop: planner emits a JSON spec (bbox, features, hole count and diameters, boolean roles). Coder writes CadQuery with worked examples and the error-pattern list. Execute with a 60 s timeout. Traceback: retry up to 3. Success: `isValid`, one solid, bbox within tolerance of spec, sane volume, hole check by circle edges at expected coordinates. Failure: structured diff back, max 5 outer iterations, switch construction strategy at 3. Only then render three views for a model check. Sample 3 to 5 candidates, keep the CD medoid.

## 3. Tooling

CadQuery 2.8.0 (2026-06-21), Python 3.11+, pins `cadquery-ocp>=7.9.3.1,<8.0`. OCP wheels for macOS arm64 and manylinux aarch64/x86_64, about 65 MB each plus VTK, 250 to 300 MB installed. Cold import 1.5 s, so keep a warm process. build123d has better type hints but hallucination rates are the same and CadQuery has the training-set prevalence (https://grandpacad.com/en/blog/openscad-vs-cadquery-vs-build123d). Pick CadQuery.

Sandbox: Modal Sandboxes (https://modal.com/docs/guide/sandbox). Prebuilt image, per-exec timeout, cpu/memory limits, network off.

Validation snippets:

```python
s = result.val()
s.isValid(); s.Volume(); bb = s.BoundingBox()
len(result.solids().vals()) == 1
hits = [e for e in result.edges("%CIRCLE").vals()
        if abs(e.radius() - 2.5) < 0.05
        and (e.arcCenter() - cq.Vector(10, 20, e.arcCenter().z)).Length < 0.05]
```

Export: `result.export("part.step")`, `result.export("part.stl", tolerance=0.01, angularTolerance=0.1)`. Default STL tolerance 0.1 mm is too coarse for holes.

Slicing: PrusaSlicer 2.9.6.

```
prusa-slicer --export-gcode --load ender3v2_pla_020.ini --output out.gcode part.stl
```

Stock profile lives in https://github.com/prusa3d/PrusaSlicer-settings/tree/master/live/Creality as `Creality Ender-3 V2 (0.4 mm nozzle)`, `0.20 mm NORMAL`, `Generic PLA @CREALITY`. The bundle uses inheritance the CLI cannot resolve, so export a flat config from the GUI once and commit it. OrcaSlicer CLI works but needs a 3MF unzip step. CuraEngine 5.x fails on unset settings. `three-slicer` 0.3.1 is OrcaSlicer in WASM for Node or browser, AGPL.

Headless render: `result.export("v.svg", opt={"projectionDir": (1,1,1)})` needs no display. `cadquery.vis.show(..., screenshot="v.png", interact=False)` needs xvfb on Linux.

## 4. Phone scanning accuracy

Apple Object Capture: best published error 0.23 mm length and 0.47 mm width, on a DSLR with a full-span scale reference (https://pmc.ncbi.nlm.nih.gov/articles/PMC11637407/). No native scale bar. Apple says avoid reflective, transparent, or thin objects (https://developer.apple.com/documentation/RealityKit/scanning-objects-using-object-capture).

Phone apps on small objects: Polycam LiDAR 21.4 mm mean error, KIRI 5.0 mm (https://pmc.ncbi.nlm.nih.gov/articles/PMC12349111/). Phone photogrammetry scale error 2 to 3%. All SfM output is dimensionless; a caliper reading is required to set scale in every consumer app (https://github.com/colmap/colmap/issues/1653). Meshing auto-fills M3-sized holes.

Single photo on a marker sheet: ChArUco corners refine to subpixel (https://docs.opencv.org/3.4.20/df/d4a/tutorial_charuco_detection.html). Handheld phone, near-normal shot, undistorted, markers surrounding the board: 0.1 to 0.3 mm on hole centers. Credit card alone as scale: 0.5 to 1 mm. Shoot straight down; oblique views bias ellipse centers. Free mat: https://printmakerai.com/tools/aruco-marker-sheet.

Verdict: a phone scan cannot replace calipers for M3/M4 boss placement and adds little as rough-shape input over two or three photos. Marker-mat photo is the right capture for PCBs.
