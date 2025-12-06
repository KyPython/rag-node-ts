/**
 * Configuration helper that validates required environment variables
 * Throws clear errors on startup if any required vars are missing
 */

export interface RAGConfig {
  openaiApiKey: string;
  pineconeApiKey: string;
  pineconeIndexName: string;
  pineconeEnvironment?: string | undefined;
}

/**
 * Loads and validates configuration from environment variables
 * @throws Error if any required configuration is missing
 */
export function loadConfig(): RAGConfig {
  const openaiApiKey = process.env.OPENAI_API_KEY;
  const pineconeApiKey = process.env.PINECONE_API_KEY;
  const pineconeIndexName = process.env.PINECONE_INDEX_NAME;
  const pineconeEnvironment = process.env.PINECONE_ENVIRONMENT;

  const missing: string[] = [];

  if (!openaiApiKey) missing.push('OPENAI_API_KEY');
  if (!pineconeApiKey) missing.push('PINECONE_API_KEY');
  if (!pineconeIndexName) missing.push('PINECONE_INDEX_NAME');

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}\n` +
        'Please set these in your .env file or environment.'
    );
  }

  return {
    openaiApiKey: openaiApiKey!,
    pineconeApiKey: pineconeApiKey!,
    pineconeIndexName: pineconeIndexName!,
    pineconeEnvironment,
  };
}

