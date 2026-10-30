#!/usr/bin/env node
/**
 * Install the package the way a user would and check it works.
 *
 *   node scripts/smoke-pack.mjs              # pack this checkout
 *   node scripts/smoke-pack.mjs --registry   # install nace-ai-provider@<version> from npm
 *
 * In a fresh temp project: installs the package with `ai`, imports it from ESM
 * and CommonJS, type-checks a TypeScript user file, and, when NACE_API_KEY is
 * set, runs the README's text and image examples against Nace production.
 */
import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const fromRegistry = process.argv.includes('--registry');
const run = (cmd, args, cwd) =>
  execFileSync(cmd, args, { cwd, stdio: 'inherit' });

const dir = mkdtempSync(join(tmpdir(), 'nace-ai-provider-smoke-'));
let spec = `${pkg.name}@${pkg.version}`;
if (!fromRegistry) {
  const out = execFileSync(
    'npm',
    ['pack', '--pack-destination', dir, '--json'],
    {
      cwd: root,
    },
  );
  spec = join(dir, JSON.parse(out.toString())[0].filename);
}
console.log(`smoke: installing ${spec} into ${dir}`);
writeFileSync(
  join(dir, 'package.json'),
  JSON.stringify({ name: 'smoke', private: true, type: 'module' }),
);
run(
  'npm',
  [
    'install',
    '--no-audit',
    '--no-fund',
    spec,
    'ai@^7.0.157',
    'zod',
    'typescript@5',
    '@types/node',
    'tsx',
  ],
  dir,
);

writeFileSync(
  join(dir, 'esm.mjs'),
  `import { createNace, nace, VERSION } from 'nace-ai-provider';
if (VERSION !== ${JSON.stringify(pkg.version)}) throw new Error('wrong version ' + VERSION);
if (typeof createNace !== 'function' || nace.decisionModel('drex-v2.0').provider !== 'nace.decision') throw new Error('bad exports');
console.log('esm: ok', VERSION);
`,
);
writeFileSync(
  join(dir, 'cjs.cjs'),
  `const { createNace, VERSION } = require('nace-ai-provider');
if (typeof createNace !== 'function') throw new Error('bad exports');
console.log('cjs: ok', VERSION);
`,
);
writeFileSync(
  join(dir, 'tsconfig.json'),
  JSON.stringify({
    compilerOptions: {
      target: 'ES2022',
      module: 'NodeNext',
      moduleResolution: 'NodeNext',
      strict: true,
      noEmit: true,
      skipLibCheck: true,
      types: ['node'],
    },
    include: ['*.ts'],
  }),
);
for (const example of ['text.ts', 'image.ts']) {
  copyFileSync(join(root, 'examples', example), join(dir, example));
}
for (const png of ['red.png', 'blue.png']) {
  copyFileSync(join(root, 'examples', png), join(dir, png));
}

run('node', ['esm.mjs'], dir);
run('node', ['cjs.cjs'], dir);
run('npx', ['tsc', '-p', '.'], dir);
console.log('types: ok');

if (process.env.NACE_API_KEY) {
  run('npx', ['tsx', 'text.ts'], dir);
  run('npx', ['tsx', 'image.ts'], dir);
  console.log('live: ok');
} else {
  console.log('live: skipped, NACE_API_KEY is not set');
}
