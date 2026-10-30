import {
  type Experimental_DecisionModelV4 as DecisionModelV4,
  LoadAPIKeyError,
  NoSuchModelError,
  type ProviderV4,
} from '@ai-sdk/provider';
import {
  type FetchFunction,
  loadApiKey,
  loadOptionalSetting,
  withoutTrailingSlash,
  withUserAgentSuffix,
} from '@ai-sdk/provider-utils';
import {
  NaceDecisionModel,
  type NaceDecisionModelId,
} from './nace-decision-model';
import { VERSION } from './version';

const DEFAULT_BASE_URL = 'https://console.nace.ai/v1';
const NACE_HOSTS = new Set(['console.nace.ai', 'drex.nace.ai']);

export interface NaceProvider extends ProviderV4 {
  /** A Drex decision model for `experimental_decide`. */
  decisionModel(modelId: NaceDecisionModelId): DecisionModelV4;
}

export interface NaceProviderSettings {
  /**
   * Nace API key. Defaults to the NACE_API_KEY environment variable, which is
   * only sent to Nace's own HTTPS hosts. Any other `baseURL` needs this set.
   */
  apiKey?: string;
  /**
   * API base URL. Defaults to the NACE_BASE_URL environment variable, then
   * https://console.nace.ai/v1.
   */
  baseURL?: string;
  /** Headers sent with every request, after the provider's own. */
  headers?: Record<string, string>;
  fetch?: FetchFunction;
}

export function createNace(options: NaceProviderSettings = {}): NaceProvider {
  const baseURL =
    withoutTrailingSlash(
      loadOptionalSetting({
        settingValue: options.baseURL,
        environmentVariableName: 'NACE_BASE_URL',
      }),
    ) ?? DEFAULT_BASE_URL;

  const headers = () => {
    if (options.apiKey === undefined && !isNaceDestination(baseURL)) {
      throw new LoadAPIKeyError({
        message: `Nace API key is missing for ${baseURL}. NACE_API_KEY is only sent to https://console.nace.ai and https://drex.nace.ai, so pass apiKey to use another base URL.`,
      });
    }
    return withUserAgentSuffix(
      {
        Authorization: `Bearer ${loadApiKey({
          apiKey: options.apiKey,
          environmentVariableName: 'NACE_API_KEY',
          description: 'Nace',
        })}`,
        'X-Nace-Client': `vercel-ai-sdk/${VERSION}`,
        ...options.headers,
      },
      `ai-sdk/nace/${VERSION}`,
    );
  };

  // The API never redirects, and following one could forward Authorization.
  const fetch: FetchFunction = (input, init) =>
    (options.fetch ?? globalThis.fetch)(input, { ...init, redirect: 'error' });

  const decisionModel = (modelId: NaceDecisionModelId) =>
    new NaceDecisionModel(modelId, {
      provider: 'nace.decision',
      baseURL,
      headers,
      fetch,
    });

  return {
    specificationVersion: 'v4',
    decisionModel,
    languageModel: modelId => {
      throw new NoSuchModelError({ modelId, modelType: 'languageModel' });
    },
    embeddingModel: modelId => {
      throw new NoSuchModelError({ modelId, modelType: 'embeddingModel' });
    },
    imageModel: modelId => {
      throw new NoSuchModelError({ modelId, modelType: 'imageModel' });
    },
  };
}

function isNaceDestination(baseURL: string): boolean {
  try {
    const url = new URL(baseURL);
    return (
      url.protocol === 'https:' &&
      url.port === '' &&
      url.username === '' &&
      url.password === '' &&
      NACE_HOSTS.has(url.hostname.replace(/\.$/, ''))
    );
  } catch {
    return false;
  }
}

export const nace = createNace();
