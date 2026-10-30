import {
  type Experimental_DecisionModelV4 as DecisionModelV4,
  type Experimental_DecisionModelV4Answer as DecisionModelV4Answer,
  type Experimental_DecisionModelV4Input as DecisionModelV4Input,
  type Experimental_DecisionModelV4Question as DecisionModelV4Question,
  type Experimental_DecisionModelV4StatePart as DecisionModelV4StatePart,
  type SharedV4Warning,
  UnsupportedFunctionalityError,
} from '@ai-sdk/provider';
import {
  combineHeaders,
  convertToBase64,
  createJsonResponseHandler,
  detectMediaType,
  type FetchFunction,
  isFullMediaType,
  postJsonToApi,
  type Resolvable,
  resolve,
} from '@ai-sdk/provider-utils';
import {
  naceDecisionResponseSchema,
  naceFailedResponseHandler,
} from './nace-decision-api';

export type NaceDecisionModelId =
  | 'drex-max-v1.1'
  | 'drex-max'
  | 'drex-v2.0'
  | 'drex-v1.5'
  | 'drex-latest'
  | (string & {});

export type NaceDecisionModelConfig = {
  provider: string;
  baseURL: string;
  headers: Resolvable<Record<string, string | undefined>>;
  fetch?: FetchFunction;
};

type NaceQuestion =
  | {
      type: 'noul';
      instructions?: string;
      criteria?: { true?: string; false?: string };
    }
  | {
      type: 'choice';
      instructions?: string;
      criteria: Record<string, string | null>;
    }
  | { type: 'score'; instructions?: string; criteria: string[] };

const IMAGE_MEDIA_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

export class NaceDecisionModel implements DecisionModelV4 {
  readonly specificationVersion = 'v4';
  readonly supportedQuestionTypes = ['choice', 'score', 'boolean'] as const;

  constructor(
    readonly modelId: NaceDecisionModelId,
    private readonly config: NaceDecisionModelConfig,
  ) {}

  get provider() {
    return this.config.provider;
  }

  async doDecide({
    state,
    questions,
    maxOutputTokens,
    reasoning,
    headers,
    abortSignal,
    providerOptions,
  }: Parameters<DecisionModelV4['doDecide']>[0]): Promise<
    Awaited<ReturnType<DecisionModelV4['doDecide']>>
  > {
    const warnings: SharedV4Warning[] = Object.keys(
      providerOptions?.nace ?? {},
    ).map(option => ({
      type: 'unsupported',
      feature: `providerOptions.nace.${option}`,
    }));
    if (maxOutputTokens != null) {
      warnings.push({ type: 'unsupported', feature: 'maxOutputTokens' });
    }
    if (reasoning != null) {
      warnings.push({ type: 'unsupported', feature: 'reasoning' });
    }

    const images = state.flatMap(part =>
      part.type === 'file' ? [toImage(part)] : [],
    );
    const content = state.filter(part => part.type !== 'file');
    const body = {
      model: this.modelId,
      state:
        content.length === 1 && content[0]?.type === 'json'
          ? content[0].value
          : content
              .map(part =>
                part.type === 'text' ? part.text : JSON.stringify(part.value),
              )
              .join('\n'),
      ...(images.length > 0 && { images }),
      questions: Object.fromEntries(
        Object.entries(questions).map(([id, question]) => [
          id,
          toNaceQuestion(question),
        ]),
      ),
    };

    const {
      value: response,
      rawValue,
      responseHeaders,
    } = await postJsonToApi({
      url: `${this.config.baseURL}/systemone`,
      headers: combineHeaders(await resolve(this.config.headers), headers),
      body,
      abortSignal,
      fetch: this.config.fetch,
      failedResponseHandler: naceFailedResponseHandler,
      successfulResponseHandler: createJsonResponseHandler(
        naceDecisionResponseSchema,
      ),
    });

    const confidence = Object.fromEntries(
      Object.entries(response.answers).flatMap(([id, answer]) =>
        answer.confidence != null ? [[id, answer.confidence]] : [],
      ),
    );

    return {
      answers: Object.fromEntries(
        Object.entries(response.answers).map(
          ([id, answer]): [string, DecisionModelV4Answer] => {
            switch (answer.type) {
              case 'noul':
                return [id, { type: 'boolean', probability: answer.noul }];
              case 'choice':
                return [
                  id,
                  {
                    type: 'choice',
                    choice: answer.choice,
                    probabilities: answer.probabilities,
                  },
                ];
              case 'score':
                return [
                  id,
                  {
                    type: 'score',
                    score: answer.score,
                    probabilities: answer.probabilities,
                  },
                ];
              default: {
                const unknown: never = answer;
                throw new Error(`Unknown Nace answer: ${unknown}`);
              }
            }
          },
        ),
      ),
      usage: {
        inputTokens: response.usage?.input_tokens ?? undefined,
        outputTokens: response.usage?.output_tokens ?? undefined,
      },
      // Drex 1.5 and 2.0 round probabilities and scores to four decimal places.
      // Drex Max returns full precision, which this also covers.
      rounding: { probabilityDecimals: 4, scoreDecimals: 4 },
      warnings,
      providerMetadata: {
        nace: {
          confidence,
          ...(response.request_id != null && {
            requestId: response.request_id,
          }),
        },
      },
      response: {
        id: response.request_id ?? undefined,
        modelId: response.model ?? this.modelId,
        headers: responseHeaders,
        body: rawValue,
      },
    };
  }
}

