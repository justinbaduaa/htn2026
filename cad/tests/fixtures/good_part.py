import cadquery as cq
plate = cq.Workplane("XY").box(64, 44, 3, centered=False).translate((-2, -2, 0))
plate = plate.faces(">Z").workplane().pushPoints([(5, 5)]).hole(4.2)
parts = {"plate": plate}
