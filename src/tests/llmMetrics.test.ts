import { jest } from '@jest/globals';

// Mock config so module imports don't fail
await jest.unstable_mockModule('../utils/config.js', () => ({
  loadConfig: () => ({
    openaiApiKey: 'test-key',
    pineconeApiKey: 'pine-key',
    pineconeIndexName: 'test-index',
  }),
}));

describe('LLM metrics', () => {
  let generateAnswer: any;
  let register: any;

  beforeAll(async () => {
    const mod = await import('../llm/answer');
    generateAnswer = mod.generateAnswer;
    const metrics = await import('../metrics/metrics.js');
    register = metrics.register;
  });

  beforeEach(() => {
    register.resetMetrics();
  });

  test('records TTFT and total generation histograms', async () => {
    // Provide a fake LLM client that triggers token callbacks
    const fakeLLM = {
      invoke: async (_messages: any, options?: any) => {
        if (options && options.callbacks) {
          if (typeof options.callbacks.onLLMNewToken === 'function') options.callbacks.onLLMNewToken('t');
          if (typeof options.callbacks.handleLLMNewToken === 'function') options.callbacks.handleLLMNewToken('t');
        }
        return { content: 'hello [p0]' };
      },
    };

    const contexts = [{ text: 'ctx', score: 1, metadata: {} }];
    const result = await generateAnswer('query', contexts, undefined, 'test-model', 'req-1', undefined, undefined, undefined, fakeLLM);
    expect(result.answer).toContain('hello');

    const all = await register.getMetricsAsJSON();
    const ttftMetric = all.find((m: any) => m.name === 'llm_ttft_seconds');
    const totalMetric = all.find((m: any) => m.name === 'llm_total_generation_seconds');
    expect(ttftMetric).toBeDefined();
    expect(totalMetric).toBeDefined();

    const ttftEntry = ttftMetric!.values.find((v: any) => v.labels.model === 'test-model');
    const totalEntry = totalMetric!.values.find((v: any) => v.labels.model === 'test-model');
    expect(ttftEntry).toBeDefined();
    expect(totalEntry).toBeDefined();
    expect(ttftEntry.value).toBeGreaterThanOrEqual(0);
    expect(totalEntry.value).toBeGreaterThanOrEqual(ttftEntry.value);
  });
});
