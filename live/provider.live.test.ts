import { readFile } from 'node:fs/promises';
import { APICallError } from '@ai-sdk/provider';
import { experimental_decide as decide } from 'ai';
import { describe, expect, it } from 'vitest';
import { createNace } from '../src';

const apiKey = process.env.NACE_LIVE_API_KEY;
if (process.env.NACE_REQUIRE_LIVE === '1' && !apiKey) {
  throw new Error(
    'NACE_LIVE_API_KEY is required for this live contract run. Configure the NACE_API_KEY_LIVE Actions secret.',
  );
}
const bypass = process.env.NACE_LIVE_VERCEL_BYPASS;
const nace = createNace({
  apiKey,
  baseURL: process.env.NACE_LIVE_BASE_URL,
  headers: bypass ? { 'x-vercel-protection-bypass': bypass } : undefined,
});
const ticket = 'My order #1042 arrived broken and I want my money back.';
const questions = {
  refund: {
    type: 'boolean' as const,
    instructions: 'Does the customer ask for a refund?',
  },
  calm: {
    type: 'boolean' as const,
    criteria: { true: 'The customer sounds calm' },
  },
  topic: {
    type: 'choice' as const,
    instructions: 'What is the ticket about?',
    criteria: {
      billing: 'Payments, refunds, invoices',
      shipping: 'Delivery and damaged items',
      other: null,
    },
  },
  urgency: {
    type: 'score' as const,
    instructions: 'How urgent is the ticket?',
    criteria: ['Not urgent', 'Somewhat urgent', 'Very urgent'],
  },
};
const image = (name: string) =>
  readFile(new URL(`../examples/${name}.png`, import.meta.url));

describe.skipIf(!apiKey)('live Drex', () => {
  it.each(['drex-v2.0', 'drex-max-v1.1'])(
    'answers every question type on %s',
    async modelId => {
      const result = await decide({
        model: nace.decisionModel(modelId),
        state: ticket,
        questions,
      });
      expect(result.answers.refund.probability).toBeGreaterThan(0.7);
      expect(result.answers.topic.choice).toBe('shipping');
      expect(Object.keys(result.answers.urgency.probabilities!)).toEqual([
        '0',
        '1',
        '2',
      ]);
      expect(result.usage.inputTokens).toBeGreaterThan(0);
      const metadata = result.providerMetadata?.nace as {
        requestId: string;
        confidence: Record<string, number>;
      };
      expect(metadata.requestId).toMatch(/^req_/);
      expect(Object.keys(metadata.confidence).sort()).toEqual(
        Object.keys(questions).sort(),
      );
      console.log(modelId, result.response.modelId, metadata.requestId);
    },
  );

  it('reads ordered images on drex-max-v1.1', async () => {
    const result = await decide({
      model: nace.decisionModel('drex-max-v1.1'),
      state: [
        { type: 'text', text: 'Two product photos.' },
        { type: 'file', mediaType: 'image/png', data: await image('red') },
        { type: 'file', mediaType: 'image', data: await image('blue') },
      ],
      questions: {
        firstIsRed: { type: 'boolean', instructions: 'Is Image 1 red?' },
        blue: {
          type: 'choice',
          instructions: 'Which image is blue?',
          criteria: { first: 'Image 1', second: 'Image 2' },
        },
      },
    });
    expect(result.answers.firstIsRed.probability).toBeGreaterThan(0.7);
    expect(result.answers.blue.choice).toBe('second');
    console.log(
      'drex-max-v1.1 images',
      result.providerMetadata?.nace?.requestId,
    );
  });

  it('fails clearly, without retrying, when a text model gets an image', async () => {
    const rejected = await decide({
      model: nace.decisionModel('drex-v2.0'),
      state: [
        { type: 'text', text: 'Is Image 1 red?' },
        { type: 'file', mediaType: 'image/png', data: await image('red') },
      ],
      questions: { red: { type: 'boolean', instructions: 'Is Image 1 red?' } },
    }).catch((e: unknown) => e);
    expect(APICallError.isInstance(rejected)).toBe(true);
    expect(rejected).toMatchObject({
      statusCode: 422,
      isRetryable: false,
      message: expect.stringContaining('images require drex-max'),
    });
  });
});
