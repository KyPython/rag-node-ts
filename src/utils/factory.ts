/**
 * Factory helpers to create vector and LLM clients based on environment configuration.
 * Allows swapping implementations (pinecone, chroma, azure) via env variables.
 */
import { Pinecone } from '@pinecone-database/pinecone';
import { ChatOpenAI } from '@langchain/openai';
import { loadConfig } from './config.js';
import type { RAGConfig } from './config.js';
import { logger } from './logger.js';

export type VectorClient = any;
export type LLMClient = any;

export function createVectorClient(config?: RAGConfig): VectorClient {
  const cfg = config || loadConfig();
  const backend = process.env.VECTOR_BACKEND || 'pinecone';

  logger.info('Factory: creating vector client', { backend });

  if (backend === 'pinecone') {
    return new Pinecone({
      apiKey: cfg.pineconeApiKey,
      ...(cfg.pineconeEnvironment && { environment: cfg.pineconeEnvironment }),
    });
  }

  if (backend === 'chroma') {
    // Minimal placeholder: users can extend to use Chroma SDK or REST API
    throw new Error('Chroma backend selected but not implemented in factory.');
  }

  if (backend === 'azure') {
    // Placeholder for Azure-based vector service
    throw new Error('Azure vector backend not implemented in factory.');
  }

  throw new Error(`Unknown vector backend: ${backend}`);
}

export function createLLMClient(config?: RAGConfig, model?: string, temperature?: number): LLMClient {
  const cfg = config || loadConfig();
  const backend = process.env.LLM_BACKEND || 'openai';

  logger.info('Factory: creating LLM client', { backend, model });

  if (backend === 'openai') {
    return new ChatOpenAI({
      openAIApiKey: cfg.openaiApiKey,
      modelName: model || process.env.OPENAI_MODEL || 'gpt-4o-mini',
      temperature: typeof temperature === 'number' ? temperature : 0.7,
    });
  }

  if (backend === 'azure') {
    throw new Error('Azure LLM backend not implemented in factory.');
  }

  throw new Error(`Unknown LLM backend: ${backend}`);
}
