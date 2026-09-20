import type { CadGeometry, CadPart } from '../shared/cadGeometry';
import type { DimsFile, Plan } from '../shared/types';

/**
 * Assembly planning from the exported solids and the run's dims.json. No model call: the parts, their
 * screw holes, which side takes the screw head (counterbores) and which the nut (hex pockets) are all read
 * from the STEP measurements, and the hardware sizes from what the user measured.
 */

export type Hole = { x: number; y: number; radius: number; counterbore: { radius: number; depth: number } | null; pocketDepth: number };
export type Hardware = { thread: number; headDiameter: number; headHeight: number; nutAcrossFlats: number; nutThickness: number; screwLength: number; hasNuts: boolean };
/** flip: rotate 180° about that axis through the part's bounds centre, then lift so its lowest point sits at z. */
export type Placement = { part: string; letter: string; flip: 'none' | 'x' | 'y'; z: number; height: number };
export type Insert = { name: string; letter: string; size: [number, number, number]; z: number };
export type StepKind = 'insert-object' | 'place-top' | 'screws' | 'flip' | 'nuts' | 'tighten';
export type Step = { n: number; kind: StepKind; caption: string; count: number };
export type AssemblyPlan = {
  base: Placement; top: Placement; object: Insert | null;
  screws: { x: number; y: number }[];   // in the base part's frame
  hardware: Hardware; height: number; steps: Step[];
  counterboreDepth: number; pocketDepth: number;
};

const near = (a: number, b: number, tol = 0.5) => Math.abs(a - b) <= tol;

/** Vertical screw holes of a part: concentric bores grouped by centre, with any counterbore at the bottom face and any hex pocket depth. */
export function holesOf(part: CadPart): Hole[] {
  const zMin = part.bounds.min[2];
  type Cylinder = Extract<CadPart['features'][number], { center: unknown }>;
  const bores = part.features.filter((f): f is Cylinder => f.kind === 'bore' && f.axis === 2);
  const groups: Hole[] = [];
  for (const b of bores) {
    const [x, y] = [b.center[0], b.center[1]];
    let g = groups.find(h => near(h.x, x, 0.6) && near(h.y, y, 0.6));
    if (!g) { g = { x, y, radius: b.radius, counterbore: null, pocketDepth: 0 }; groups.push(g); }
    g.radius = Math.min(g.radius, b.radius);
  }
  for (const g of groups) {
    const own = bores.filter(b => near(b.center[0], g.x, 0.6) && near(b.center[1], g.y, 0.6));
    const larger = own.filter(b => b.radius > g.radius + 0.2 && near(Math.min(b.start, b.end), zMin, 0.3));
    if (larger.length) {
      const cb = larger.sort((a, b) => b.radius - a.radius)[0]!;
      g.counterbore = { radius: cb.radius, depth: Math.abs(cb.end - cb.start) };
    }
    const hex = part.features.find(f => f.kind === 'profile' && f.axis === 2 && f.vertices.length === 6
      && f.bounds.min[0] <= g.x && g.x <= f.bounds.max[0] && f.bounds.min[1] <= g.y && g.y <= f.bounds.max[1] && f.levels.some(l => near(l, zMin, 0.3)));
    if (hex && hex.kind === 'profile') g.pocketDepth = Math.max(...hex.levels) - zMin;
    else if (!g.counterbore) {
      const lowest = Math.min(...own.map(b => Math.min(b.start, b.end)));
      if (lowest > zMin + 0.3) g.pocketDepth = lowest - zMin;
    }
  }
  return groups.sort((a, b) => a.y - b.y || a.x - b.x);
}

type Centre = { x: number; y: number };
const flipPoint = (p: Centre, flip: Placement['flip'], part: CadPart): Centre => {
  const cx = (part.bounds.min[0] + part.bounds.max[0]) / 2, cy = (part.bounds.min[1] + part.bounds.max[1]) / 2;
  return flip === 'x' ? { x: p.x, y: 2 * cy - p.y } : flip === 'y' ? { x: 2 * cx - p.x, y: p.y } : p;
};
const pairingError = (base: Centre[], top: Centre[]) => base.reduce((s, b) => s + Math.min(...top.map(t => Math.hypot(t.x - b.x, t.y - b.y))), 0);

const STANDARD_LENGTHS = [8, 10, 12, 16, 20, 25, 30, 35, 40, 45, 50, 60];
const NUT_AF: Record<number, number> = { 2: 4, 2.5: 5, 3: 5.5, 4: 7, 5: 8, 6: 10, 8: 13, 10: 17 };

function value(dims: DimsFile | null, pattern: RegExp, kind?: string): number | null {
  const hit = dims?.dimensions.find(d => (!kind || d.kind === kind) && pattern.test(`${d.id} ${d.name}`) && d.value_mm > 0);
  return hit ? hit.value_mm : null;
}

