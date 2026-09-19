# Flat plate under a 60x40 board with two M4 holes. Object corner at (0,0). Plate sits on Z=0.
import cadquery as cq
W, H, T = 60, 40, 3
CL, WALL = 0.3, 2.4
plate = cq.Workplane("XY").box(W + 2*WALL, H + 2*WALL, T, centered=False).translate((-WALL, -WALL, 0))
plate = plate.faces(">Z").workplane().pushPoints([(5, 5), (55, 35)]).hole(4 + 0.2)
parts = {"plate": plate}
