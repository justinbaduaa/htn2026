import type { DimsFile } from './types';

/**
 * Places the readings the model was given onto the printed part, in the part's own frame
 * (millimetres, object outline corner at X=0,Y=0, part sitting on Z=0). No three.js here so it
 * runs in node tests; the viewer and the drawing renderer turn these into lines and labels.
 *
 * Placement is app-side and heuristic. Holes, the object outline, heights, and any feature whose
 * readings decompose into position + size land on the model. Everything else is listed, not drawn.
 */
export type Point = [number, number, number];

export type Annotation =
  // Linear dimension between two points, drawn offset from them with extension lines. axis is the measured direction.
  | { type: 'dim'; id: string; from: Point; to: Point; offset: Point; text: string; axis: 'x' | 'y' | 'z' }
  // Hole: circle in the XY plane at z.
  | { type: 'circle'; id: string; center: Point; radius: number; text: string }
  // Opening or feature footprint in the XY plane at z.
  | { type: 'rect'; id: string; origin: Point; w: number; h: number; text: string };

export type Listed = { id: string; name: string; value_mm: number; estimated: boolean };
export type AnnotationSet = { drawn: Annotation[]; listed: Listed[] };
export type Bounds = { min: Point; max: Point };

export const fmt = (v: number) => Number(v.toFixed(2)).toString();
/** "LCD opening: frame width" -> "frame width". */
const short = (name: string) => name.includes(':') ? name.slice(name.indexOf(':') + 1).trim() : name;
const groupOf = (name: string, group: string | null) => group ?? (name.includes(':') ? name.slice(0, name.indexOf(':')).trim() : name);

type Role = 'x' | 'y' | 'cx' | 'cy' | 'w' | 'h' | 'z';
/** What one atomic reading contributes to its feature, judged from the wording the planner is told to use. */
export function roleOf(name: string, kind: string): Role | null {
  const s = short(name).toLowerCase();
  if (/center\s*x|centre\s*x/.test(s)) return 'cx';
  if (/center\s*y|centre\s*y/.test(s)) return 'cy';
  if (/left\s*x|\bx\b.*left|left edge/.test(s)) return 'x';
  if (/bottom\s*y|\by\b.*bottom|bottom edge/.test(s)) return 'y';
  if (kind === 'extent_z' || /height above|above the|clearance/.test(s)) return 'z';
  if (/width|span|length|along x|along y/.test(s)) return 'w';
  if (/height|thickness|depth/.test(s)) return 'h';
  return null;
}

