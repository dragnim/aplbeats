/*
 * Point git at the hooks this repository ships.
 *
 * `.git/hooks` is not tracked and does not survive a clone, so a hook that matters has
 * to live somewhere committed and be wired up on install. `core.hooksPath` is how, and
 * npm's `prepare` lifecycle is when: it runs after `npm install` and after `npm ci`.
 *
 * Never fails the install. A missing `.git` (an npm package rather than a clone), a git
 * that is not on the path, a hooks directory someone has deliberately removed — none of
 * those is a reason to refuse to install dependencies. The check that cannot be skipped
 * is the `authorship` job in CI; this one is the early, friendly version of it.
 */

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));
const hooksDirectory = fileURLToPath(new URL('../.githooks', import.meta.url));

if (!existsSync(`${repositoryRoot}.git`) || !existsSync(hooksDirectory)) {
  process.exit(0);
}

try {
  execFileSync('git', ['config', 'core.hooksPath', '.githooks'], {
    cwd: repositoryRoot,
    stdio: 'ignore',
  });
} catch {
  // See above: this is a convenience, not a gate.
}
