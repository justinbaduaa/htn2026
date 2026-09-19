import type { CadPart } from './cadGeometry';
export type Point = [number, number, number];
export type Bounds = { min: Point; max: Point };
export type Axis = 0 | 1 | 2;
export type Face = 'min' | 'max';

/**
 * One drawn annotation. `normal` is the axis of the sheet view it belongs to and `face` which side
 * of the part that view looks at (top is normal 2 face max, bottom is normal 2 face min, front is
 * normal 1 face min, right is normal 0 face max). `secondary` marks a duplicate that only makes sense
 * in its own orthographic view, never in the isometric view or the 3D viewer.
 */
type Base = { id: string; text: string; normal: Axis; face: Face; secondary?: boolean };
export type Annotation =
  | (Base & { type: 'dim'; from: Point; to: Point; offset: Point; axis: 'x' | 'y' | 'z' })
  | (Base & { type: 'circle'; center: Point; radius: number })
  | (Base & { type: 'path'; paths: Point[][]; position: Point })
  // Ordinate: a leader from `point` along `direction` for `length`, labelled with the coordinate from the part datum.
  | (Base & { type: 'ordinate'; point: Point; direction: Point; length: number; pad: number });
export type AnnotationSet = { drawn: Annotation[] };
export const fmt = (value: number) => Number(value.toFixed(3)).toString();
const xyz = ['X', 'Y', 'Z'];
const axisName = (i: number) => (['x', 'y', 'z'] as const)[i]!;
const TOL = 0.05;
const key = (n: number) => Math.round(n * 100) / 100;

type Feature = CadPart['features'][number];
type Cylinder = Extract<Feature, { radius: number }>;
type Profile = Exclude<Feature, { radius: number }>;
const isCylinder = (f: Feature): f is Cylinder => 'radius' in f;

/**
 * The six orthographic planes and, for each, its in-plane axes: u runs across, v runs up. `main`
 * planes (top, front, right) own the ordinates shown in the 3D viewer; the others repeat them and
 * are only drawn on the sheet when a part has features facing that way.
 */
type Plane = { normal: Axis; face: Face; u: Axis; v: Axis; suffix: string; main: boolean };
const PLANES: Plane[] = [
  { normal: 2, face: 'max', u: 0, v: 1, suffix: '', main: true },          // top
  { normal: 1, face: 'min', u: 0, v: 2, suffix: '_front', main: true },    // front
  { normal: 0, face: 'max', u: 1, v: 2, suffix: '_right', main: true },    // right
  { normal: 2, face: 'min', u: 0, v: 1, suffix: '_bottom', main: false },  // bottom
  { normal: 1, face: 'max', u: 0, v: 2, suffix: '_back', main: false },    // back
  { normal: 0, face: 'min', u: 1, v: 2, suffix: '_left', main: false },    // left
];

/**
 * The corners of a non-rectangular profile that define its steps: endpoints of straight segments that
 * are not tangent points of an arc. Fillet corners are covered by the envelope and the radius callout.
 */
export function stepVertices(f: Profile): Point[] {
  const tag = (p: Point) => p.map(key).join(',');
  const onArc = new Set(f.segments.filter(e => e.radius != null).flatMap(e => [tag(e.start), tag(e.end)]));
  const seen = new Set<string>();
  const out: Point[] = [];
  for (const e of f.segments) {
    if (e.radius != null) continue;
    for (const p of [e.start, e.end]) { const t = tag(p); if (!onArc.has(t) && !seen.has(t)) { seen.add(t); out.push(p); } }
  }
  return out;
}

/** What the 3D viewer draws: never ordinate leaders (they need a flat sheet) and never a view's duplicate of another view's dimension. */
export function forViewer(drawn: Annotation[], details: boolean): Annotation[] {
  return drawn.filter(a => !a.secondary && a.type !== 'ordinate' && (details || a.id.startsWith('part_')));
}

/**
 * Greedy tiers for ordinate leaders: sorted coordinates closer together than `spacing` are pushed
 * out to the next tier so their labels do not collide. Returns a tier per input value.
 */
