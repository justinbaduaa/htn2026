# Open-top tray the board drops into. Floor 2.4, walls 2.4, inner size = board + clearance.
import cadquery as cq
W, H, D = 60, 40, 12          # board width, height, tallest component
CL, WALL = 0.3, 2.4
HOLES = [(5, 5), (55, 35)]
outer = cq.Workplane("XY").box(W + 2*CL + 2*WALL, H + 2*CL + 2*WALL, D + WALL, centered=False).translate((-CL - WALL, -CL - WALL, 0))
inner = cq.Workplane("XY").box(W + 2*CL, H + 2*CL, D + 1, centered=False).translate((-CL, -CL, WALL))
tray = outer.cut(inner)
# Screw holes through the floor. Cut with an XY cylinder in global coordinates; a workplane on the "<Z" face would mirror X.
drills = cq.Workplane("XY").workplane(offset=-1).pushPoints(HOLES).circle((4 + 0.2) / 2).extrude(WALL + 2)
tray = tray.cut(drills)
tray = tray.edges("|Z").fillet(2)
parts = {"tray": tray}