export function planAssembly(geometry: CadGeometry, plan: Plan | null, dims: DimsFile | null): AssemblyPlan {
  const parts = geometry.parts;
  if (parts.length === 0) throw new Error('No parts to assemble');
  const holes = new Map(parts.map(p => [p.name, holesOf(p)]));
  // The part whose holes are counterbored takes the screw heads and goes on top. Otherwise the taller part is the base.
  const scored = parts.map(p => ({ p, cb: holes.get(p.name)!.filter(h => h.counterbore).length, pockets: holes.get(p.name)!.filter(h => h.pocketDepth > 0).length, height: p.bounds.max[2] - p.bounds.min[2] }));
  const topPart = parts.length === 1 ? null : [...scored].sort((a, b) => b.cb - a.cb || a.pockets - b.pockets || a.height - b.height)[0]!.p;
  const basePart = scored.filter(s => s.p !== topPart).sort((a, b) => b.pockets - a.pockets || b.height - a.height)[0]!.p;
  const printedNames = plan?.parts.filter(p => p.printed).map(p => p.name) ?? [];
  const letterOf = (name: string) => {
    const i = printedNames.findIndex(n => n.toLowerCase().replace(/[^a-z0-9]+/g, '_') === name.toLowerCase());
    return String.fromCharCode(65 + (i >= 0 ? i : parts.findIndex(p => p.name === name)));
  };
  const baseHoles = holes.get(basePart.name)!;
  const base: Placement = { part: basePart.name, letter: letterOf(basePart.name), flip: 'none', z: 0, height: basePart.bounds.max[2] - basePart.bounds.min[2] };

  let top: Placement | null = null, cbDepth = 0;
  if (topPart) {
    const topHoles = holes.get(topPart.name)!;
    const flips: Placement['flip'][] = ['x', 'y', 'none'];
    const flip = baseHoles.length && topHoles.length
      ? flips.map(f => ({ f, e: pairingError(baseHoles, topHoles.map(h => flipPoint(h, f, topPart))) })).sort((a, b) => a.e - b.e)[0]!.f
      : 'x';
    top = { part: topPart.name, letter: letterOf(topPart.name), flip, z: base.height, height: topPart.bounds.max[2] - topPart.bounds.min[2] };
    cbDepth = Math.max(0, ...topHoles.map(h => h.counterbore?.depth ?? 0));
  }
  const pocketDepth = Math.max(0, ...baseHoles.map(h => h.pocketDepth));
  const height = base.height + (top?.height ?? 0);

  // The object the case is built around: the first non-printed part that is not hardware or a battery.
  const isHardware = (n: string) => /\b(screw|bolt|nut|washer|insert|standoff)/i.test(n);
  const isLooseBattery = (n: string) => /batter/i.test(n) && !/pcb|board|assembl|electronic/i.test(n);
  const objectPart = plan?.parts.find(p => !p.printed && !isHardware(p.name) && !isLooseBattery(p.name)) ?? null;
  const W = value(dims, /./, 'extent_x'), H = value(dims, /./, 'extent_y');
  const thickness = value(dims, /thick/i, 'other') ?? 1.6;
  const object: Insert | null = objectPart && W && H
    ? { name: objectPart.name, letter: String.fromCharCode(65 + printedNames.length), size: [W, H, thickness], z: base.height }
    : null;

  // Hardware: thread from the plan's wording, else from the hole; the rest from measurements, else standard sizes.
  const hardwareNames = plan?.parts.filter(p => !p.printed && isHardware(p.name)).map(p => p.name).join(' ') ?? '';
  const holeD = 2 * Math.min(...[...baseHoles, ...(top ? holes.get(top.part)! : [])].map(h => h.radius), Infinity);
  const named = /M(\d+(?:\.\d+)?)/.exec(hardwareNames);
  const thread = named ? Number(named[1]) : [10, 8, 6, 5, 4, 3, 2.5, 2].find(m => m + 0.3 <= holeD) ?? 4;
  const headDiameter = value(dims, /head.*(diam|width)|screw head/i) ?? 2 * thread;
  const headHeight = value(dims, /head.*(height|thick|depth)/i) ?? 0.7 * thread;
  const nutAcrossFlats = value(dims, /across flats|nut.*(af|width)/i) ?? NUT_AF[thread] ?? 1.75 * thread;
  const nutThickness = value(dims, /nut.*(thick|height|depth)/i) ?? 0.8 * thread;
  const hasNuts = /nut/i.test(hardwareNames) || pocketDepth > 0;
  const needed = height - cbDepth - (hasNuts ? pocketDepth - nutThickness : 0);
  const screwLength = value(dims, /screw.*length/i) ?? (STANDARD_LENGTHS.find(l => l >= needed) ?? Math.ceil(needed));
  const hardware: Hardware = { thread, headDiameter, headHeight, nutAcrossFlats, nutThickness, screwLength, hasNuts };

  const screws = baseHoles.map(h => ({ x: h.x, y: h.y }));
  const n = screws.length;
  const pretty = (s: string) => s.replace(/_/g, ' ');
  const steps: Step[] = [];
  const add = (kind: StepKind, caption: string, count = 1) => steps.push({ n: steps.length + 1, kind, caption, count });
  const baseName = `${base.letter} (${pretty(base.part)})`;
  if (object) add('insert-object', `Lay ${baseName} on the table with its open side up. Lower ${object.letter} (${object.name}) into it so the ${n} holes line up.`);
  if (top) add('place-top', `Turn ${top.letter} (${pretty(top.part)}) over so its outside faces up, and set it on top${object ? ' of ' + object.letter : ''}. The holes line up.`);
  add('screws', `Drop ${n} M${thread} × ${screwLength} mm screws into the holes from the top${cbDepth > 0 ? '. The heads sit down in their recesses' : ''}.`, n);
  if (hasNuts) {
    add('flip', 'Hold the parts together and turn the whole assembly over.');
    add('nuts', `Fit ${n} M${thread} nuts onto the screw ends${pocketDepth > 0 ? '. Each one drops into its hex pocket' : ''}.`, n);
  }
  add('tighten', hasNuts ? 'Hold each nut and tighten its screw with a screwdriver until snug. Do not over-tighten. Turn it back over: done.' : 'Tighten the screws with a screwdriver until snug. Do not over-tighten. Done.', n);

  return { base, top: top ?? base, object, screws, hardware, height, steps, counterboreDepth: cbDepth, pocketDepth };
}
