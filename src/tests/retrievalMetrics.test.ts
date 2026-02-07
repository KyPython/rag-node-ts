import { jest } from '@jest/globals';

// ESM-compatible mocks
const queryMock = jest.fn(async () => ({
  matches: [
    { score: 0.9, metadata: { relevant: true } },
    { score: 0.85, metadata: { relevant: true } },
    { score: 0.5, metadata: { relevant: false } },
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
      const idx: any = { query: queryMock };
      idx.namespace = (_ns: string) => idx;
      return idx;
    },
  }),
}));

describe('Retrieval metrics', () => {
  let retrieveRelevantPassages: any;
  let register: any;

  beforeAll(async () => {
    const mod = await import('../rag/retriever');
    retrieveRelevantPassages = mod.retrieveRelevantPassages;
    const metrics = await import('../metrics/metrics.js');
    register = metrics.register;
  });

  beforeEach(() => {
    register.resetMetrics();
    queryMock.mockClear();
  });

  test('sets retrieval_precision gauge when metadata.relevant exists', async () => {
    const passages = await retrieveRelevantPassages('test query', 3, undefined, 'req1');
    expect(passages.length).toBeGreaterThan(0);

    const all = await register.getMetricsAsJSON();
    const metric = all.find((m: any) => m.name === 'retrieval_precision');
    expect(metric).toBeDefined();
    const entry = metric!.values.find((v: any) => v.labels.top_k === '3');
    expect(entry).toBeDefined();
    // relevantFromMetadata = 2 -> precision = 2/3 ~= 0.666...
    expect(entry.value).toBeCloseTo(2 / 3, 3);
  });
});
