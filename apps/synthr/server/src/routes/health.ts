import { Hono } from 'hono';

export const healthRoutes = new Hono();

healthRoutes.get('/', (c) => {
  return c.json({
    status: 'ok',
    service: 'synthr-cyber-x402',
    version: '0.1.0',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    x402: {
      facilitator: process.env.FACILITATOR_URL,
      network: process.env.NETWORK,
    },
    note: 'Free health endpoint. Paid cyber intelligence at /v1/cyber/*',
  });
});

healthRoutes.get('/ready', (c) => c.text('ready'));