export function stackTiers(values: number[], spacing: number, maxTiers = 4): number[] {
  const order = values.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0]);
  const last: number[] = [];
  const tiers = new Array<number>(values.length);
  for (const [v, i] of order) {
    let tier = last.findIndex(l => v - l >= spacing);
    if (tier < 0) tier = last.length < maxTiers ? last.length : last.indexOf(Math.min(...last));
    last[tier] = v; tiers[i] = tier;
  }
  return tiers;
}

/**
 * Drafting-style dimensions for one part, from measured STEP geometry only. Per sheet view: overall
 * size, an ordinate dimension from the part datum for every hole center, opening edge and level,
 * linear size dimensions on each opening, a diameter on each hole (identical holes counted once), and
 * a radius per distinct fillet. Scan inputs never enter this function.
 */
export function annotate(part: CadPart): AnnotationSet {
  const { min, max } = part.bounds;
  const extent = [0, 1, 2].map(i => max[i]! - min[i]!);
  const gap = Math.max(4, Math.max(...extent) * 0.07);
  const drawn: Annotation[] = [];
  const near = (a: number, b: number) => Math.abs(a - b) <= TOL;
  const unit = (axis: Axis, sign = 1): Point => { const p: Point = [0, 0, 0]; p[axis] = sign; return p; };
  const scale = (p: Point, s: number): Point => [p[0] * s, p[1] * s, p[2] * s];

  /** Which faces of the part, along the feature's own axis, the feature is seen from. */
  const facesOf = (f: Feature): Face[] => {
    const a = f.axis;
    const nearest = (level: number): Face => (max[a]! - level <= level - min[a]! ? 'max' : 'min');
    if ('radius' in f) {
      const s = near(f.start, min[a]!), e = near(f.end, max[a]!);
      return s && e ? ['max', 'min'] : e ? ['max'] : s ? ['min'] : [nearest((f.start + f.end) / 2)];
    }
    if (f.opens?.length === f.levels.length) return [...new Set(f.opens)];
    return [...new Set(f.levels.map(l => (near(l, max[a]!) ? 'max' : near(l, min[a]!) ? 'min' : nearest(l)) as Face))];
  };

  for (const pl of PLANES) {
    const { normal: n, u, v, face, suffix } = pl;
    const level = face === 'max' ? max[n]! : min[n]!;
    const P = (uu: number, vv: number, nn = level): Point => { const p: Point = [0, 0, 0]; p[u] = uu; p[v] = vv; p[n] = nn; return p; };
    const base = { normal: n, face, secondary: !pl.main } as const;   // bottom, back and left repeat ordinates and overall sizes already shown elsewhere
    const onPlane = part.features.filter(f => f.axis === n && facesOf(f).includes(face));

    // Coordinates worth an ordinate: hole centers and opening edges seen in this view, and every face
    // level of features whose axis lies in this view (pocket floors, rims, blind hole bottoms, wall faces).
    const coords: Record<'u' | 'v', Map<number, number>> = { u: new Map(), v: new Map() };
    const add = (which: 'u' | 'v', value: number) => {
      const axis = which === 'u' ? u : v;
      if (value > min[axis]! + TOL && value < max[axis]! - TOL) coords[which].set(key(value), value);
    };
    for (const f of onPlane) {
      if ('radius' in f) { if (f.kind !== 'radius') { add('u', f.center[u]!); add('v', f.center[v]!); } }
      else {
        add('u', f.bounds.min[u]!); add('u', f.bounds.max[u]!); add('v', f.bounds.min[v]!); add('v', f.bounds.max[v]!);
        // A stepped outline (an LCD opening joined to a button cluster, say) is only defined by its inner corners.
        if (f.kind === 'profile') for (const p of stepVertices(f)) { add('u', p[u]!); add('v', p[v]!); }
      }
    }
    for (const f of part.features) {
      if (f.axis !== u && f.axis !== v) continue;
      const which = f.axis === u ? 'u' : 'v';
      if ('radius' in f) { if (f.kind !== 'radius') { add(which, f.start); add(which, f.end); } }
      else for (const l of f.levels) add(which, l);
    }

    // Ordinates. u coordinates hang below the part (leaders along -v), v coordinates sit to its left (leaders along -u).
    const leaders = (which: 'u' | 'v') => {
      const axis = which === 'u' ? u : v, other = which === 'u' ? v : u;
      const values = [min[axis]!, ...coords[which].values()];
      const texts = values.map(value => fmt(value - min[axis]!));
      // Ordinate text runs along its leader, so two labels only collide when their coordinates are
      // closer than a text height; each tier then steps out by a whole label length.
      const tiers = stackTiers(values, gap * 0.4, 8);
      const step = gap * 0.35 + 2 * gap * 0.075 * Math.max(...texts.map(t => t.length));
      let deepest = 0;
      values.forEach((value, i) => {
        const text = texts[i]!;
        const length = gap * 0.7 + tiers[i]! * step;
        deepest = Math.max(deepest, length);
        const point = which === 'u' ? P(value, min[other]!) : P(min[other]!, value);
        drawn.push({ ...base, type: 'ordinate', id: `ord_${axisName(axis)}_${key(value)}${suffix}`, point, direction: unit(other, -1), length, pad: gap * 0.075 * text.length, text });
      });
      return deepest;
    };
    const depthU = leaders('u'), depthV = leaders('v');

    // Overall size of the part in this view, outside the ordinates. The top view owns X and Y, the front view owns Z.
    const overall = (axis: Axis, from: Point, to: Point, offset: Point, primary: boolean) =>
      drawn.push({ type: 'dim', id: `part_${axisName(axis)}${primary ? '' : suffix}`, axis: axisName(axis), from, to, offset, text: fmt(max[axis]! - min[axis]!), normal: n, face, secondary: !primary });
    const top = pl.suffix === '', front = pl.suffix === '_front';
    void depthV;   // v ordinates sit on the left; the overall v dimension goes on the right, clear of them
    overall(u, P(min[u]!, min[v]!), P(max[u]!, min[v]!), scale(unit(v, -1), depthU + gap * 0.9), top);
    overall(v, P(max[u]!, min[v]!), P(max[u]!, max[v]!), scale(unit(u), gap * 0.8), top || front);

    // Openings and pockets: outline, plus width and height once per distinct size.
    const sizes = new Map<string, number>();
    const profiles = onPlane.filter((f): f is Profile => !isCylinder(f));
    for (const f of profiles) { const k = `${key(f.bounds.max[u]! - f.bounds.min[u]!)}x${key(f.bounds.max[v]! - f.bounds.min[v]!)}`; sizes.set(k, (sizes.get(k) ?? 0) + 1); }
    const sized = new Set<string>();
    for (const f of profiles) {
      const levelsHere = f.opens?.length === f.levels.length ? f.levels.filter((_, i) => f.opens![i] === face) : f.levels;
      const own = face === 'max' ? Math.max(...levelsHere) : Math.min(...levelsHere);
      const paths = f.paths.map(path => path.map(p => { const q: Point = [...p]; q[n] = own; return q; }));
      const su = f.bounds.max[u]! - f.bounds.min[u]!, sv = f.bounds.max[v]! - f.bounds.min[v]!;
      const k = `${key(su)}x${key(sv)}`;
      const b = f.bounds;
      // Size dimensions go first so they win the label space; the id sits at the opposite corner.
      if (!sized.has(k)) {
        sized.add(k);
        const count = sizes.get(k)!, times = count > 1 ? ` ×${count}` : '';
        drawn.push({ ...base, secondary: false, type: 'dim', id: `${f.id}_${axisName(u)}${suffix}`, axis: axisName(u), from: P(b.min[u]!, b.max[v]!, own), to: P(b.max[u]!, b.max[v]!, own), offset: scale(unit(v), gap * 0.35), text: `${fmt(su)}${times}` });
        drawn.push({ ...base, secondary: false, type: 'dim', id: `${f.id}_${axisName(v)}${suffix}`, axis: axisName(v), from: P(b.max[u]!, b.min[v]!, own), to: P(b.max[u]!, b.max[v]!, own), offset: scale(unit(u), gap * 0.35), text: fmt(sv) });
      }
      drawn.push({ ...base, secondary: false, type: 'path', id: `${f.id}${suffix}`, paths, position: P(b.min[u]!, b.min[v]!, own), text: f.id });
    }

    // Holes and bosses: a circle on each, the diameter and depth labelled once per identical group.
    const groups = new Map<string, number>();
    const cylinders = onPlane.filter((f): f is Cylinder => isCylinder(f) && f.kind !== 'radius');
    for (const f of cylinders) { const k = `${f.kind}:${key(f.radius)}:${key(f.start)}:${key(f.end)}`; groups.set(k, (groups.get(k) ?? 0) + 1); }
    const labelled = new Set<string>();
    for (const f of cylinders) {
      const k = `${f.kind}:${key(f.radius)}:${key(f.start)}:${key(f.end)}`;
      const center: Point = [...f.center]; center[n] = face === 'max' ? f.end : f.start;
      let text = '';
      if (!labelled.has(k)) {
        labelled.add(k);
        const count = groups.get(k)!;
        const through = near(f.start, min[n]!) && near(f.end, max[n]!);
        text = `${f.id} Ø${fmt(f.radius * 2)}${count > 1 ? ` ×${count}` : ''}${through ? ' THRU' : `, ${fmt(f.end - f.start)} deep`}`;
      }
      drawn.push({ ...base, secondary: false, type: 'circle', id: `${f.id}${suffix}`, center, radius: f.radius, text });
    }

    // Fillets and arcs: one radius per distinct value, on the first face that shows it.
    const radii = new Map<number, number>();
    const arcs = part.features.filter((f): f is Cylinder => isCylinder(f) && f.kind === 'radius' && f.axis === n && facesOf(f)[0] === face);
    for (const f of arcs) radii.set(key(f.radius), (radii.get(key(f.radius)) ?? 0) + 1);
    const shownRadii = new Set<number>();
    for (const f of arcs) {
      if (shownRadii.has(key(f.radius))) continue;
      shownRadii.add(key(f.radius));
      const count = radii.get(key(f.radius))!;
      const from: Point = [...f.center]; from[n] = f.point[n]!;
      drawn.push({ ...base, secondary: false, type: 'dim', id: `${f.id}${suffix}`, axis: axisName(u), from, to: f.point, offset: [0, 0, 0], text: `R${fmt(f.radius)}${count > 1 ? ` ×${count}` : ''}` });
    }
  }
  return { drawn };
}

