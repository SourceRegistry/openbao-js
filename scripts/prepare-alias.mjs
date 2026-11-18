#!/usr/bin/env node
/**
 * Builds the unscoped alias package (`openbao-js`) next to the primary scoped
 * package (`@sourceregistry/openbao-js`). Both are published with identical
 * contents by two @semantic-release/npm instances (see .releaserc.json).
 *
 * Must run after `npm run build`.
 */
import { cp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const ALIAS_NAME = 'openbao-js';
const OUT = join('.release', ALIAS_NAME);

try {
  await stat('dist/index.js');
} catch {
  console.error('dist/ not found - run `npm run build` first.');
  process.exit(1);
}

const pkg = JSON.parse(await readFile('package.json', 'utf8'));

const alias = { ...pkg, name: ALIAS_NAME };
// The alias is a plain publish target: no lifecycle scripts or dev tooling.
delete alias.scripts;
delete alias.devDependencies;

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });
await writeFile(join(OUT, 'package.json'), `${JSON.stringify(alias, null, 2)}\n`);
await cp('dist', join(OUT, 'dist'), { recursive: true });
for (const file of ['README.md', 'LICENSE']) {
  await cp(file, join(OUT, file)).catch(() => undefined);
}

console.log(`Prepared ${ALIAS_NAME} (alias of ${pkg.name}) in ${OUT}`);
