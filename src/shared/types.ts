import { z } from 'zod';

// Kinds the checker understands. `other` is only passed through to the model.
export const dimensionKind = z.enum(['extent_x', 'extent_y', 'extent_z', 'hole_diameter', 'hole_x', 'hole_y', 'other']);

export const requestedDimensionSchema = z.strictObject({
  id: z.string().min(1).max(40),
  name: z.string().max(80),
  why: z.string().max(200),
  critical: z.boolean(),
  kind: dimensionKind,
  hole: z.string().max(20).nullable(),   // groups hole_x, hole_y, hole_diameter for one hole
  photo: z.number().int().min(0),
  box: z.strictObject({ x: z.number().min(0).max(1), y: z.number().min(0).max(1), w: z.number().min(0).max(1), h: z.number().min(0).max(1) }),
  default_mm: z.number().nullable(),
});

export const planSchema = z.strictObject({
  title: z.string().max(100),
  summary: z.string().max(800),
  parts: z.array(z.strictObject({ name: z.string().max(60), printed: z.boolean(), purpose: z.string().max(200) })).max(8),
  dimensions: z.array(requestedDimensionSchema).max(20),
  question: z.string().max(400),   // non-empty only when photos are unusable
});
export type Plan = z.infer<typeof planSchema>;
export type RequestedDimension = z.infer<typeof requestedDimensionSchema>;

// What the user entered. Model-requested dimensions keep their id; user-added ones get `user_<n>`.
export const enteredDimensionSchema = z.strictObject({
  id: z.string(),
  name: z.string(),
  kind: dimensionKind,
  hole: z.string().nullable().default(null),
  value_mm: z.number().positive(),
});
export const constantsSchema = z.strictObject({ fit_clearance_mm: z.number(), hole_compensation_mm: z.number(), wall_mm: z.number() });
export const dimsFileSchema = z.strictObject({
  title: z.string(),
  plan: planSchema,
  description: z.string().default(''),
  dimensions: z.array(enteredDimensionSchema),
  constants: constantsSchema,
  notes: z.string().default(''),
});
export type DimsFile = z.infer<typeof dimsFileSchema>;

export const checkResultSchema = z.strictObject({
  ok: z.boolean(),
  parts: z.array(z.strictObject({ name: z.string(), ok: z.boolean(), reasons: z.array(z.string()), volume_mm3: z.number(), bbox_mm: z.tuple([z.number(), z.number(), z.number()]) })),
  error: z.string().nullable(),
});
export type CheckResult = z.infer<typeof checkResultSchema>;

// Written by the model when it needs a measurement it does not have.
export const needsFileSchema = z.strictObject({ dimensions: z.array(requestedDimensionSchema).min(1).max(6) });

export const runSchema = z.strictObject({
  n: z.number().int(),
  started: z.string(),
  status: z.enum(['running', 'needs_dimensions', 'failed', 'done']),
  error: z.string().nullable(),
  check: checkResultSchema.nullable(),
  needs: z.array(requestedDimensionSchema).nullable(),
  files: z.array(z.strictObject({ part: z.string(), step: z.string(), stl: z.string(), gcode: z.string().nullable(), minutes: z.number().nullable() })),
});
export type Run = z.infer<typeof runSchema>;

export const projectSchema = z.strictObject({
  id: z.string(),
  title: z.string(),
  created: z.string(),
  photos: z.array(z.string()),
  description: z.string().default(''),   // what the user typed at creation
  plan: planSchema.nullable(),
  values: z.record(z.string(), z.number()),          // dimension id -> mm
  extra: z.array(enteredDimensionSchema),            // user-added dimensions
  notes: z.string(),
  runs: z.array(runSchema),
});
export type Project = z.infer<typeof projectSchema>;
