import { expect, test } from 'vitest';
import { holesOf, planAssembly } from './assembly';
import { cadGeometrySchema } from '../shared/cadGeometry';
import { dimsFileSchema } from '../shared/types';
import geometryJson from './fixtures/badge-case-geometry.json';
import dimsJson from './fixtures/badge-case-dims.json';

const geometry = cadGeometrySchema.parse(geometryJson);
const dims = dimsFileSchema.parse(dimsJson);
const front = geometry.parts.find(p => p.name === 'front_plate')!;
const rear = geometry.parts.find(p => p.name === 'rear_plate_with_integral_spacer_walls')!;

test('front plate holes are counterbored at the printed face; rear holes have hex nut pockets', () => {
  const f = holesOf(front), r = holesOf(rear);
  expect(f).toHaveLength(4); expect(r).toHaveLength(4);
  for (const h of f) { expect(h.counterbore?.radius).toBeCloseTo(4.22, 1); expect(h.counterbore?.depth).toBeCloseTo(3.4, 1); expect(h.pocketDepth).toBe(0); }
  for (const h of r) { expect(h.counterbore).toBeNull(); expect(h.pocketDepth).toBeCloseTo(3.5, 1); expect(h.radius).toBeCloseTo(2.6, 1); }
});

test('the counterbored part goes on top, flipped about X so its holes meet the rear holes', () => {
  const plan = planAssembly(geometry, dims.plan, dims);
  expect(plan.base.part).toBe('rear_plate_with_integral_spacer_walls');
  expect(plan.top.part).toBe('front_plate');
  expect(plan.top.flip).toBe('x');
  expect(plan.top.z).toBeCloseTo(17.7, 1);
  expect(plan.height).toBeCloseTo(17.7 + 7.53, 1);
  expect(plan.screws).toHaveLength(4);
  // Rear frame is the PCB frame mirrored in Y: (3.4, 18) becomes (3.4, 95.03 - 18).
  expect(plan.screws.some(s => Math.abs(s.x - 3.4) < 0.1 && Math.abs(s.y - 77.03) < 0.2)).toBe(true);
  expect(plan.base.letter).toBe('B'); expect(plan.top.letter).toBe('A'); expect(plan.object?.letter).toBe('C');
});

test('hardware comes from the plan wording and the measured readings', () => {
  const { hardware, object, steps, counterboreDepth, pocketDepth } = planAssembly(geometry, dims.plan, dims);
  expect(hardware.thread).toBe(4);
  expect(hardware.headDiameter).toBe(7.85);
  expect(hardware.headHeight).toBe(3.13);
  expect(hardware.nutAcrossFlats).toBe(6.8);
  expect(hardware.nutThickness).toBe(3.2);
  expect(hardware.hasNuts).toBe(true);
  expect(counterboreDepth).toBeCloseTo(3.4, 1); expect(pocketDepth).toBeCloseTo(3.5, 1);
  // 25.23 tall, minus the 3.4 head recess, minus the 0.3 the nut sits below the pocket mouth: 21.5 rounds up to a 25 mm screw.
  expect(hardware.screwLength).toBe(25);
  expect(object?.name).toMatch(/PCB/);
  expect(object?.size).toEqual([147.35, 95.03, 1.7]);
  expect(steps.map(s => s.kind)).toEqual(['insert-object', 'place-top', 'screws', 'flip', 'nuts', 'tighten']);
  expect(steps[2]!.caption).toContain('4 M4 × 25 mm screws');
});

test('without a plan or readings it still produces a screw-and-nut sequence from geometry alone', () => {
  const plan = planAssembly(geometry, null, null);
  expect(plan.object).toBeNull();
  expect(plan.hardware.thread).toBe(4);   // 5.2 mm bores clear an M4
  expect(plan.hardware.hasNuts).toBe(true);   // hex pockets
  expect(plan.steps.map(s => s.kind)).toEqual(['place-top', 'screws', 'flip', 'nuts', 'tighten']);
});
