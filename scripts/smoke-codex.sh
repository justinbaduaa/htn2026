#!/bin/sh
# One real generate run from the fixture dims, no UI. Needs codex login and the venv.
set -eu
d=$(mktemp -d)
cp cad/tests/fixtures/dims.json "$d/dims.json"
cp cad/check.py "$d/check.py"
echo "run folder: $d"
pnpm exec tsx -e "
import { generatePrompt } from './server/prompts.ts';
import { codex } from './server/model.ts';
import { readFileSync } from 'node:fs';
const dims = JSON.parse(readFileSync('$d/dims.json','utf8'));
await codex.generate('$d', generatePrompt(dims, null), new AbortController().signal);
"
cat "$d/check.json"
ls "$d"
