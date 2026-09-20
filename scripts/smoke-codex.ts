// One real generate run from the fixture dims, no UI. Needs codex login and the venv.
// Run: pnpm exec tsx scripts/smoke-codex.ts [photo.jpg]   (defaults to the newest project's first photo)
import { mkdtempSync, copyFileSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { generatePrompt } from '../server/prompts';
import { codex } from '../server/model';
import { ROOT as PROJECTS } from '../server/store';

function newestProjectPhoto(): string | null {
  if (!existsSync(PROJECTS)) return null;
  const ids = readdirSync(PROJECTS).sort().reverse();
  for (const id of ids) { const p = join(PROJECTS, id, 'photos', '0.jpg'); if (existsSync(p)) return p; }
  return null;
}

const photo = process.argv[2] ?? newestProjectPhoto();
if (!photo || !existsSync(photo)) { console.error('No photo. Pass a path or create a project first.'); process.exit(1); }
const dir = mkdtempSync(join(tmpdir(), 'smoke-'));
copyFileSync('src/app/fixtures/badge-dims.json', join(dir, 'dims.json'));
copyFileSync('cad/check.py', join(dir, 'check.py'));
console.log('run folder:', dir);
const dims = JSON.parse(readFileSync(join(dir, 'dims.json'), 'utf8'));
const started = Date.now();
await codex.generate(dir, generatePrompt(dims, null), new AbortController().signal, [photo]);
console.log(`codex finished in ${Math.round((Date.now() - started) / 1000)}s`);
console.log('files:', readdirSync(dir).join(', '));
if (existsSync(join(dir, 'check.json'))) console.log(readFileSync(join(dir, 'check.json'), 'utf8'));
else console.log('no check.json. last.md:\n', existsSync(join(dir, 'last.md')) ? readFileSync(join(dir, 'last.md'), 'utf8') : '(none)');
