import { jest } from '@jest/globals';

// Mock dependencies (use unstable_mockModule before dynamic import)
const upsertMock = jest.fn(async () => ({}));
const queryMock = jest.fn(async () => ({
  matches: [
    {
      score: 0.97,
      metadata: { cachedResponse: JSON.stringify({ answer: 'cached-answer' }) },
    },
  ],
}));

await jest.unstable_mockModule('../utils/config.js', () => ({
  loadConfig: () => ({
    openaiApiKey: 'test-key',
    pineconeApiKey: 'pine-key',
    pineconeIndexName: 'test-index',
  }),
}));

await jest.unstable_mockModule('@langchain/openai', () => ({
  OpenAIEmbeddings: class {
    async embedQuery(_q: string) {
      return [0.1, 0.2, 0.3];
    }
  },
}));

await jest.unstable_mockModule('../utils/factory.js', () => ({
  createVectorClient: () => ({
    index: (_name: string) => {
      const idx: any = {
        query: queryMock,
        upsert: upsertMock,
      };
      idx.namespace = (_ns: string) => idx;
      return idx;
    },
  }),
}));
let semanticGet: any;
let semanticSet: any;

describe('Semantic cache', () => {
  beforeAll(async () => {
    const mod = await import('../cache/cache');
    semanticGet = mod.semanticGet;
    semanticSet = mod.semanticSet;
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    // reset metrics between tests
    const m = await import('../metrics/metrics.js');
    m.register.resetMetrics();
  });

  test('semanticGet returns cached response when similarity is above threshold', async () => {
    const cached = await semanticGet('hello world', 0.95);
    expect(cached).not.toBeNull();
    expect(JSON.parse(cached as string)).toEqual({ answer: 'cached-answer' });
    expect(queryMock).toHaveBeenCalled();

    // Verify cache metrics were recorded for vector backend
    const metrics = await import('../metrics/metrics.js');
    const all = await metrics.register.getMetricsAsJSON();
    const cacheHitsMetric = all.find((m: any) => m.name === 'cache_hits_total');
    expect(cacheHitsMetric).toBeDefined();
    const vectorHit = cacheHitsMetric!.values.find((v: any) => v.labels.backend === 'vector');
    expect(vectorHit).toBeDefined();
    expect(vectorHit.value).toBeGreaterThanOrEqual(1);

    const cacheReqDurMetric = all.find((m: any) => m.name === 'cache_request_duration_seconds');
    expect(cacheReqDurMetric).toBeDefined();
    const anyVectorDur = cacheReqDurMetric!.values.find((v: any) => v.labels.backend === 'vector');
    expect(anyVectorDur).toBeDefined();
  });

  test('semanticSet calls upsert with correct metadata', async () => {
    const responseData = JSON.stringify({ answer: 'fresh-answer' });
    await semanticSet('new query', responseData);
    expect(upsertMock).toHaveBeenCalled();
    const upsertCalls = (upsertMock as any).mock.calls as any[];
    expect(upsertCalls.length).toBeGreaterThan(0);
    const upsertArg = upsertCalls[0][0] as any;
    expect(upsertArg).toHaveProperty('vectors');
    const vec = upsertArg.vectors[0];
    expect(vec).toHaveProperty('metadata');
    expect(vec.metadata.cachedResponse).toEqual(responseData);
  });

  afterAll(async () => {
    // Write a snapshot of current metrics for CI reporting (harmless if it fails)
    try {
      const metrics = await import('../metrics/metrics.js');
      const all = await metrics.register.getMetricsAsJSON();
      const fs = await import('fs/promises');
      await fs.mkdir('dist/tests', { recursive: true });
      await fs.writeFile('dist/tests/metrics_snapshot.json', JSON.stringify(all, null, 2), 'utf8');
    } catch (err) {
      // ignore write errors
    }
  });
});
