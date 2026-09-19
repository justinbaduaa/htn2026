import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const run = promisify(execFile);
const BIN = process.env.PRUSA_SLICER ?? '/Applications/PrusaSlicer.app/Contents/MacOS/PrusaSlicer';
const CONFIG = join(process.cwd(), 'slicer', 'ender3v2.ini');

/** Slices one STL in place. Returns the G-code path and estimated minutes from the file footer, or null if the slicer is unavailable. */
export async function slice(stlPath: string): Promise<{ gcode: string; minutes: number | null } | null> {
  const gcode = stlPath.replace(/\.stl$/, '.gcode');
  try {
    await run(BIN, ['--export-gcode', '--printer-technology', 'FFF', '--load', CONFIG, '--output', gcode, stlPath], { timeout: 180_000 });
  } catch (error) {
    console.error('slice failed', error);
    return null;
  }
  const text = await readFile(gcode, 'utf8');
  const m = /estimated printing time \(normal mode\) = (?:(\d+)h )?(?:(\d+)m )?(?:(\d+)s)?/.exec(text);
  const minutes = m ? Number(m[1] ?? 0) * 60 + Number(m[2] ?? 0) : null;
  return { gcode, minutes };
}