/** Baseline locations reference this part's minimum XYZ, never the photographed object's datum. */
export function featureRows(part: CadPart): string[] {
  const origin = part.bounds.min;
  const location = (p: Point, axes = [0, 1, 2]) => axes.map(i => `${xyz[i]} ${fmt(p[i]! - origin[i]!)}`).join(', ');
  return part.features.flatMap(f => {
    const axes = [0, 1, 2].filter(i => i !== f.axis);
    if ('radius' in f) return [`${f.id} ${f.kind}: ${f.kind === 'radius' ? 'R' : 'Ø'}${fmt(f.radius * (f.kind === 'radius' ? 1 : 2))}; center ${location(f.center, axes)}; ${xyz[f.axis]} start ${fmt(f.start - origin[f.axis])}; axial length ${fmt(f.end - f.start)}`];
    const size = axes.map(i => `${xyz[i]} span ${fmt(f.bounds.max[i]! - f.bounds.min[i]!)}`).join(', ');
    const main = `${f.id} ${f.kind}: ${size}; min ${location(f.bounds.min, axes)}; ${xyz[f.axis]} levels ${f.levels.map(v => fmt(v - origin[f.axis])).join(', ')}`;
    if (f.kind === 'rectangle') return [main];
    // A profile envelope alone does not define a non-rectangular contour. Keep its
    // actual edge endpoints and arc radii available in the engineering schedule.
    return [main, ...f.segments.map((edge, i) => `${f.id}.${i + 1} ${edge.radius == null ? 'line' : `arc R${fmt(edge.radius)}`}: (${location(edge.start, axes)}) → (${location(edge.end, axes)})${edge.radius == null ? '' : `; arc length ${fmt(edge.length)}`}`)];
  });
}
