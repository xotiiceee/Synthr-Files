import { config } from './config';

export function buildOpenApiSpec() {
  return {
    openapi: '3.1.0',
    info: {
      title: 'Synthr Cyber x402 API',
      version: '0.1.0',
      description:
        'Agent-native cybersecurity intelligence with x402-paid endpoints, grounded in OSV.dev, EPSS, and CISA KEV.',
    },
    servers: [
      {
        url: config.publicBaseUrl || 'https://synthr.online',
        description: 'Ubuntu 24.04 VPS deployment',
      },
      {
        url: `http://localhost:${config.port}`,
        description: 'Local development',
      },
    ],
    paths: {
      '/health': {
        get: {
          summary: 'Health check',
          responses: {
            '200': {
              description: 'Service health payload',
            },
          },
        },
      },
      '/llms.txt': {
        get: {
          summary: 'Agent usage instructions',
          responses: {
            '200': {
              description: 'Plain-text LLM integration guide',
            },
          },
        },
      },
      '/x402-catalog.json': {
        get: {
          summary: 'x402 discovery catalog',
          responses: {
            '200': {
              description: 'Machine-readable discovery metadata',
            },
          },
        },
      },
      '/openapi.json': {
        get: {
          summary: 'OpenAPI specification',
          responses: {
            '200': {
              description: 'OpenAPI document for discovery and integration',
            },
          },
        },
      },
      '/v1/cyber/stack-brief': {
        post: {
          summary: 'Get a prioritized stack risk brief',
          description: 'Paid endpoint. Returns enriched risk findings for a dependency stack.',
          responses: {
            '200': { description: 'Structured stack brief' },
            '402': { description: 'Payment required' },
            '429': { description: 'Rate limited' },
          },
        },
      },
      '/v1/cyber/audit-deps': {
        post: {
          summary: 'Audit dependencies',
          description: 'Paid endpoint. Returns vulnerability and malicious-package findings.',
          responses: {
            '200': { description: 'Structured dependency audit' },
            '402': { description: 'Payment required' },
            '429': { description: 'Rate limited' },
          },
        },
      },
      '/v1/cyber/advice': {
        post: {
          summary: 'Get security advice',
          description: 'Paid endpoint. Returns grounded security guidance for a query.',
          responses: {
            '200': { description: 'Structured advice response' },
            '402': { description: 'Payment required' },
            '429': { description: 'Rate limited' },
          },
        },
      },
      '/v1/cyber/vulns': {
        post: {
          summary: 'Search vulnerabilities',
          description: 'Paid endpoint. Searches OSV records enriched with EPSS and KEV.',
          responses: {
            '200': { description: 'Structured vulnerability search results' },
            '402': { description: 'Payment required' },
            '429': { description: 'Rate limited' },
          },
        },
      },
      '/v1/cyber/breaking': {
        get: {
          summary: 'Get recent actively exploited vulnerabilities',
          description: 'Paid endpoint. Returns recent KEV additions enriched with EPSS and agent relevance notes.',
          responses: {
            '200': { description: 'Structured breaking vulnerability feed' },
            '402': { description: 'Payment required' },
            '429': { description: 'Rate limited' },
          },
        },
      },
    },
  };
}
