import { existsSync } from 'fs';
import { dirname, join } from 'path';

// Loads the nearest .env (the repo root one when run via turbo from apps/api) into process.env.
// Imported first in main.ts so modules that read env at import time (e.g. the db client) see it.
// Variables already set in the environment win, so a real deployment's settings are never overridden.
let dir = process.cwd();
while (true) {
  const candidate = join(dir, '.env');
  if (existsSync(candidate)) {
    process.loadEnvFile(candidate);
    break;
  }
  // Stop at the repo root (marked by turbo.json) so a stray .env elsewhere on the machine is never read
  const parent = dirname(dir);
  if (existsSync(join(dir, 'turbo.json')) || parent === dir) break;
  dir = parent;
}
