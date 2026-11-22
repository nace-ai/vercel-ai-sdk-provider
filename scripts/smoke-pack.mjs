#!/usr/bin/env node
/**
 * Install the package the way a user would and check it works.
 *
 *   node scripts/smoke-pack.mjs              # pack this checkout
 *   node scripts/smoke-pack.mjs --registry   # install @nace-ai/ai-sdk-provider@<version> from npm
 *   node scripts/smoke-pack.mjs --tarball ./package.tgz # test an existing artifact
 *   node scripts/smoke-pack.mjs --require-live # fail without NACE_API_KEY
 *
 * In a fresh temp project: installs the package with `ai`, imports it from ESM
 * and CommonJS, type-checks a TypeScript user file, and, when NACE_API_KEY is
 * set, runs the README's text and image examples against Nace production.
 */
import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

const root = resolve(import.meta.dirname, '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const { values: options } = parseArgs({
  options: {
    registry: { type: 'boolean' },
    tarball: { type: 'string' },
    'require-live': { type: 'boolean' },
  },
});
if (options.registry && options.tarball) {
  throw new Error('Choose either --registry or --tarball, not both.');
}
if (options['require-live'] && !process.env.NACE_API_KEY) {
  throw new Error('NACE_API_KEY is required for the live artifact smoke test.');
}
const run = (cmd, args, cwd) =>
  execFileSync(cmd, args, { cwd, stdio: 'inherit' });

const dir = mkdtempSync(join(tmpdir(), 'nace-ai-provider-smoke-'));
let spec = options.tarball
  ? resolve(options.tarball)
  : `${pkg.name}@${pkg.version}`;
if (!options.registry && !options.tarball) {
  // Lifecycle scripts can write to stdout, even with npm pack --json.
  run('npm', ['pack', '--pack-destination', dir], root);
  const tarballs = readdirSync(dir).filter(file => file.endsWith('.tgz'));
  if (tarballs.length !== 1) {
    throw new Error(`Expected one packed tarball, found ${tarballs.length}.`);
  }
  spec = join(dir, tarballs[0]);
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
  `import { createNace, nace, VERSION } from '@nace-ai/ai-sdk-provider';
if (VERSION !== ${JSON.stringify(pkg.version)}) throw new Error('wrong version ' + VERSION);
if (typeof createNace !== 'function' || nace.decisionModel('drex-v2.0').provider !== 'nace.decision') throw new Error('bad exports');
console.log('esm: ok', VERSION);
`,
);
writeFileSync(
  join(dir, 'cjs.cjs'),
  `const { createNace, VERSION } = require('@nace-ai/ai-sdk-provider');
if (typeof createNace !== 'function') throw new Error('bad exports');
console.log('cjs: ok', VERSION);
`,
);
writeFileSync(
  join(dir, 'decision.mjs'),
  `import assert from 'node:assert/strict';
import { experimental_decide as decide } from 'ai';
import { createNace, VERSION } from '@nace-ai/ai-sdk-provider';
let requests = 0;
const nace = createNace({
  apiKey: 'artifact-test-key',
  baseURL: 'https://console.nace.ai/v1',
  fetch: async (url, init) => {
    requests++;
    assert.equal(url, 'https://console.nace.ai/v1/systemone');
    assert.equal(init.redirect, 'error');
    assert.equal(new Headers(init.headers).get('x-nace-client'), 'vercel-ai-sdk/' + VERSION);
    const body = JSON.parse(init.body);
    assert.equal(body.model, 'drex-max-v1.1');
    assert.equal(body.state, 'A refund request');
    assert.equal(body.questions.refund.type, 'noul');
    assert.equal(body.questions.topic.type, 'choice');
    assert.equal(body.questions.urgency.type, 'score');
    return Response.json({
      model: body.model,
      request_id: 'req_artifact',
      answers: {
        refund: { type: 'noul', noul: 0.9, confidence: 0.8 },
        topic: { type: 'choice', choice: 'billing', probabilities: { billing: 0.9, other: 0.1 } },
        urgency: { type: 'score', score: 0.75, probabilities: { '0': 0.25, '1': 0.75 } },
      },
      usage: { input_tokens: 12, output_tokens: 0 },
    });
  },
});
const result = await decide({
  model: nace.decisionModel('drex-max-v1.1'),
  state: 'A refund request',
  questions: {
    refund: { type: 'boolean', instructions: 'Is this a refund request?' },
    topic: { type: 'choice', criteria: { billing: 'Billing', other: null } },
    urgency: { type: 'score', criteria: ['Low', 'High'] },
  },
});
assert.equal(requests, 1);
assert.equal(result.answers.refund.probability, 0.9);
assert.equal(result.answers.topic.choice, 'billing');
assert.equal(result.answers.urgency.score, 0.75);
assert.equal(result.usage.inputTokens, 12);
assert.equal(result.providerMetadata.nace.requestId, 'req_artifact');
assert.equal(result.providerMetadata.nace.confidence.refund, 0.8);
console.log('DecisionModelV4 artifact contract: ok');
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
run('node', ['decision.mjs'], dir);
run('npx', ['tsc', '-p', '.'], dir);
console.log('types: ok');

if (process.env.NACE_API_KEY) {
  run('npx', ['tsx', 'text.ts'], dir);
  run('npx', ['tsx', 'image.ts'], dir);
  console.log('live: ok');
} else {
  console.log('live: skipped, NACE_API_KEY is not set');
}
