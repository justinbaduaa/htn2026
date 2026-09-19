import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { DimsFile, Plan, RequestedDimension } from '../src/shared/types';

// App-owned print constants. The model is told these, it never chooses them.
export const constants = { fit_clearance_mm: 0.3, hole_compensation_mm: 0.2, wall_mm: 2.4 };

export const planPrompt = (description: string) => `You are helping someone 3D print a part that fits a real object shown in the attached photos, usually a case, mount, bracket, or replacement piece.
Return JSON matching the schema. Rules:
- Identify the object and propose the printed part or parts. List parts that are NOT printed (screws, the object itself) with printed=false.
- List the dimensions the user must measure with calipers. Mark critical=true for anything that affects fit: outline extents, hole centers, hole diameters, tallest component height, mating surfaces, port positions. Mark critical=false for cosmetic dimensions and give a default_mm.
- Coordinate frame: the object's bottom-left corner in the first photo is X=0,Y=0; X to the right, Y up. Hole positions are measured from that corner to the hole center. Give hole_x, hole_y, hole_diameter as three dimensions sharing the same hole id (h1, h2, ...).
- kinds: extent_x, extent_y, extent_z (tallest point above the object's flat face), hole_x, hole_y, hole_diameter, other.
- For every dimension give the photo index (0-based: the first attached photo is 0), a shape, and a normalized box (0..1, origin top-left). Shapes: "line" for a length between two edges, drawn from (x,y) to (x+w,y+h) exactly where the caliper jaws go, so a width is a horizontal line across the object at some y; "circle" for a hole, with the box tightly around the hole; "box" for a region; "none" when the thing is not visible in any photo, such as a height above the board seen from the top, or the back of the object. Callouts are hints; the name and why must stand on their own.
- At most 20 dimensions. Prefer fewer, but never drop a mounting hole: every screw hole needs its own hole_x, hole_y, hole_diameter, because hole positions are what makes the part fit. Do not ask for anything you can default safely.
- If the photos are unusable, set question to what you need and leave dimensions empty. Otherwise question is "".

The user's own description of the object and what they want printed. It overrides anything you infer from the photos:
${description || '(none given)'}`;

/** The user did not understand one requested dimension. Explain it in plain words and, if the wording or callout was the problem, rewrite the dimension. */
export function askPrompt(description: string, plan: Plan, dimension: RequestedDimension, prior: { question: string; answer: string }[], question: string) {
  return `A user is measuring a real object with calipers so a part can be 3D printed to fit it. The photos are attached. They asked for clarification about ONE requested measurement.

Object and goal, in the user's words: ${description || '(none given)'}
Part plan: ${plan.title}. ${plan.summary}
All requested measurements, for context: ${plan.dimensions.map(d => `${d.id}: ${d.name}`).join('; ')}

The measurement in question:
${JSON.stringify(dimension, null, 2)}
${prior.length ? `\nEarlier questions about it:\n${prior.map(p => `Q: ${p.question}\nA: ${p.answer}`).join('\n')}\n` : ''}
The user's question: ${question}

Answer in plain words, at most a few sentences: what exactly to measure, where to put the caliper jaws, and what to do if it does not apply to their object. If the name, why, or callout was unclear or wrong, return a revised dimension with the same id, kind, and hole, with clearer name and why and a callout that actually lands on the right place in the photo (shape line from x,y to x+w,y+h for lengths, circle tight around a hole, none if not visible). Otherwise revised is null.`;
}

export function generatePrompt(dims: DimsFile, previous: string | null) {
  const dir = join(process.cwd(), 'cad', 'examples');
  const examples = readdirSync(dir).filter(f => f.endsWith('.py')).sort()
    .map(f => `### ${f}\n\`\`\`python\n${readFileSync(join(dir, f), 'utf8')}\`\`\``).join('\n\n');
  return `Write part.py in this folder: CadQuery code that builds the printed part(s) for the object described in dims.json, then run \`python check.py\` and fix part.py until check.json says ok=true. The venv on PATH has cadquery 2.8.0.

Contract for part.py:
- Define parts: dict[str, cq.Workplane], one entry per printed part, keys matching the plan's printed part names in snake_case.
- Millimeters, Z up. Each part sits on Z=0 in the orientation it will be printed. A lid with an open bottom is printed upside down, so model it with its closed face on Z=0.
- The object's outline corner is X=0,Y=0. hole_x/hole_y in dims.json are in that frame. Every hole in dims.json must exist in at least one part at those XY coordinates with diameter = hole_diameter + hole_compensation_mm.
- Add fit_clearance_mm around the object where it sits inside a part. Walls are wall_mm unless a dimension says otherwise.
- One solid per part. No threads. Fillets only on outer vertical edges and only if the wall allows the radius.
- Do not write any other files. Do not read anything outside this folder. Do not use network.

If you need a measurement that dims.json does not have and cannot default safely, write needs.json as {"dimensions":[{"id","name","why","critical":true,"kind","hole","photo","shape","box":{"x","y","w","h"},"default_mm":null}]} and stop without writing part.py. The user's photos are attached so you can place each callout: photo is the 0-based photo index; shape is "line" (from x,y to x+w,y+h, where the caliper jaws go), "circle" (box tight around a hole), "box" (a region), or "none" (not visible in any photo); box coordinates are normalized 0..1 with origin top-left. Give each requested dimension its own callout, never the same box twice. Ask for as few as possible and never for anything you can default.

Common failures to avoid: a workplane on a "<Z" face mirrors X, so cut holes with an XY cylinder in global coordinates instead; fillet radius larger than the wall; calling methods that do not exist (there is no .cone() or .array()); filleting before a solid exists; holes at the wrong coordinates because a box was centered; parts that touch at an edge instead of overlapping.

dims.json:
\`\`\`json
${JSON.stringify(dims, null, 2)}
\`\`\`
${dims.description ? `\nThe user's description of the object and what they want:\n${dims.description}\n` : ''}${dims.notes ? `\nUser notes about what went wrong last time or what they want changed:\n${dims.notes}\n` : ''}${previous ? `\nPrevious part.py (keep what worked, change what the notes say was wrong):\n\`\`\`python\n${previous}\`\`\`\n` : ''}
Worked examples in the same contract:

${examples}`;
}
