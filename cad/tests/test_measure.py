import importlib.util
from pathlib import Path
import cadquery as cq
import pytest

spec = importlib.util.spec_from_file_location('measure', Path(__file__).parents[1] / 'measure.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

def extract(tmp_path, shape):
    path = tmp_path / 'part.step'
    shape.export(str(path))
    return module.measure(path)

def test_actual_compensated_hole_and_nonzero_origin(tmp_path):
    shape = cq.Workplane('XY').box(60.6, 40.6, 3, centered=False).translate((-0.3,-0.3,2))
    hole = cq.Workplane('XY').center(8,10).circle(1.75).extrude(10)
    data = extract(tmp_path, shape.cut(hole))
    assert data['bounds']['min'] == pytest.approx([-0.3,-0.3,2])
    assert data['bounds']['max'] == pytest.approx([60.3,40.3,5])
    bores = [f for f in data['features'] if f['kind']=='bore']
    assert len(bores)==1  # one cylindrical face, not duplicated at both circular edges
    assert bores[0]['radius'] * 2 == pytest.approx(3.5)
    assert bores[0]['end']-bores[0]['start'] == pytest.approx(3)

def test_counterbore_is_two_actual_cylindrical_segments(tmp_path):
    part = cq.Workplane('XY').box(30,30,10,centered=False)
    bore = cq.Workplane('XY').center(10,10).circle(2.6).extrude(12)
    recess = cq.Workplane('XY').workplane(offset=8).center(10,10).circle(5.5).extrude(4)
    result = extract(tmp_path, part.cut(bore).cut(recess))
    bores = sorted((round(f['radius']*2,5),round(f['end']-f['start'],5)) for f in result['features'] if f['kind']=='bore')
    assert bores == [(5.2,8),(11,2)]

def test_opening_and_pocket_only_exist_on_the_part_that_contains_them(tmp_path):
    part = cq.Workplane('XY').box(60,40,8,centered=False)
    opening = cq.Workplane('XY').box(21.6,11.6,12,centered=False).translate((10,10,-1))
    front = extract(tmp_path, part.cut(opening))
    profiles = [f for f in front['features'] if f['kind']=='rectangle']
    assert len(profiles)==1
    assert profiles[0]['levels']==pytest.approx([0,8])
    assert profiles[0]['opens']==['min','max']  # seen from the bottom face and the top face
    assert profiles[0]['bounds']['max'][0]-profiles[0]['bounds']['min'][0]==pytest.approx(21.6)
    rear = extract(tmp_path, part)
    assert rear['features']==[]

def test_side_hole_axis_is_preserved(tmp_path):
    part = cq.Workplane('XY').box(20,30,20,centered=False)
    hole = cq.Workplane('YZ').center(15,10).circle(2).extrude(25)
    data = extract(tmp_path,part.cut(hole))
    bores = [f for f in data['features'] if f['kind']=='bore']
    assert len(bores)==1
    assert bores[0]['axis']==0
    assert bores[0]['end']-bores[0]['start']==pytest.approx(20)


def test_pocket_floor_faces_the_side_it_opens_from(tmp_path):
    part = cq.Workplane('XY').box(60,40,8,centered=False)
    pocket = cq.Workplane('XY').box(20,10,10,centered=False).translate((10,10,2))   # floor at z=2, open to the top
    groove = cq.Workplane('XY').box(20,10,10,centered=False).translate((35,10,-9))  # ceiling at z=1, open to the bottom
    data = extract(tmp_path, part.cut(pocket).cut(groove))
    rects = {round(f['bounds']['min'][0], 3): f for f in data['features'] if f['kind']=='rectangle'}
    assert rects[10.0]['levels'] == pytest.approx([2, 8]) and rects[10.0]['opens'] == ['max', 'max']   # floor and the top-face rim both look up
    assert rects[35.0]['levels'] == pytest.approx([0, 1]) and rects[35.0]['opens'] == ['min', 'min']   # bottom-face rim and ceiling both look down
