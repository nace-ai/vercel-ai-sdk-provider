import {
  createJsonErrorResponseHandler,
  lazySchema,
  zodSchema,
} from '@ai-sdk/provider-utils';
import * as z from 'zod/v4';

// https://console.nace.ai/docs/drex/api-reference/systemone
export const naceDecisionResponseSchema = lazySchema(() =>
  zodSchema(
    z.object({
      model: z.string().nullish(),
      answers: z.record(
        z.string(),
        z.discriminatedUnion('type', [
          z.object({
            type: z.literal('noul'),
            noul: z.number(),
            confidence: z.number().nullish(),
          }),
          z.object({
            type: z.literal('choice'),
            choice: z.string(),
            probabilities: z.record(z.string(), z.number()),
            confidence: z.number().nullish(),
          }),
          z.object({
            type: z.literal('score'),
            score: z.number(),
            probabilities: z.record(z.string(), z.number()),
            confidence: z.number().nullish(),
          }),
        ]),
      ),
      usage: z
        .object({
          input_tokens: z.number().nullish(),
          output_tokens: z.number().nullish(),
        })
        .nullish(),
      request_id: z.string().nullish(),
    }),
  ),
);

export const naceFailedResponseHandler = createJsonErrorResponseHandler({
  errorSchema: z.object({
    error: z
      .union([
        z.string(),
        z.object({
          type: z.string().nullish(),
          message: z.string().nullish(),
        }),
      ])
      .nullish(),
    message: z.string().nullish(),
    request_id: z.string().nullish(),
  }),
  errorToMessage: error =>
    (typeof error.error === 'string' ? error.error : error.error?.message) ??
    error.message ??
    'Nace request failed',
});
