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
