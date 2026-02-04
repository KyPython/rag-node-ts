/**
 * RAG Data Flow - Ingestion Pipeline
 * 
 * 1. Document Loading: Read PDF/Markdown files from local paths
 * 2. Text Extraction: Parse PDFs (pdf-parse) or read Markdown as plain text
 * 3. Text Chunking: Split documents into overlapping chunks (500-1000 chars, ~200 char overlap)
 * 4. Embedding Generation: Use OpenAI embeddings (via LangChain) to create vector representations
 * 5. Vector Storage: Upsert embeddings + metadata into Pinecone index
 * 
 * Future enhancements:
 * - Streaming ingestion for large document sets
 * - Cloud storage paths (S3, GCS) instead of local files
 * - Support for other document types (DOCX, TXT, HTML)
 * - Batch processing optimizations
 */

import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join, extname, basename, resolve, normalize, isAbsolute } from 'path';
import { PDFParse } from 'pdf-parse';
import { RecursiveCharacterTextSplitter } from '@langchain/classic/text_splitter';
import { OpenAIEmbeddings } from '@langchain/openai';
import { Pinecone } from '@pinecone-database/pinecone';
import { logger } from '../utils/logger.js';
import { loadConfig } from '../utils/config.js';

// When set to "true", ingest pipeline will stop after chunking and skip
// embedding generation + vector upserts. Useful for offline chunking experiments.
const CHUNK_ONLY = process.env.CHUNK_ONLY === 'true';

// Type for pdf-parse buffer input
type PDFBuffer = Buffer | Uint8Array;

// Allowed base directories for file ingestion (security)
const ALLOWED_BASE_DIRS = [
  process.cwd(),
  resolve(process.cwd(), 'uploads'),
  resolve(process.cwd(), 'samples'),
  // Allow paths specified via environment
  ...(process.env.RAG_ALLOWED_PATHS?.split(',').map(p => resolve(p.trim())) || []),
];

/**
 * Validate that a file path is safe to read (prevents path traversal)
 * @throws Error if path is outside allowed directories
 */
function validateFilePath(filePath: string): string {
  // Normalize and resolve to absolute path
  const normalizedPath = normalize(filePath);
  const absolutePath = isAbsolute(normalizedPath) 
    ? normalizedPath 
    : resolve(process.cwd(), normalizedPath);
  
  // Check if path is within any allowed directory
  const isAllowed = ALLOWED_BASE_DIRS.some(baseDir => 
    absolutePath.startsWith(baseDir + '/') || absolutePath === baseDir
  );
  
  if (!isAllowed) {
    throw new Error(`Access denied: File path "${filePath}" is outside allowed directories`);
  }
  
  return absolutePath;
}

export interface DocumentChunk {
  text: string;
  metadata: {
    source: string;
    chunkIndex: number;
    totalChunks?: number;
    [key: string]: unknown;
  };
}

export interface IngestionResult {
  filePath: string;
  chunksProcessed: number;
  success: boolean;
  error?: string;
}

/**
 * Reads and parses a PDF file
 */
async function parsePDF(filePath: string): Promise<string> {
  const safePath = validateFilePath(filePath);
  const buffer = await readFile(safePath);
  const parser = new PDFParse({ data: buffer });
  const textResult = await parser.getText();
  return textResult.text;
}

/**
 * Reads a Markdown file as plain text
 */
async function parseMarkdown(filePath: string): Promise<string> {
  const safePath = validateFilePath(filePath);
  const content = await readFile(safePath, 'utf-8');
  return content;
}

/**
 * Parses a document based on its file extension
 */
async function parseDocument(filePath: string): Promise<string> {
  const ext = extname(filePath).toLowerCase();
  
  if (ext === '.pdf') {
    return await parsePDF(filePath);
  } else if (ext === '.md' || ext === '.markdown') {
    return await parseMarkdown(filePath);
  } else {
    throw new Error(`Unsupported file type: ${ext}. Supported: .pdf, .md, .markdown`);
  }
}

/**
 * Chunks text into overlapping segments suitable for retrieval
 * Uses 500-1000 character chunks with ~200 character overlap
 */
async function chunkText(
  text: string,
  source: string,
  chunkSize: number = 500,
  chunkOverlap: number = 100
): Promise<DocumentChunk[]> {
  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize,
    chunkOverlap,
  });

  // RecursiveCharacterTextSplitter.splitText is async in newer versions
  const textChunks = await splitter.splitText(text);
  
  return textChunks.map((chunkText: string, index: number) => ({
    text: chunkText,
    metadata: {
      source,
      chunkIndex: index,
      totalChunks: textChunks.length,
      text: chunkText, // Store text in metadata for retrieval
    },
  }));
}

/**
 * Embeds text chunks using OpenAI embeddings
 */
