# Pipeline

The full pipeline from the original brief, in order. Each stage says whether it is in the first build or parked, and why. Change the status column, not the list.

| Stage | Status | Notes |
|---|---|---|
| Photo capture | first build | Two to four phone photos. |
| Object scan (iPhone LiDAR / Object Capture) | parked | Measured: 1 to 2 mm error on small parts, needs a caliper reading to set scale, fails on dark glossy thin objects. See docs/research.md section 4. Reopen only for large matte objects. |
| Photogrammetry (multi-photo mesh) | parked | Same numbers as object scan. Dimensionless without a reference. |
| Marker-mat photo (top-down on printed ChArUco sheet) | first build, stretch | 0.1 to 0.3 mm on hole centers and outline from one photo. Replaces most caliper prompts for flat objects like PCBs. |
| Design-file import (KiCad, Gerber, STEP of the target object) | first build if available | Exact hole centers and outline for PCBs. Beats any scan. |
| Dimension request | first build | Model lists fit-critical dimensions, each with a callout drawn on a photo. Hard cap on count. |
| Caliper entry | first build | User types readings. Live update of the model as values land. |
| Cosmetic defaults and clearance rules | first build | Wall thickness, fit clearance, FDM hole compensation applied by a rules layer, not by the model. |
| CadQuery generation | first build | Model writes code. Sandbox runs it. Validate, repair, retry. |
| Validation | first build | Solid count, volume, bounding box vs entered dims, hole presence at entered coordinates. |
| 3D preview | first build | Three.js viewer of the produced mesh. |
| Isometric views, drawings, sketches | later | Headless render of the same model. Cheap once rendering exists. |
| STEP export | first build | Free from CadQuery. |
| STL / 3MF export | first build | Input to the slicer. |
| G-code export | first build | Slicer CLI with one fixed default profile: Creality Ender 3 V2. Other printers later. |
| Multi-part print plan | first build | Which files, orientation, print order. Skip non-printed parts such as screws. |
| Assembly instructions, text | first build | Ordered steps referencing part names. |
| Assembly instructions, illustrated | later | Per-step renders of the generated model, IKEA style. After parts fit. |
| Saved projects | first build | Photos, dimensions, generated source, exports. Needed for the retry loop. |
| Retry loop ("it didn't fit") | first build | Reopen a project, describe the problem, regenerate from the saved state. |
| Project version tree | later | Every generation and edit is a node. Branch from any earlier state. Default on. |
| Blank-slate mode | later | Prompt with no object. Same workspace, same exports. |
| Repair mode (broken doorknob, missing piece) | later | Same loop, different prompt. Scan gate applies. |
| Marketplace | later | Publish, fork, sell a finished project. Needs accounts, hosting, version tree. |
