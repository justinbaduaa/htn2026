import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { cadGeometrySchema, type CadGeometry } from '../src/shared/cadGeometry';
import type { Run } from '../src/shared/types';
const execute = promisify(execFile);
const cache = new Map<string, Promise<CadGeometry>>();

/** Read the actual exported solids, also for runs created before CAD dimensioning existed. */
export async function measureRun(directory: string, files: Run['files']): Promise<CadGeometry> {
  const paths = files.map(f => {
    if (basename(f.step) !== f.step || !f.step.endsWith('.step')) throw new Error('Invalid STEP filename');
    return join(directory, f.step);
  });
  const versions = await Promise.all(paths.map(async p => { const s = await stat(p); return `${p}:${s.size}:${s.mtimeMs}`; }));
  const extractor = join(process.cwd(), 'cad', 'measure.py');
  const extractorVersion = (await stat(extractor)).mtimeMs;
  const key = `${extractorVersion}|${versions.join('|')}`;
  const cached = cache.get(key); if (cached) return cached;
  const result = execute(join(process.cwd(), '.venv', 'bin', 'python'), [extractor, ...paths], { timeout: 120_000, maxBuffer: 16 * 1024 * 1024 })
    .then(({ stdout }) => {
      const geometry = cadGeometrySchema.parse(JSON.parse(stdout));
      geometry.parts.forEach((part, i) => { part.name = files[i]!.part; });
      return geometry;
    }).catch(error => { cache.delete(key); throw error; });
  if (cache.size >= 20) cache.delete(cache.keys().next().value!);
  cache.set(key, result);
  return result;
}