async function embedChunks(
  chunks: DocumentChunk[],
  embeddings: OpenAIEmbeddings
): Promise<number[][]> {
  const texts = chunks.map((chunk) => chunk.text);
  const embeddingsArray = await embeddings.embedDocuments(texts);
  return embeddingsArray;
}

/**
 * Upserts embedded chunks into Pinecone index
 * 
 * @param namespace - Optional namespace for multi-tenant isolation
 */
async function upsertToPinecone(
  chunks: DocumentChunk[],
  embeddings: number[][],
  indexName: string,
  pinecone: Pinecone,
  namespace?: string
): Promise<void> {
  const baseIndex = pinecone.index(indexName);
  const index = namespace ? baseIndex.namespace(namespace) : baseIndex;

  // Prepare vectors for upsert
  // Pinecone metadata must have string, number, boolean, or array values (no undefined)
  const vectors = chunks.map((chunk, i) => {
    const metadata: Record<string, string | number> = {
      source: String(chunk.metadata.source),
      chunkIndex: Number(chunk.metadata.chunkIndex),
      text: String(chunk.metadata.text),
    };
    
    // Only include totalChunks if it exists
    if (chunk.metadata.totalChunks) {
      metadata.totalChunks = Number(chunk.metadata.totalChunks);
    }
    
    return {
      id: `${chunk.metadata.source}_chunk_${chunk.metadata.chunkIndex}`,
      values: embeddings[i]!,
      metadata,
    };
  });

  // Upsert in batches (Pinecone recommends batches of 100)
  const batchSize = 100;
  for (let i = 0; i < vectors.length; i += batchSize) {
    const batch = vectors.slice(i, i + batchSize);
    await index.upsert(batch);
    logger.debug(`Upserted batch ${Math.floor(i / batchSize) + 1}`, {
      batchSize: batch.length,
      totalBatches: Math.ceil(vectors.length / batchSize),
    });
  }
}

/**
 * Ingests a single document file
 * 
 * @param filePath - Path to the document
 * @param namespace - Optional namespace for multi-tenant isolation
 */
