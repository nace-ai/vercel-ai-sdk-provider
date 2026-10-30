import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createNace } from './nace-provider';

const received: IncomingHttpHeaders[] = [];
let target: Server;
let redirector: Server;

const listen = (server: Server) =>
  new Promise<string>(done =>
    server.listen(0, '127.0.0.1', () =>
      done(`http://127.0.0.1:${(server.address() as AddressInfo).port}`),
    ),
  );

beforeAll(async () => {
  target = createServer((req, res) => {
    received.push(req.headers);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ answers: {} }));
  });
  const targetURL = await listen(target);
  redirector = createServer((_req, res) => {
    res.writeHead(307, { location: `${targetURL}/v1/systemone` });
    res.end();
  });
  await listen(redirector);
});

afterAll(() => {
  target.close();
  redirector.close();
});

it('fails on a redirect instead of forwarding Authorization', async () => {
  const port = (redirector.address() as AddressInfo).port;
  const model = createNace({
    apiKey: 'secret-key',
    baseURL: `http://127.0.0.1:${port}/v1`,
  }).decisionModel('drex-v2.0');

  await expect(
    model.doDecide({
      state: [{ type: 'text', text: 'x' }],
      questions: { q: { type: 'boolean', instructions: 'x' } },
    }),
  ).rejects.toThrow();
  expect(received).toEqual([]);
});
