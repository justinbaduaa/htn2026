import { expect, test } from 'vitest';
import { annotate, featureRows, forViewer, stackTiers } from './annotations';
import type { CadPart } from './cadGeometry';

const part: CadPart = {
  name: 'case', bounds: { min: [-2.7, -2.7, 3], max: [97.7, 150.7, 11.7] }, notes: [],
  features: [
    { id: 'C1', kind: 'bore', axis: 2, center: [18, 4.5, 3.8], radius: 2.6, start: 3.8, end: 11.7, point: [20.6, 4.5, 7] },
    { id: 'P1', kind: 'rectangle', axis: 2, bounds: { min: [20, 30, 3], max: [71.6, 65.6, 3] }, levels: [3, 5.4], vertices: [], segments: [], paths: [[[20,30,3],[71.6,30,3],[71.6,65.6,3],[20,65.6,3],[20,30,3]]] },
  ],
};
const top = (p: CadPart) => annotate(p).drawn.filter(a => a.normal === 2 && a.face === 'max');
const bottom = (p: CadPart) => annotate(p).drawn.filter(a => a.normal === 2 && a.face === 'min');
const ordinates = (list: ReturnType<typeof annotate>['drawn'], axis: 'x' | 'y' | 'z') =>
  list.filter(a => a.type === 'ordinate' && a.id.startsWith(`ord_${axis}_`)).map(a => a.text);

test('overall dimensions use the CAD bounds including a nonzero Z origin', () => {
  const annotations = annotate(part).drawn;
  expect(annotations.find(a => a.id === 'part_x')).toMatchObject({ text: '100.4', normal: 2, face: 'max', secondary: false });
  expect(annotations.find(a => a.id === 'part_z')).toMatchObject({ text: '8.7', from: [97.7, -2.7, 3], to: [97.7, -2.7, 11.7], normal: 1, secondary: false });
  // Every orthographic view carries its own overall size; the duplicates stay out of the isometric view.
  expect(annotations.find(a => a.id === 'part_x_front')).toMatchObject({ text: '100.4', normal: 1, secondary: true });
  expect(annotations.find(a => a.id === 'part_y_right')).toMatchObject({ text: '153.4', normal: 0, secondary: true });
});

test('bore annotations use compensated CAD diameter, actual axial position, and state the depth', () => {
  expect(top(part).find(a => a.id === 'C1')).toMatchObject({ type: 'circle', text: 'C1 Ø5.2, 7.9 deep', radius: 2.6, center: [18, 4.5, 11.7] });
});

test('every hole center and opening edge gets an ordinate from the part datum, on the face it opens from', () => {
  // The bore reaches the top face; the recess (levels at the bottom face and 2.4 above it) opens from the bottom.
  expect(ordinates(top(part), 'x')).toEqual(['0', '20.7']);
  expect(ordinates(top(part), 'y')).toEqual(['0', '7.2']);
  expect(ordinates(bottom(part), 'x')).toEqual(['0', '22.7', '74.3']);
  expect(ordinates(bottom(part), 'y')).toEqual(['0', '32.7', '68.3']);
});

test('openings get width and height dimensions and the isometric view keeps them', () => {
  const b = bottom(part);
  expect(b.find(a => a.id === 'P1_x_bottom')).toMatchObject({ type: 'dim', text: '51.6', secondary: false });
  expect(b.find(a => a.id === 'P1_y_bottom')).toMatchObject({ type: 'dim', text: '35.6' });
  expect(b.find(a => a.id === 'P1_bottom')).toMatchObject({ type: 'path', text: 'P1' });
});

test('levels inside the part become ordinates in the front view: pocket floor and blind hole bottom', () => {
  const front = annotate(part).drawn.filter(a => a.normal === 1 && a.face === 'min');
  expect(ordinates(front, 'z')).toEqual(['0', '0.8', '2.4']);
  // The back view repeats them, marked secondary so the isometric view and the 3D viewer show them once.
  const back = annotate(part).drawn.filter(a => a.normal === 1 && a.face === 'max');
  expect(ordinates(back, 'z')).toEqual(['0', '0.8', '2.4']);
  expect(back.every(a => a.type !== 'ordinate' || a.secondary)).toBe(true);
});

test('identical holes are counted once on the label but each still gets a circle', () => {
  const twin: CadPart = { ...part, features: [part.features[0]!, { ...(part.features[0] as Extract<CadPart['features'][number], { radius: number }>), id: 'C2', center: [75, 4.5, 3.8] }] };
  const circles = top(twin).filter(a => a.type === 'circle');
  expect(circles.map(a => a.text)).toEqual(['C1 Ø5.2 ×2, 7.9 deep', '']);
});

