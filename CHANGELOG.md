# Changelog

## 0.1.0

- `createNace` and `nace.decisionModel` run Drex decision models from the AI SDK's `experimental_decide`: boolean, choice and score questions over text, JSON and ordered images.
- Answers carry Nace's probabilities; `providerMetadata.nace` adds confidence and the request id.
- `NACE_API_KEY` is only sent to Nace's own hosts, and requests never follow redirects.
