import { readFile } from 'node:fs/promises';
import { nace } from '@nace-ai/ai-sdk-provider';
import { experimental_decide as decide } from 'ai';

const { answers } = await decide({
  model: nace.decisionModel('drex-max-v1.1'),
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

console.log(answers.firstIsRed.probability, answers.blueImage.choice);
