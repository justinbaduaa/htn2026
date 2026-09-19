import { z } from 'zod';
const point = z.tuple([z.number(), z.number(), z.number()]);
const bounds = z.object({ min: point, max: point });
const axis = z.union([z.literal(0), z.literal(1), z.literal(2)]);
const cylinder = z.object({ id: z.string(), kind: z.enum(['bore', 'boss', 'radius']), axis, center: point, radius: z.number().positive(), start: z.number(), end: z.number(), point });
// `opens` says which face each level is seen from (its outward normal), parallel to `levels`.
const profile = z.object({ id: z.string(), kind: z.enum(['rectangle', 'profile']), axis, bounds, levels: z.array(z.number()), opens: z.array(z.enum(['min', 'max'])).optional(), vertices: z.array(point), paths: z.array(z.array(point)), segments: z.array(z.object({ start: point, end: point, length: z.number(), radius: z.number().nullable() })) });
export const cadPartSchema = z.object({ name: z.string(), bounds, features: z.array(z.union([cylinder, profile])), notes: z.array(z.string()) });
export const cadGeometrySchema = z.object({ source: z.literal('STEP'), units: z.literal('mm'), parts: z.array(cadPartSchema) });
export type CadPart = z.infer<typeof cadPartSchema>;
export type CadGeometry = z.infer<typeof cadGeometrySchema>;
