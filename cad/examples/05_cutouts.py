# Tray with a side cutout for a USB-C port on the +X wall, centered at y=20, 10 wide, 4 tall, cutout floor 3 above the board floor.
import cadquery as cq
W, H, D = 60, 40, 12
CL, WALL = 0.3, 2.4
outer = cq.Workplane("XY").box(W + 2*CL + 2*WALL, H + 2*CL + 2*WALL, D + WALL, centered=False).translate((-CL - WALL, -CL - WALL, 0))
inner = cq.Workplane("XY").box(W + 2*CL, H + 2*CL, D + 1, centered=False).translate((-CL, -CL, WALL))
tray = outer.cut(inner)
port = cq.Workplane("XY").box(WALL + 2*CL + 2, 10 + 2*CL, 4 + 2*CL, centered=False).translate((W - 1, 20 - 5 - CL, WALL + 3))
tray = tray.cut(port)
parts = {"tray": tray}
