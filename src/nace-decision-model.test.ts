import { APICallError, UnsupportedFunctionalityError } from '@ai-sdk/provider';
import { createTestServer } from '@ai-sdk/test-server/with-vitest';
import { experimental_decide as decide } from 'ai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import nativeRequest from './__fixtures__/decision-request.json' with {
  type: 'json',
};
import nativeResponse from './__fixtures__/decision-response.json' with {
  type: 'json',
};
import maxResponse from './__fixtures__/decision-response-max.json' with {
  type: 'json',
};
import { createNace } from './nace-provider';
import { VERSION } from './version';

const questions = {
  wants_refund: {
    type: 'boolean' as const,
    instructions: 'Does the customer ask for a refund?',
  },
  angry: {
    type: 'boolean' as const,
    criteria: {
      true: 'The customer sounds angry',
      false: 'The customer sounds calm',
    },
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
const options = {
  state: [{ type: 'json' as const, value: nativeRequest.state }],
  questions,
};
const url = 'https://console.nace.ai/v1/systemone';
const provider = createNace({ apiKey: 'test-api-key' });
const model = provider.decisionModel('drex-v2.0');
const server = createTestServer({
  [url]: {},
  'https://proxy.example/v1/systemone': {},
});
const png =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==';
const jpeg = '/9j/4AAQSkZJRgABAQ==';
const webp = 'UklGRhIAAABXRUJQVlA4';

beforeEach(() => {
  server.urls[url].response = { type: 'json-value', body: nativeResponse };
});
afterEach(() => {
  vi.unstubAllEnvs();
});

it('sends booleans as noul and keeps every question in one request', async () => {
  await model.doDecide(options);
  expect(server.calls).toHaveLength(1);
  expect(await server.calls[0]!.requestBodyJson).toEqual(nativeRequest);
  expect(server.calls[0]!.requestHeaders).toMatchObject({
    authorization: 'Bearer test-api-key',
    'content-type': 'application/json',
    'x-nace-client': `vercel-ai-sdk/${VERSION}`,
  });
  expect(server.calls[0]!.requestUserAgent).toContain(`ai-sdk/nace/${VERSION}`);
});

it('maps answers and returns confidence, usage, and the request id', async () => {
  const result = await model.doDecide(options);
  expect(result.answers).toEqual({
    wants_refund: { type: 'boolean', probability: 0.9281 },
    angry: { type: 'boolean', probability: 0.3954 },
    topic: {
      type: 'choice',
      choice: 'shipping',
      probabilities: { billing: 0.2216, shipping: 0.5458, other: 0.2326 },
    },
    urgency: {
      type: 'score',
      score: 0.8619,
      probabilities: { 0: 0.3684, 1: 0.4013, 2: 0.2303 },
    },
  });
  expect(result.rounding).toEqual({ probabilityDecimals: 4, scoreDecimals: 4 });
  expect(result.providerMetadata).toEqual({
    nace: {
      confidence: {
        wants_refund: 0.9281,
        angry: 0.6046,
        topic: 0.3188,
        urgency: 0.7007,
      },
      requestId: 'req_00000000000000000000000000000001',
    },
  });
  expect(result.usage).toEqual({ inputTokens: 106, outputTokens: 205 });
  expect(result.warnings).toEqual([]);
  expect(result.response).toMatchObject({
    id: 'req_00000000000000000000000000000001',
    modelId: 'drex-v2.0',
    body: nativeResponse,
  });
});

it.each([
  ['drex-v2.0', nativeResponse],
  ['drex-max-v1.1', maxResponse],
])('passes core validation for a real %s response', async (modelId, body) => {
  server.urls[url].response = { type: 'json-value', body };
  const result = await decide({
    model: provider.decisionModel(modelId),
    state: nativeRequest.state,
    questions,
  });
  expect(result.answers.topic.choice).toBe('shipping');
  expect(result.answers.wants_refund.probability).toBe(
    body.answers.wants_refund.noul,
  );
  expect(result.answers.urgency.score).toBe(body.answers.urgency.score);
  expect(result.response.modelId).toBe(modelId);
});

it.each([
  'drex-max-v1.1',
  'drex-max',
  'drex-v2.0',
  'drex-v1.5',
  'drex-latest',
  'drex-future',
])('sends the model id unchanged: %s', async modelId => {
  await provider.decisionModel(modelId).doDecide(options);
  expect((await server.calls[0]!.requestBodyJson).model).toBe(modelId);
});

describe('questions', () => {
  it('sends criteria-only booleans, nullable choices, and nullable levels', async () => {
    await model.doDecide({
      state: [{ type: 'text', text: 'ticket' }],
      questions: {
        onlyTrue: { type: 'boolean', criteria: { true: 'Spam', false: null } },
        choice: { type: 'choice', criteria: { a: null, b: 'B' } },
        score: { type: 'score', instructions: null, criteria: [null, 'High'] },
      },
    });
    expect((await server.calls[0]!.requestBodyJson).questions).toEqual({
      onlyTrue: { type: 'noul', criteria: { true: 'Spam' } },
      choice: { type: 'choice', criteria: { a: null, b: 'B' } },
      score: { type: 'score', criteria: ['', 'High'] },
    });
  });

  it('serializes structured instructions and criteria as JSON text', async () => {
    await model.doDecide({
      state: [{ type: 'text', text: 'ticket' }],
      questions: {
        q: {
          type: 'choice',
          instructions: { task: 'route' },
          criteria: { a: ['first', 'second'] },
        },
      },
    });
    expect((await server.calls[0]!.requestBodyJson).questions.q).toEqual({
      type: 'choice',
      instructions: '{"task":"route"}',
      criteria: { a: '["first","second"]' },
    });
  });

  it('rejects box questions in core before any request', async () => {
    await expect(
      decide({
        model,
        state: 'image',
        questions: { box: { type: 'box', instructions: 'Find the logo' } },
      }),
    ).rejects.toMatchObject({
      name: 'AI_DecisionUnsupportedQuestionTypeError',
    });
    expect(server.calls).toHaveLength(0);
  });
});

describe('state', () => {
  it('joins text and JSON parts into one string', async () => {
    await model.doDecide({
      ...options,
      state: [
        { type: 'text', text: 'Ticket:' },
        { type: 'json', value: { id: 1 } },
      ],
    });
    expect((await server.calls[0]!.requestBodyJson).state).toBe(
      'Ticket:\n{"id":1}',
    );
  });

  it('sends ordered images as data URLs outside the state', async () => {
    await provider.decisionModel('drex-max-v1.1').doDecide({
      ...options,
      state: [
        {
          type: 'file',
          mediaType: 'image/jpeg',
          data: { type: 'data', data: jpeg },
        },
        { type: 'text', text: 'Compare Image 1 and Image 2.' },
        {
          type: 'file',
          mediaType: 'image',
          data: {
            type: 'data',
            data: Uint8Array.from(atob(png), c => c.charCodeAt(0)),
          },
        },
        {
          type: 'file',
          mediaType: 'image/webp',
          data: { type: 'data', data: webp },
        },
      ],
    });
    const body = await server.calls[0]!.requestBodyJson;
    expect(body.state).toBe('Compare Image 1 and Image 2.');
    expect(body.images).toEqual([
      `data:image/jpeg;base64,${jpeg}`,
      `data:image/png;base64,${png}`,
      `data:image/webp;base64,${webp}`,
    ]);
  });

  it('reads images given through decide, in state order', async () => {
    server.urls[url].response = { type: 'json-value', body: maxResponse };
    await decide({
      model: provider.decisionModel('drex-max-v1.1'),
      state: [
        { type: 'text', text: 'Is Image 1 red?' },
        { type: 'file', mediaType: 'image/png', data: png },
      ],
      questions,
    });
    expect((await server.calls[0]!.requestBodyJson).images).toEqual([
      `data:image/png;base64,${png}`,
    ]);
  });

  it.each([
    { mediaType: 'image/gif', data: { type: 'data' as const, data: 'R0lGOD' } },
    {
      mediaType: 'application/pdf',
      data: { type: 'data' as const, data: 'JVBERi0=' },
    },
    { mediaType: 'image', data: { type: 'data' as const, data: 'AAAA' } },
    {
      mediaType: 'image/png',
      data: { type: 'url' as const, url: new URL('https://example.com/a.png') },
    },
  ])('rejects $mediaType ($data.type) before any request', async file => {
    await expect(
      model.doDecide({ ...options, state: [{ type: 'file', ...file }] }),
    ).rejects.toBeInstanceOf(UnsupportedFunctionalityError);
    expect(server.calls).toHaveLength(0);
  });
});

describe('options', () => {
  it('warns about options Nace does not support and sends none of them', async () => {
    const result = await model.doDecide({
      ...options,
      maxOutputTokens: 10,
      reasoning: 'high',
      providerOptions: { nace: { temperature: 0 } },
    });
    expect(result.warnings).toEqual([
      { type: 'unsupported', feature: 'providerOptions.nace.temperature' },
      { type: 'unsupported', feature: 'maxOutputTokens' },
      { type: 'unsupported', feature: 'reasoning' },
    ]);
    expect(await server.calls[0]!.requestBodyJson).toEqual(nativeRequest);
  });

  it('lets call headers override provider headers', async () => {
    const custom = createNace({
      apiKey: 'test-api-key',
      headers: { 'X-Nace-Client': 'my-app/1.0', shared: 'provider' },
    });
    await custom
      .decisionModel('drex-v2.0')
      .doDecide({ ...options, headers: { shared: 'call' } });
    expect(server.calls[0]!.requestHeaders).toMatchObject({
      'x-nace-client': 'my-app/1.0',
      shared: 'call',
    });
  });
});

describe('HTTP errors', () => {
  const error = (status: number, message: string) => ({
    type: 'error' as const,
    status,
    headers: { 'x-request-id': 'req_00000000000000000000000000000003' },
    body: JSON.stringify({
      error: { type: 'invalid_request_error', message },
      request_id: 'req_00000000000000000000000000000003',
    }),
  });

  it.each([400, 401, 402, 422, 429, 500, 529])(
    'makes one request and keeps status and retryability for %s',
    async status => {
      server.urls[url].response = error(status, 'Provider error');
      const rejected: unknown = await Promise.resolve(
        model.doDecide(options),
      ).catch((e: unknown) => e);
      expect(APICallError.isInstance(rejected)).toBe(true);
      expect(rejected).toMatchObject({
        statusCode: status,
        message: 'Provider error',
        isRetryable: status === 429 || status >= 500,
      });
      expect(server.calls).toHaveLength(1);
    },
  );

  it('leaves retries to core: maxRetries 2 means three requests', async () => {
    server.urls[url].response = {
      ...error(529, 'Overloaded'),
      headers: { 'retry-after-ms': '1' },
    };
    await expect(
      decide({ model, state: 'x', questions, maxRetries: 2 }),
    ).rejects.toMatchObject({ name: 'AI_RetryError' });
    expect(server.calls).toHaveLength(3);
  });

  it('does not retry a 422', async () => {
    server.urls[url].response = error(422, 'questions.q.type: bad');
    await expect(
      decide({ model, state: 'x', questions }),
    ).rejects.toMatchObject({
      statusCode: 422,
      message: 'questions.q.type: bad',
    });
    expect(server.calls).toHaveLength(1);
  });
});
