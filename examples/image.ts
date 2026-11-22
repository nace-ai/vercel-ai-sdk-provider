import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { nace } from '@nace-ai/ai-sdk-provider';
import { experimental_decide as decide } from 'ai';

const { answers } = await decide({
  model: nace.decisionModel('drex-latest'),
  state: [
    { type: 'text', text: 'Image 1 and Image 2 are product photos.' },
    {
      type: 'file',
      mediaType: 'image/png',
      data: await readFile(new URL('./red.png', import.meta.url)),
    },
    {
      type: 'file',
      mediaType: 'image/png',
      data: await readFile(new URL('./blue.png', import.meta.url)),
    },
  ],
  questions: {
    firstIsRed: { type: 'boolean', instructions: 'Is Image 1 red?' },
    blueImage: {
      type: 'choice',
      instructions: 'Which image is blue?',
      criteria: { first: 'Image 1', second: 'Image 2' },
    },
  },
});

// Fail the live artifact check if images were lost or their order changed.
assert.ok(answers.firstIsRed.probability > 0.7, 'Image 1 should be red');
assert.equal(answers.blueImage.choice, 'second', 'Image 2 should be blue');
console.log(answers.firstIsRed.probability, answers.blueImage.choice);
