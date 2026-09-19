import { z } from 'zod';

// Kinds the checker understands. `other` is only passed through to the model.
export const dimensionKind = z.enum(['extent_x', 'extent_y', 'extent_z', 'hole_diameter', 'hole_x', 'hole_y', 'other']);

// required: Generate is blocked until it is measured or skipped (outline, mounting holes, heights, hardware).
// recommended: an opening or clearance the part should get right; skippable, and left blank the plan's
// default_mm is used as an estimate. optional: cosmetic, always with a default.
export const dimensionPriority = z.enum(['required', 'recommended', 'optional']);
export type DimensionPriority = z.infer<typeof dimensionPriority>;
export const priorityOrder: Record<DimensionPriority, number> = { required: 0, recommended: 1, optional: 2 };

export const requestedDimensionSchema = z.strictObject({
  id: z.string().min(1).max(40),
  name: z.string().max(160),
  why: z.string().max(400),
  critical: z.boolean(),   // kept for the checker and older plans; always equals priority === 'required' after normalizePlan
  priority: dimensionPriority.default('optional'),
  kind: dimensionKind,
  hole: z.string().max(20).nullable(),   // groups hole_x, hole_y, hole_diameter for one hole
  // Category this reading belongs to, e.g. "LCD opening", "Up button", "USB-C port". Atomic
  // readings for one feature share a group so the UI can show collapsible, check-off categories.
  // null for a standalone reading. The hole grouping above still drives the checker.
  group: z.string().max(80).nullable().default(null),
  photo: z.number().int().min(0),
  // How to draw the callout. line: from (x,y) to (x+w,y+h). circle: inscribed in the box. none: not visible in the photo.
  shape: z.enum(['box', 'line', 'circle', 'none']).default('box'),
  box: z.strictObject({ x: z.number().min(0).max(1), y: z.number().min(0).max(1), w: z.number().min(0).max(1), h: z.number().min(0).max(1) }),
  default_mm: z.number().nullable(),
});

export const planSchema = z.strictObject({
  title: z.string().max(100),
  summary: z.string().max(800),
  parts: z.array(z.strictObject({ name: z.string().max(60), printed: z.boolean(), purpose: z.string().max(200) })).max(8),
  dimensions: z.array(requestedDimensionSchema).max(120),   // one number per reading, so a fully decomposed part runs well past 20; accepted mid-run requests push higher still
  question: z.string().max(400),   // non-empty only when photos are unusable
});
export type Plan = z.infer<typeof planSchema>;
export type RequestedDimension = z.infer<typeof requestedDimensionSchema>;

/**
 * Makes priority the single source of truth and orders the list most to least relevant.
 * Plans written before priorities existed only carry `critical`; those get a priority derived from it.
 */
export function normalizePlan(plan: Plan): Plan {
  const legacy = plan.dimensions.length > 0 && plan.dimensions.every(d => d.priority === 'optional') && plan.dimensions.some(d => d.critical);
  for (const d of plan.dimensions) {
    if (legacy) d.priority = d.critical ? 'required' : 'optional';
    d.critical = d.priority === 'required';
  }
  plan.dimensions.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);
  return plan;
}

// What the user entered. Model-requested dimensions keep their id; user-added ones get `user_<n>`.
export const enteredDimensionSchema = z.strictObject({
  id: z.string(),
  name: z.string(),
  kind: dimensionKind,
  hole: z.string().nullable().default(null),
  value_mm: z.number().nonnegative(),   // 0 is a real answer: "nothing sticks out"
  estimated: z.boolean().default(false),   // true when value_mm is the plan's default_mm, not a caliper reading
});
export const constantsSchema = z.strictObject({ fit_clearance_mm: z.number(), hole_compensation_mm: z.number(), wall_mm: z.number() });
export const dimsFileSchema = z.strictObject({
  title: z.string(),
  plan: planSchema,
  description: z.string().default(''),
  dimensions: z.array(enteredDimensionSchema),
  constants: constantsSchema,
  notes: z.string().default(''),
  skipped: z.array(z.string()).default([]),   // requested dimension ids the user chose not to give
});
export type DimsFile = z.infer<typeof dimsFileSchema>;

export const checkResultSchema = z.strictObject({
  ok: z.boolean(),
  parts: z.array(z.strictObject({ name: z.string(), ok: z.boolean(), reasons: z.array(z.string()), volume_mm3: z.number(), bbox_mm: z.tuple([z.number(), z.number(), z.number()]) })),
  error: z.string().nullable(),
});
export type CheckResult = z.infer<typeof checkResultSchema>;

// Written by the model when it needs a measurement it does not have.
export const needsFileSchema = z.strictObject({ dimensions: z.array(requestedDimensionSchema).min(1).max(40) });

// A user question about one requested dimension, and the model's answer. The model may also rewrite the dimension to be clearer.
export const clarificationSchema = z.strictObject({ question: z.string().max(600), answer: z.string().max(1200) });
export const askResponseSchema = z.strictObject({
  answer: z.string().max(1200),
  revised: requestedDimensionSchema.nullable(),   // same id, clearer name, why, or callout; null if no change needed
});
export type AskResponse = z.infer<typeof askResponseSchema>;

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
  skipped: z.array(z.string()).default([]),          // requested dimension ids the user passed on; excluded from dims.json
  notes: z.string(),
  clarifications: z.record(z.string(), z.array(clarificationSchema)).default({}),   // dimension id -> Q&A thread
  runs: z.array(runSchema),
});
export type Project = z.infer<typeof projectSchema>;
