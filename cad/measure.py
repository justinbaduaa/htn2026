"""Read exported STEP topology. No scan inputs, generated Python, or inferred dimensions."""
import json
import math
import sys
from pathlib import Path
import cadquery as cq
from OCP.BRepAdaptor import BRepAdaptor_Surface

TOL = 1e-5

def vec(p):
    return [float(p.X()), float(p.Y()), float(p.Z())]

def bounds(shape):
    b = shape.BoundingBox(tolerance=1e-7)
    return {"min": [b.xmin, b.ymin, b.zmin], "max": [b.xmax, b.ymax, b.zmax]}

def axis_of(v):
    return next((i for i in range(3) if abs(abs(v[i]) - 1) < TOL), None)

def rounded(v):
    return tuple(round(x, 5) for x in v)

def measure(path):
    shape = cq.importers.importStep(str(path)).val()
    if not shape.isValid():
        raise ValueError(f"Invalid STEP solid: {path}")
    bb = bounds(shape)
    cylinders = {}
    profiles = {}
    unsupported = {}
    for face in shape.Faces():
        surface = BRepAdaptor_Surface(face.wrapped)
        kind = face.geomType()
        fb = bounds(face)
        if kind == 'CYLINDER':
            cylinder = surface.Cylinder()
            direction = vec(cylinder.Axis().Direction())
            axis = axis_of(direction)
            if axis is None:
                unsupported['inclined cylinder'] = unsupported.get('inclined cylinder', 0) + 1
                continue
            center = vec(cylinder.Location())
            u = (surface.FirstUParameter() + surface.LastUParameter()) / 2
            v = (surface.FirstVParameter() + surface.LastVParameter()) / 2
            point = vec(surface.Value(u, v))
            radial = [point[i] - center[i] if i != axis else 0 for i in range(3)]
            normal = face.normalAt(cq.Vector(*point)).toTuple()
            internal = sum(a*b for a,b in zip(radial, normal)) < 0
            # A partial cylinder is an arc/fillet, never invent a full hole from it.
            sweep = surface.LastUParameter() - surface.FirstUParameter()
            feature_kind = ('bore' if internal else 'boss') if abs(sweep - 2*math.pi) < TOL else 'radius'
            center[axis] = fb['min'][axis]
            key = (axis, *rounded(center), round(cylinder.Radius(), 5), round(fb['max'][axis], 5), feature_kind)
            cylinders[key] = {"kind": feature_kind, "axis": axis, "center": center, "radius": cylinder.Radius(),
                              "start": fb['min'][axis], "end": fb['max'][axis], "point": point}
        elif kind == 'PLANE':
            axis = axis_of(vec(surface.Plane().Axis().Direction()))
            if axis is None:
                unsupported['inclined plane / chamfer'] = unsupported.get('inclined plane / chamfer', 0) + 1
                continue
            axes = [i for i in range(3) if i != axis]
            # The outward normal says which side of the part this face is seen from: a pocket floor
            # looks up (+axis, seen from the max face), a groove ceiling looks down.
            outward = face.normalAt(face.Center()).toTuple()[axis]
            opens = 'max' if outward > 0 else 'min'
            for wire in face.Wires():
                wb = bounds(wire)
                # Ignore overall silhouettes and narrow side faces. Closed interior wires
                # and horizontal floors/boss tops carry useful feature sizes and locations.
                inner = any(wire.isSame(w) for w in face.innerWires())
                if not inner and (axis != 2 or abs(wb['min'][axis] - bb['max'][axis]) < TOL):
                    continue
                if all(abs(wb['min'][i]-bb['min'][i]) < TOL and abs(wb['max'][i]-bb['max'][i]) < TOL for i in axes):
                    continue
                edges = wire.Edges()
                if all(e.geomType() == 'CIRCLE' for e in edges):
                    continue  # cylindrical surfaces already supply diameters and axial depths
                if any(e.geomType() not in ('LINE', 'CIRCLE') for e in edges):
                    unsupported['non-analytic profile'] = unsupported.get('non-analytic profile', 0) + 1
                    continue
                vertices = [v.Center().toTuple() for v in wire.Vertices()]
                rectangle = len(edges) == 4 and all(sum(abs(e.endPoint().toTuple()[i]-e.startPoint().toTuple()[i]) > TOL for i in axes) == 1 for e in edges)
                signature = tuple(sorted((e.geomType(), *rounded([e.Center().toTuple()[i] for i in axes]), round(e.Length(), 5)) for e in edges))
                key = (axis, *rounded([wb['min'][i] for i in axes]), *rounded([wb['max'][i] for i in axes]), signature)
                if key not in profiles:
                    profiles[key] = {"kind": 'rectangle' if rectangle else 'profile', "axis": axis, "bounds": wb, "levels": [], "opens": [], "vertices": vertices, "segments": [{"start": list(e.startPoint().toTuple()), "end": list(e.endPoint().toTuple()), "length": e.Length(), "radius": e.radius() if e.geomType() == "CIRCLE" else None} for e in edges], "paths": [[list(e.positionAt(t / 16).toTuple()) for t in range(17)] if e.geomType() == "CIRCLE" else [list(e.startPoint().toTuple()), list(e.endPoint().toTuple())] for e in edges]}
                profiles[key]['levels'].append((round(wb['min'][axis], 6), opens))
        else:
            unsupported[kind.lower() + ' surface'] = unsupported.get(kind.lower() + ' surface', 0) + 1
    features = []
    for i, value in enumerate(sorted(cylinders.values(), key=lambda f: (f['axis'], *f['center'], f['radius']))):
        features.append({"id": f"C{i+1}", **value})
    for i, value in enumerate(sorted(profiles.values(), key=lambda f: (f['axis'], *f['bounds']['min']))):
        pairs = sorted(set(value['levels']))
        value['levels'] = [level for level, _ in pairs]
        value['opens'] = [side for _, side in pairs]
        features.append({"id": f"P{i+1}", **value})
    return {"name": Path(path).stem, "bounds": bb, "features": features,
            "notes": [f"{count} {kind} face/profile(s) require detailed CAD inspection." for kind,count in sorted(unsupported.items())]}

if __name__ == '__main__':
    print(json.dumps({"source": "STEP", "units": "mm", "parts": [measure(p) for p in sys.argv[1:]]}))
