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

def check_part(name, wp, holes, comp):
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
    """The largest printed part must be at least as big as the object in X and Y."""
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
        results = [check_part(name, wp, holes, comp) for name, wp in parts.items()]
        # A hole only needs to exist in one part. Drop that hole's reasons everywhere once some part has it.
        for hid in holes:
            tag = f"hole {hid} "
            if any(not any(tag in r for r in res["reasons"]) for res in results):
                for res in results:
                    res["reasons"] = [r for r in res["reasons"] if tag not in r]
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
