import { describe, it, expect } from 'vitest';
import {
  calculateDynamicCost,
  calculateCost,
  clampParams,
  resolveModel,
  getActionCost,
} from '../../hosted/billing.js';

describe('calculateDynamicCost', () => {
  it('known model (groq:llama-3.3-70b-versatile): correct credit calc', () => {
    // 2000 input × 0.59/1M + 1000 output × 0.79/1M = 0.00197 USD × 1000 = 1.97 → round to 1dp = 2.0
    const result = calculateDynamicCost({
      inputTokens: 2000,
      outputTokens: 1000,
      provider: 'groq',
      model: 'llama-3.3-70b-versatile',
    });
    expect(result).toBe(2.0);
  });

  it('0.5 credit floor when tokens are tiny', () => {
    // 10 input + 10 output → 0.0138 credits → rounds to 0.0 → floor = 0.5
    const result = calculateDynamicCost({
      inputTokens: 10,
      outputTokens: 10,
      provider: 'groq',
      model: 'llama-3.3-70b-versatile',
    });
    expect(result).toBe(0.5);
  });

  it('unknown model: returns MIN_CHARGE (0.5)', () => {
    const result = calculateDynamicCost({
      inputTokens: 1000,
      outputTokens: 500,
      provider: 'unknown',
      model: 'unknown-model',
    });
    expect(result).toBe(0.5);
  });

  it('zero tokens: returns floor', () => {
    const result = calculateDynamicCost({
      inputTokens: 0,
      outputTokens: 0,
      provider: 'groq',
      model: 'llama-3.3-70b-versatile',
    });
    expect(result).toBe(0.5);
  });
});

describe('calculateCost', () => {
  it('flat-cost action search_query: returns 1', () => {
    expect(calculateCost('search_query')).toBe(1);
  });

  it('flat-cost action voice_calibration: returns 10', () => {
    expect(calculateCost('voice_calibration')).toBe(10);
  });

  it('LLM action generate_post with claude-sonnet: returns 20.0', () => {
    expect(calculateCost('generate_post', 'claude-sonnet')).toBe(20.0);
  });

  it('LLM action generate_post with undefined model: returns 0.9 (llama default)', () => {
    expect(calculateCost('generate_post', undefined)).toBe(0.9);
  });

  it('unknown action: returns 1', () => {
    expect(calculateCost('bogus_action')).toBe(1);
  });
});

describe('clampParams', () => {
  it('temperature below min → clamped to 0', () => {
    const result = clampParams('generate_post', { temperature: -0.5, maxTokens: 300 });
    expect(result.temperature).toBe(0);
  });

  it('temperature above max → clamped to 1.5', () => {
    const result = clampParams('generate_post', { temperature: 2.0, maxTokens: 300 });
    expect(result.temperature).toBe(1.5);
  });

  it('temperature normal → unchanged (rounded to 2dp)', () => {
    const result = clampParams('generate_post', { temperature: 1.234, maxTokens: 300 });
    expect(result.temperature).toBe(1.23);
  });

  it('maxTokens above action max → clamped to action max (500 for generate_post)', () => {
    const result = clampParams('generate_post', { temperature: 0.7, maxTokens: 1000 });
    expect(result.maxTokens).toBe(500);
  });

  it('maxTokens below action min → clamped to action min (50 for generate_post)', () => {
    const result = clampParams('generate_post', { temperature: 0.7, maxTokens: 10 });
    expect(result.maxTokens).toBe(50);
  });

  it('default values when params are undefined', () => {
    const result = clampParams('generate_post', {});
    expect(result.temperature).toBe(0.7);
    expect(result.maxTokens).toBe(300);
  });

  it('maxTokens above model cap → clamped to model cap', () => {
    // thread_generation max=2000, llama-3.3-70b cap=2000 → effectiveMax=2000; 2500 → 2000
    const result = clampParams('thread_generation', { temperature: 0.7, maxTokens: 2500 }, 'llama-3.3-70b');
    expect(result.maxTokens).toBe(2000);
  });
});

describe('resolveModel', () => {
  it('known model: returns { provider, model }', () => {
    const result = resolveModel('claude-sonnet');
    expect(result).toEqual({ provider: 'anthropic', model: 'claude-sonnet-4-20250514' });
  });

  it('unknown model: returns null', () => {
    expect(resolveModel('nonexistent-model')).toBeNull();
  });

  it('undefined: returns null', () => {
    expect(resolveModel(undefined)).toBeNull();
  });
});

describe('getActionCost', () => {
  it('delegates to calculateCost: flat-cost action returns same result', () => {
    expect(getActionCost('search_query', 'claude-sonnet')).toBe(calculateCost('search_query', 'claude-sonnet'));
  });

  it('delegates to calculateCost: LLM action returns same result', () => {
    expect(getActionCost('generate_post', 'gpt-4o')).toBe(calculateCost('generate_post', 'gpt-4o'));
  });
});
