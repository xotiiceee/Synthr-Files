import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { schemas } from '../lib/schemas';
import { checkX402Endpoint } from '../services/x402Trust';

export const x402Routes = new Hono();

// POST /v1/x402/endpoint-check
// Lightweight trust check for whether an agent should pay a discovered x402 endpoint.
x402Routes.post(
  '/endpoint-check',
  zValidator('json', schemas.X402EndpointCheckRequest),
  async (c) => {
    const input = c.req.valid('json');
    const result = await checkX402Endpoint(input);
    return c.json(result, 200);
  }
);

export default x402Routes;