function toNaceText(input: DecisionModelV4Input): string {
  return typeof input === 'string' ? input : JSON.stringify(input);
}

function toNaceQuestion(question: DecisionModelV4Question): NaceQuestion {
  const instructions =
    question.type !== 'box' && question.instructions != null
      ? { instructions: toNaceText(question.instructions) }
      : {};
  switch (question.type) {
    case 'boolean': {
      const criteria: { true?: string; false?: string } = {};
      if (question.criteria?.true != null) {
        criteria.true = toNaceText(question.criteria.true);
      }
      if (question.criteria?.false != null) {
        criteria.false = toNaceText(question.criteria.false);
      }
      return {
        type: 'noul',
        ...instructions,
        ...(Object.keys(criteria).length > 0 && { criteria }),
      };
    }
    case 'choice':
      return {
        type: 'choice',
        ...instructions,
        criteria: Object.fromEntries(
          Object.entries(question.criteria).map(([option, description]) => [
            option,
            description == null ? null : toNaceText(description),
          ]),
        ),
      };
    case 'score':
      return {
        type: 'score',
        ...instructions,
        criteria: question.criteria.map(level =>
          level == null ? '' : toNaceText(level),
        ),
      };
    case 'box':
      throw new UnsupportedFunctionalityError({
        functionality: 'Nace box questions',
      });
    default: {
      const unknown: never = question;
      throw new UnsupportedFunctionalityError({
        functionality: `Nace question type ${(unknown as { type: string }).type}`,
      });
    }
  }
}

function toImage(
  part: Extract<DecisionModelV4StatePart, { type: 'file' }>,
): string {
  if (part.data.type !== 'data') {
    throw new UnsupportedFunctionalityError({
      functionality: `Nace decision file input: ${part.mediaType} (${part.data.type})`,
    });
  }
  const mediaType = isFullMediaType(part.mediaType)
    ? part.mediaType
    : detectMediaType({ data: part.data.data, topLevelType: 'image' });
  if (mediaType === undefined || !IMAGE_MEDIA_TYPES.has(mediaType)) {
    throw new UnsupportedFunctionalityError({
      functionality: `Nace decision file media type: ${mediaType ?? part.mediaType}`,
    });
  }
  return `data:${mediaType};base64,${convertToBase64(part.data.data)}`;
}