async function ingestDocument(filePath: string, namespace?: string, requestId?: string, reqLogger?: any): Promise<IngestionResult> {
  const startTime = Date.now();
  const fileName = basename(filePath);
  const log = reqLogger || logger;

  try {
    // Validate file path is safe and exists
    const safePath = validateFilePath(filePath);
    if (!existsSync(safePath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    log.info('Starting document ingestion', { filePath, fileName });

    // Load config
    const config = loadConfig();

    // Initialize embeddings
    const embeddings = new OpenAIEmbeddings({
      openAIApiKey: config.openaiApiKey,
    });

    // Initialize Pinecone
    const pinecone = new Pinecone({
      apiKey: config.pineconeApiKey,
      ...(config.pineconeEnvironment && { environment: config.pineconeEnvironment }),
    });

    // Parse document
    log.debug('Parsing document', { filePath });
    const text = await parseDocument(filePath);

    if (!text || text.trim().length === 0) {
      throw new Error('Document is empty or contains no text');
    }

    log.debug('Document parsed', {
      filePath,
      textLength: text.length,
    });

    // Chunk text
    log.debug('Chunking text', { filePath });
    const chunks = await chunkText(text, filePath);

    log.info('Text chunked', {
      filePath,
      chunksCount: chunks.length,
      avgChunkSize: Math.round(
        chunks.reduce((sum, chunk) => sum + chunk.text.length, 0) / chunks.length
      ),
    });
    // Optionally short-circuit here for chunk-only experiments
    if (CHUNK_ONLY) {
      log.info('CHUNK_ONLY mode enabled — skipping embeddings and vector upserts', {
        filePath,
        chunksCount: chunks.length,
        sampleChunk: chunks[0]?.text?.slice(0, 200),
      });

      const duration = Date.now() - startTime;
      log.info('Document ingestion completed (chunk-only)', {
        filePath,
        chunksProcessed: chunks.length,
        durationMs: duration,
      });

      return {
        filePath,
        chunksProcessed: chunks.length,
        success: true,
      };
    }

    // Embed chunks
    log.debug('Generating embeddings', {
      filePath,
      chunksCount: chunks.length,
    });
    const embeddedVectors = await embedChunks(chunks, embeddings);

    log.info('Embeddings generated', {
      filePath,
      vectorDimensions: embeddedVectors[0]?.length || 0,
    });

    // Upsert to Pinecone (with optional namespace for multi-tenancy)
    log.debug('Upserting to Pinecone', {
      filePath,
      indexName: config.pineconeIndexName,
      namespace: namespace || '(default)',
      chunksCount: chunks.length,
    });
    await upsertToPinecone(chunks, embeddedVectors, config.pineconeIndexName, pinecone, namespace);

    const duration = Date.now() - startTime;
    log.info('Document ingestion completed', {
      filePath,
      chunksProcessed: chunks.length,
      durationMs: duration,
    });

    return {
      filePath,
      chunksProcessed: chunks.length,
      success: true,
    };
  } catch (error) {
    const duration = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : String(error);

    log.error('Document ingestion failed', {
      filePath,
      error: errorMessage,
      durationMs: duration,
    });

    return {
      filePath,
      chunksProcessed: 0,
      success: false,
      error: errorMessage,
    };
  }
}

/**
 * Ingests multiple documents from file paths
 * Processes documents sequentially to avoid overwhelming the API
 * 
 * @param filePaths - Array of file paths to ingest
 * @param namespace - Optional namespace for multi-tenant isolation
 */
export async function ingestDocuments(filePaths: string[], namespace?: string, requestId?: string, reqLogger?: any): Promise<IngestionResult[]> {
  const log = reqLogger || logger;
  log.info('Starting batch document ingestion', {
    documentCount: filePaths.length,
    namespace: namespace || '(default)',
  });

  const results: IngestionResult[] = [];

  for (const filePath of filePaths) {
    const result = await ingestDocument(filePath, namespace, requestId, reqLogger);
    results.push(result);

    // Small delay between documents to avoid rate limiting
    if (filePaths.length > 1) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  const successful = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success).length;

  log.info('Batch ingestion completed', {
    total: results.length,
    successful,
    failed,
    namespace: namespace || '(default)',
  });

  return results;
}

/**
 * Ingests raw text content (for API ingestion without file upload)
 * 
 * @param text - The text content to ingest
 * @param source - Source identifier (e.g., "api:doc-123", "easyflow:workflow-help")
 * @param namespace - Optional namespace for multi-tenant isolation
 * @param metadata - Additional metadata to store with chunks
 */
export async function ingestText(
  text: string,
  source: string,
  namespace?: string,
  metadata: Record<string, unknown> = {},
  requestId?: string,
  reqLogger?: any
): Promise<IngestionResult> {
  const startTime = Date.now();
  const log = reqLogger || logger;

  try {
    if (!text || text.trim().length === 0) {
      throw new Error('Text content is empty');
    }

    log.info('Starting text ingestion', {
      source,
      textLength: text.length,
      namespace: namespace || '(default)',
    });

    // Load config
    const config = loadConfig();

    // Initialize embeddings
    const embeddings = new OpenAIEmbeddings({
      openAIApiKey: config.openaiApiKey,
    });

    // Initialize Pinecone
    const pinecone = new Pinecone({
      apiKey: config.pineconeApiKey,
      ...(config.pineconeEnvironment && { environment: config.pineconeEnvironment }),
    });

    // Chunk text
    const chunks = await chunkText(text, source);
    
    // Add custom metadata to each chunk
    const enrichedChunks = chunks.map(chunk => ({
      ...chunk,
      metadata: {
        ...chunk.metadata,
        ...metadata,
      },
    }));

    log.info('Text chunked', {
      source,
      chunksCount: enrichedChunks.length,
    });

    // Optionally short-circuit here for chunk-only experiments
    if (CHUNK_ONLY) {
      log.info('CHUNK_ONLY mode enabled — skipping embeddings and vector upserts', {
        source,
        chunksCount: enrichedChunks.length,
        sampleChunk: enrichedChunks[0]?.text?.slice(0, 200),
      });

      const duration = Date.now() - startTime;
      log.info('Text ingestion completed (chunk-only)', {
        source,
        chunksProcessed: enrichedChunks.length,
        namespace: namespace || '(default)',
        durationMs: duration,
      });

      return {
        filePath: source,
        chunksProcessed: enrichedChunks.length,
        success: true,
      };
    }

    // Embed chunks
    const embeddedVectors = await embedChunks(enrichedChunks, embeddings);

    log.info('Embeddings generated', {
      source,
      vectorDimensions: embeddedVectors[0]?.length || 0,
    });

    // Upsert to Pinecone
    await upsertToPinecone(enrichedChunks, embeddedVectors, config.pineconeIndexName, pinecone, namespace);

    const duration = Date.now() - startTime;
    log.info('Text ingestion completed', {
      source,
      chunksProcessed: enrichedChunks.length,
      namespace: namespace || '(default)',
      durationMs: duration,
    });

    return {
      filePath: source,
      chunksProcessed: enrichedChunks.length,
      success: true,
    };
  } catch (error) {
    const duration = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : String(error);

    log.error('Text ingestion failed', {
      source,
      error: errorMessage,
      durationMs: duration,
    });

    return {
      filePath: source,
      chunksProcessed: 0,
      success: false,
      error: errorMessage,
    };
  }
}