export function annotate(dims: DimsFile, bounds: Bounds): AnnotationSet {
  const drawn: Annotation[] = [];
  const listed: Listed[] = [];
  const [minX, minY] = bounds.min;
  const [maxX, maxY, maxZ] = bounds.max;
  const top = maxZ + 0.2;   // draw the XY annotations just above the part so they are not buried in the top face
  const readings = dims.dimensions;
  const byKind = (k: string) => readings.filter(d => d.kind === k);
  const placed = new Set<string>();

  // Printed part overall size, from the mesh itself. Outside everything else.
  const sx = maxX - minX, sy = maxY - minY, sz = maxZ;
  drawn.push({ type: 'dim', id: 'part_x', axis: 'x', from: [minX, minY, top], to: [maxX, minY, top], offset: [0, -14, 0], text: `${fmt(sx)} part` });
  drawn.push({ type: 'dim', id: 'part_y', axis: 'y', from: [maxX, minY, top], to: [maxX, maxY, top], offset: [14, 0, 0], text: `${fmt(sy)} part` });
  drawn.push({ type: 'dim', id: 'part_z', axis: 'z', from: [maxX, maxY, 0], to: [maxX, maxY, maxZ], offset: [6, 6, 0], text: `${fmt(sz)} part` });

  // Object outline, from the entered extents. Inside the part-size dims.
  const W = byKind('extent_x')[0], H = byKind('extent_y')[0];
  if (W) { drawn.push({ type: 'dim', id: W.id, axis: 'x', from: [0, 0, top], to: [W.value_mm, 0, top], offset: [0, -7, 0], text: `${fmt(W.value_mm)} ${short(W.name)}` }); placed.add(W.id); }
  if (H) { drawn.push({ type: 'dim', id: H.id, axis: 'y', from: [W?.value_mm ?? maxX, 0, top], to: [W?.value_mm ?? maxX, H.value_mm, top], offset: [7, 0, 0], text: `${fmt(H.value_mm)} ${short(H.name)}` }); placed.add(H.id); }
  const objW = W?.value_mm ?? maxX, objH = H?.value_mm ?? maxY;

  // Holes: one circle per hole id that has x, y, and diameter.
  const holes = new Map<string, { x?: number; y?: number; d?: number; ids: string[]; label: string }>();
  for (const r of readings) {
    if (!r.hole || !['hole_x', 'hole_y', 'hole_diameter'].includes(r.kind)) continue;
    const h = holes.get(r.hole) ?? { ids: [], label: groupOf(r.name, null) };
    if (r.kind === 'hole_x') h.x = r.value_mm; else if (r.kind === 'hole_y') h.y = r.value_mm; else h.d = r.value_mm;
    h.ids.push(r.id); holes.set(r.hole, h);
  }
  for (const [hid, h] of holes) {
    if (h.x == null || h.y == null || h.d == null) continue;
    drawn.push({ type: 'circle', id: `hole_${hid}`, center: [h.x, h.y, top], radius: h.d / 2, text: `Ø${fmt(h.d)} at (${fmt(h.x)}, ${fmt(h.y)})` });
    for (const id of h.ids) placed.add(id);
  }

  // Features: readings that share a group decompose into position and size.
  type Feature = { label: string; ids: string[]; roles: Partial<Record<Role, number>>; est: boolean };
  const features = new Map<string, Feature>();
  for (const r of readings) {
    if (placed.has(r.id) || r.kind.startsWith('hole_') || r.kind === 'extent_x' || r.kind === 'extent_y') continue;
    const role = roleOf(r.name, r.kind);
    if (!role) continue;
    const label = groupOf(r.name, null);
    const f = features.get(label) ?? { label, ids: [], roles: {}, est: false };
    if (f.roles[role] != null) continue;   // a second reading with the same role (e.g. two heights) stays listed
    f.roles[role] = r.value_mm; f.ids.push(r.id); f.est ||= r.estimated;
    features.set(label, f);
  }
  let zColumn = 0;
  for (const f of features.values()) {
    const { x, y, cx, cy, w, h, z } = f.roles;
    const est = f.est ? ' (est.)' : '';
    const l = f.label.toLowerCase();
    let placedFeature = false;
    if (x != null && y != null && w != null && h != null) {
      drawn.push({ type: 'rect', id: f.label, origin: [x, y, top], w, h, text: `${f.label} ${fmt(w)}×${fmt(h)}${est}` }); placedFeature = true;
    } else if (cx != null && cy != null && w != null && h != null) {
      drawn.push({ type: 'rect', id: f.label, origin: [cx - w / 2, cy - h / 2, top], w, h, text: `${f.label} ${fmt(w)}×${fmt(h)}${est}` }); placedFeature = true;
    } else if (cx != null && cy == null) {
      // A feature on the top or bottom edge, e.g. a switch on the top edge of the board.
      const edgeY = /bottom/.test(l) ? 0 : objH;
      const span = w ?? 4, thick = h ?? 2;
      drawn.push({ type: 'rect', id: f.label, origin: [cx - span / 2, edgeY - thick / 2, top], w: span, h: thick, text: `${f.label} at X ${fmt(cx)}${w != null ? `, ${fmt(w)} wide` : ''}${z != null ? `, ${fmt(z)} up` : ''}${est}` }); placedFeature = true;
    } else if (cy != null && cx == null) {
      const edgeX = /right/.test(l) ? objW : 0;
      const span = w ?? 4, thick = h ?? 2;
      drawn.push({ type: 'rect', id: f.label, origin: [edgeX - thick / 2, cy - span / 2, top], w: thick, h: span, text: `${f.label} at Y ${fmt(cy)}${w != null ? `, ${fmt(w)} long` : ''}${z != null ? `, ${fmt(z)} up` : ''}${est}` }); placedFeature = true;
    } else if (z != null && x == null && y == null && w == null && h == null) {
      // A bare height or clearance: a vertical dimension stacked along the part's right edge.
      const px = maxX + 16 + zColumn * 10;
      drawn.push({ type: 'dim', id: f.label, axis: 'z', from: [px, minY, 0], to: [px, minY, z], offset: [0, -4, 0], text: `${fmt(z)} ${f.label}${est}` }); zColumn++; placedFeature = true;
    }
    if (placedFeature) for (const id of f.ids) placed.add(id);
  }

  for (const r of readings) if (!placed.has(r.id)) listed.push({ id: r.id, name: r.name, value_mm: r.value_mm, estimated: r.estimated });
  return { drawn, listed };
}
