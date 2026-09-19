# Base plate plus lid, screwed together through the board's holes. Both parts on Z=0 in print orientation.
import cadquery as cq
W, H, D = 60, 40, 12
CL, WALL = 0.3, 2.4
HOLES = [(5, 5), (55, 35)]
OW, OH = W + 2*CL + 2*WALL, H + 2*CL + 2*WALL

def drills(height):
    """Through-hole cutter for every screw hole, in global XY coordinates, from just below Z=0 up to height."""
    return cq.Workplane("XY").workplane(offset=-1).pushPoints(HOLES).circle((4 + 0.2) / 2).extrude(height + 2)

base = cq.Workplane("XY").box(OW, OH, WALL, centered=False).translate((-CL - WALL, -CL - WALL, 0))
base = base.cut(drills(WALL))

# The lid is modelled in print orientation: closed face on Z=0, open side up. Flip it after printing.
lid = cq.Workplane("XY").box(OW, OH, D + WALL, centered=False).translate((-CL - WALL, -CL - WALL, 0))
lid = lid.cut(cq.Workplane("XY").box(W + 2*CL, H + 2*CL, D + 1, centered=False).translate((-CL, -CL, WALL)))
lid = lid.cut(drills(WALL))
parts = {"base": base, "lid": lid}
