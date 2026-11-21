# Nace provider for the AI SDK

`@nace-ai/ai-sdk-provider` runs [Drex](https://console.nace.ai/docs/drex) decision models from the [AI SDK](https://ai-sdk.dev)'s `experimental_decide`. It calls Nace directly with a Nace API key. It is not the Vercel AI Gateway.

Drex answers yes-or-no, choice and score questions about a shared state of text, JSON and images, with a probability for every answer.

## Setup

```bash
npm install @nace-ai/ai-sdk-provider ai@^7 zod
```

Create a key in the [Nace console](https://console.nace.ai) and set it as `NACE_API_KEY`.

Requires Node.js 22 or newer and AI SDK 7 (`ai >=7.0.157 <8`). This package implements `DecisionModelV4` for `experimental_decide`; it does not select downstream LLMs through Drex Router's `/v1/route` endpoint. Router-backed model selection is a separate extension.

```ts
import { nace } from '@nace-ai/ai-sdk-provider';
```

`createNace` takes these settings:

```ts
import { createNace } from '@nace-ai/ai-sdk-provider';

const nace = createNace({
  apiKey: process.env.NACE_API_KEY, // the default
  baseURL: 'https://console.nace.ai/v1', // the default, or NACE_BASE_URL
  headers: { 'X-Nace-Client': 'my-app/1.2.0' },
  fetch: customFetch,
});
```

- `NACE_API_KEY` is only sent to `https://console.nace.ai` and `https://drex.nace.ai`. Any other `baseURL`, such as a proxy, needs `apiKey` passed explicitly, so a key from the environment never reaches a host you didn't choose.
- Requests never follow redirects, so `Authorization` is never forwarded to another host.
- Every request sends `X-Nace-Client: vercel-ai-sdk/<version>` and a `User-Agent` naming this package. Pass your own `X-Nace-Client` (`name/version`) to have usage attributed to your application instead.

## Models

| Model           | Input                                                | Per 1M input tokens |
| --------------- | ---------------------------------------------------- | ------------------- |
| `drex-max-v1.1` | text, JSON, images                                   | $0.03               |
| `drex-max`      | text, JSON, images                                   | $0.03               |
| `drex-v2.0`     | text, JSON                                           | $0.06               |
| `drex-v1.5`     | text, JSON                                           | $0.05               |
| `drex-latest`   | an alias for the current text model, now `drex-v2.0` |                     |

Drex bills input tokens only, as `usage.inputTokens` reports them, and only for a successful request. Image tokens count as input. Any other model id is sent as is. [Models](https://console.nace.ai/docs/drex/reference/models) and [Pricing](https://console.nace.ai/docs/drex/reference/pricing) have the current list.

## Text

```ts
import { experimental_decide as decide } from 'ai';
import { nace } from '@nace-ai/ai-sdk-provider';

const { answers, providerMetadata } = await decide({
  model: nace.decisionModel('drex-v2.0'),
  state: 'My order #1042 arrived broken and I want my money back.',
  questions: {
    refund: {
      type: 'boolean',
      instructions: 'Does the customer ask for a refund?',
    },
    topic: {
      type: 'choice',
      instructions: 'What is the ticket about?',
      criteria: {
        billing: 'Payments, refunds, invoices',
        shipping: 'Delivery and damaged items',
        other: null,
      },
    },
    urgency: {
      type: 'score',
      instructions: 'How urgent is the ticket?',
      criteria: ['Not urgent', 'Somewhat urgent', 'Very urgent'],
    },
  },
});

answers.refund.probability; // 0.93
answers.topic.choice; // 'shipping'
answers.urgency.score; // 0.86, between 0 and 2
providerMetadata?.nace?.confidence; // { refund: 0.93, topic: 0.32, ... }
```

## Images

Drex Max reads images. Put them in the state as file parts. They reach the model in state order as Image 1, Image 2 and so on, so refer to them that way.

```ts
import { readFile } from 'node:fs/promises';
import { experimental_decide as decide } from 'ai';
import { nace } from '@nace-ai/ai-sdk-provider';

const { answers } = await decide({
  model: nace.decisionModel('drex-max-v1.1'),
  state: [
    { type: 'text', text: 'Image 1 and Image 2 are product photos.' },
    { type: 'file', mediaType: 'image/png', data: await readFile('red.png') },
    { type: 'file', mediaType: 'image/png', data: await readFile('blue.png') },
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
```

Images can be PNG, JPEG or WebP, as bytes, base64 or a URL that the AI SDK downloads first. A request holds at most 8 images and 4 MiB in all, base64 included. Other models answer an image with a `422`.

## Questions and answers

| AI SDK question | Sent to Drex as                                                        | Answer                                                                    |
| --------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `boolean`       | `noul`, with `instructions`, `criteria.true`/`criteria.false`, or both | `probability` of true                                                     |
| `choice`        | `choice`; a `null` description is allowed                              | `choice` and `probabilities`                                              |
| `score`         | `score`; a `null` level is sent as an empty label                      | `score` (the probability-weighted mean of the levels) and `probabilities` |
| `box`           | not supported; `decide` rejects it before any request                  |                                                                           |

Instructions and criteria that are JSON values are sent as JSON text. A state with one JSON value is sent as that value; text and JSON parts together are joined into one string.

`providerMetadata.nace` holds `confidence` for every answer and the request's `requestId`, which Nace support can look up. `usage` has the input and output tokens. A request holds at most 512 questions.

## Errors and retries

A failed request throws the AI SDK's `APICallError` with Nace's message and status. `decide` retries `429`, `5xx` and `529 overloaded` up to `maxRetries` times (2 by default), honoring `Retry-After`; this provider never retries on its own. A `4xx` such as a `422` for an invalid question is not retried. [Errors](https://console.nace.ai/docs/drex/reference/errors) lists every error.

`maxOutputTokens`, `reasoning` and any `providerOptions.nace` are not supported; they are left out of the request and reported in `warnings`.

## License

MIT

Maintainers: see [RELEASING.md](https://github.com/nace-ai/nace-ai-provider/blob/main/RELEASING.md) for validation, the first npm publication and subsequent releases. Merging a PR does not publish the package.