test('a part without the opening does not inherit another part’s or scan dimensions', () => {
  const rear = { ...part, name: 'rear', features: [part.features[0]!] };
  const drawn = annotate(rear).drawn;
  expect(drawn.some(a => a.id.startsWith('P1'))).toBe(false);
  expect(ordinates(top(rear), 'x')).toEqual(['0', '20.7']);
});

test('locations use the part datum and do not add guessed pocket depths', () => {
  const rows = featureRows(part);
  expect(rows[0]).toContain('center X 20.7, Y 7.2');
  expect(rows[0]).toContain('Z start 0.8; axial length 7.9');
  expect(rows[1]).toContain('X span 51.6, Y span 35.6');
  expect(rows[1]).toContain('Z levels 0, 2.4');
  expect(rows.join(' ')).not.toContain('estimated');
});

test('side bores retain their actual axis and sit on the face they open from', () => {
  const side: CadPart = { ...part, features: [{ id: 'C1', kind: 'bore', axis: 0, center: [-2.7,20,6], radius: 2, start: -2.7, end: 4, point: [0,22,6] }] };
  // It opens from the left face, so it is drawn on the left plane and nowhere else.
  const circles = annotate(side).drawn.filter(a => a.type === 'circle');
  expect(circles).toHaveLength(1);
  expect(circles[0]).toMatchObject({ id: 'C1_left', normal: 0, face: 'min', center: [-2.7,20,6] });
});

test('ordinate leaders step out to a new tier when coordinates would collide', () => {
  expect(stackTiers([0, 5, 30, 31, 60], 10)).toEqual([0, 1, 0, 1, 0]);
  expect(stackTiers([0, 1, 2, 3, 4, 5], 10)).toEqual([0, 1, 2, 3, 0, 1]);
});

test('a stepped profile gets ordinates at its inner corners, but not at fillet tangent points', () => {
  // An L-shaped through opening: outer corners at (10,10) and (40,40), inner step corner at (25,25).
  const pts: [number, number, number][] = [[10,10,11.7],[40,10,11.7],[40,25,11.7],[25,25,11.7],[25,40,11.7],[10,40,11.7]];
  const seg = (a: [number, number, number], b: [number, number, number], radius: number | null = null) => ({ start: a, end: b, length: 1, radius });
  const stepped: CadPart = { ...part, features: [{ id: 'P1', kind: 'profile', axis: 2, bounds: { min: [10,10,11.7], max: [40,40,11.7] }, levels: [3, 11.7], opens: ['min', 'max'], vertices: pts,
    segments: [seg(pts[0]!, pts[1]!), seg(pts[1]!, pts[2]!), seg(pts[2]!, pts[3]!), seg(pts[3]!, pts[4]!), seg(pts[4]!, pts[5]!), seg(pts[5]!, pts[0]!)], paths: [] }] };
  expect(ordinates(top(stepped), 'x')).toEqual(['0', '12.7', '42.7', '27.7']);
  expect(ordinates(top(stepped), 'y')).toEqual(['0', '12.7', '42.7', '27.7']);
  // Round the corner at (40,10) with an arc: its tangent points no longer count as steps.
  const filleted: CadPart = { ...stepped, features: [{ ...(stepped.features[0] as Extract<CadPart['features'][number], { segments: unknown }>),
    segments: [seg(pts[0]!, [38,10,11.7]), seg([38,10,11.7], [40,12,11.7], 2), seg([40,12,11.7], pts[2]!), seg(pts[2]!, pts[3]!), seg(pts[3]!, pts[4]!), seg(pts[4]!, pts[5]!), seg(pts[5]!, pts[0]!)] }] };
  expect(ordinates(top(filleted), 'x')).toEqual(['0', '12.7', '42.7', '27.7']);
});

test('the 3D viewer never draws ordinate leaders or another view’s duplicates', () => {
  const drawn = annotate(part).drawn;
  const shown = forViewer(drawn, true);
  expect(shown.some(a => a.type === 'ordinate')).toBe(false);
  expect(shown.some(a => a.secondary)).toBe(false);
  expect(shown.some(a => a.type === 'circle')).toBe(true);
  expect(forViewer(drawn, false).map(a => a.id).sort()).toEqual(['part_x', 'part_y', 'part_z']);
});
