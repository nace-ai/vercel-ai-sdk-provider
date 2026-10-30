import { LoadAPIKeyError, NoSuchModelError } from '@ai-sdk/provider';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createNace, nace } from './nace-provider';

const decisionOptions = {
  state: [{ type: 'text' as const, text: 'The request reached Nace.' }],
  questions: {
    reached: { type: 'boolean' as const, instructions: 'Did it reach Nace?' },
  },
};

const createFetchMock = () =>
  vi.fn<typeof fetch>().mockImplementation(async () =>
    Response.json({
      model: 'drex-v2.0',
      answers: { reached: { type: 'noul', noul: 1, confidence: 1 } },
    }),
  );

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('Nace provider', () => {
  it('provides decision models only', () => {
    const model = nace.decisionModel('drex-v2.0');
    expect(nace.specificationVersion).toBe('v4');
    expect(model.specificationVersion).toBe('v4');
    expect(model.provider).toBe('nace.decision');
    expect(model.modelId).toBe('drex-v2.0');
    expect(model.supportedQuestionTypes).toEqual([
      'choice',
      'score',
      'boolean',
    ]);
  });

  it.each(['languageModel', 'embeddingModel', 'imageModel'] as const)(
    'rejects %s',
    factory => {
      expect(() => createNace()[factory]('drex-v2.0')).toThrow(
        NoSuchModelError,
      );
    },
  );

  it('defaults to Nace production and NACE_API_KEY, read at call time', async () => {
    vi.stubEnv('NACE_BASE_URL', undefined);
    const fetch = createFetchMock();
    const model = createNace({ fetch }).decisionModel('drex-v2.0');
    vi.stubEnv('NACE_API_KEY', 'environment-key');

    await model.doDecide(decisionOptions);

    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe('https://console.nace.ai/v1/systemone');
    expect(new Headers(init?.headers).get('authorization')).toBe(
      'Bearer environment-key',
    );
  });

  it.each(['https://drex.nace.ai/v1/', 'https://console.nace.ai./v1'])(
    'sends NACE_API_KEY to the Nace host %s',
    async baseURL => {
      vi.stubEnv('NACE_API_KEY', 'environment-key');
      const fetch = createFetchMock();
      await createNace({ baseURL, fetch })
        .decisionModel('drex-v2.0')
        .doDecide(decisionOptions);
      expect(
        new Headers(fetch.mock.calls[0]![1]?.headers).get('authorization'),
      ).toBe('Bearer environment-key');
    },
  );

  it.each([
    'https://proxy.example/v1',
    'http://console.nace.ai/v1',
    'https://console.nace.ai:8443/v1',
    'https://console.nace.ai.example.com/v1',
    'https://user@console.nace.ai/v1',
    'https://console.test.nace.ai/v1',
  ])('never sends NACE_API_KEY to %s', async baseURL => {
    vi.stubEnv('NACE_API_KEY', 'environment-key');
    const fetch = createFetchMock();
    await expect(
      createNace({ baseURL, fetch })
        .decisionModel('drex-v2.0')
        .doDecide(decisionOptions),
    ).rejects.toBeInstanceOf(LoadAPIKeyError);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('never sends NACE_API_KEY to a NACE_BASE_URL elsewhere', async () => {
    vi.stubEnv('NACE_API_KEY', 'environment-key');
    vi.stubEnv('NACE_BASE_URL', 'https://proxy.example/v1');
    const fetch = createFetchMock();
    await expect(
      createNace({ fetch })
        .decisionModel('drex-v2.0')
        .doDecide(decisionOptions),
    ).rejects.toBeInstanceOf(LoadAPIKeyError);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('sends an explicit key to a custom base URL without a trailing slash', async () => {
    vi.stubEnv('NACE_API_KEY', 'environment-key');
    const fetch = createFetchMock();
    await createNace({
      apiKey: 'explicit-key',
      baseURL: 'https://proxy.example/v1/',
      fetch,
    })
      .decisionModel('drex-v2.0')
      .doDecide(decisionOptions);
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe('https://proxy.example/v1/systemone');
    expect(new Headers(init?.headers).get('authorization')).toBe(
      'Bearer explicit-key',
    );
  });

  it('refuses to follow redirects through a custom fetch', async () => {
    const fetch = createFetchMock();
    await createNace({ apiKey: 'test-api-key', fetch })
      .decisionModel('drex-v2.0')
      .doDecide(decisionOptions);
    expect(fetch.mock.calls[0]![1]?.redirect).toBe('error');
  });

  it('refuses to follow redirects through the global fetch', async () => {
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(createFetchMock());
    await createNace({ apiKey: 'test-api-key' })
      .decisionModel('drex-v2.0')
      .doDecide(decisionOptions);
    expect(fetch.mock.calls[0]![1]?.redirect).toBe('error');
  });
});
