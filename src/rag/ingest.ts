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
import { join, extname, basename } from 'path';
import { PDFParse } from 'pdf-parse';
import { RecursiveCharacterTextSplitter } from '@langchain/classic/text_splitter';
import { OpenAIEmbeddings } from '@langchain/openai';
import { Pinecone } from '@pinecone-database/pinecone';
import { logger } from '../utils/logger.js';
import { loadConfig } from '../utils/config.js';

// Type for pdf-parse buffer input
type PDFBuffer = Buffer | Uint8Array;

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
  const buffer = await readFile(filePath);
  const parser = new PDFParse({ data: buffer });
  const textResult = await parser.getText();
  return textResult.text;
}

/**
 * Reads a Markdown file as plain text
 */
async function parseMarkdown(filePath: string): Promise<string> {
  const content = await readFile(filePath, 'utf-8');
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
  chunkSize: number = 1000,
  chunkOverlap: number = 200
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
 */
async function upsertToPinecone(
  chunks: DocumentChunk[],
  embeddings: number[][],
  indexName: string,
  pinecone: Pinecone
): Promise<void> {
  const index = pinecone.index(indexName);

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
 */
async function ingestDocument(filePath: string): Promise<IngestionResult> {
  const startTime = Date.now();
  const fileName = basename(filePath);

  try {
    // Validate file exists
    if (!existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    logger.info('Starting document ingestion', { filePath, fileName });

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
    logger.debug('Parsing document', { filePath });
    const text = await parseDocument(filePath);

    if (!text || text.trim().length === 0) {
      throw new Error('Document is empty or contains no text');
    }

    logger.debug('Document parsed', {
      filePath,
      textLength: text.length,
    });

    // Chunk text
    logger.debug('Chunking text', { filePath });
    const chunks = await chunkText(text, filePath);

    logger.info('Text chunked', {
      filePath,
      chunksCount: chunks.length,
      avgChunkSize: Math.round(
        chunks.reduce((sum, chunk) => sum + chunk.text.length, 0) / chunks.length
      ),
    });

    // Embed chunks
    logger.debug('Generating embeddings', {
      filePath,
      chunksCount: chunks.length,
    });
    const embeddedVectors = await embedChunks(chunks, embeddings);

    logger.info('Embeddings generated', {
      filePath,
      vectorDimensions: embeddedVectors[0]?.length || 0,
    });

    // Upsert to Pinecone
    logger.debug('Upserting to Pinecone', {
      filePath,
      indexName: config.pineconeIndexName,
      chunksCount: chunks.length,
    });
    await upsertToPinecone(chunks, embeddedVectors, config.pineconeIndexName, pinecone);

    const duration = Date.now() - startTime;
    logger.info('Document ingestion completed', {
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

    logger.error('Document ingestion failed', {
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
 */
export async function ingestDocuments(filePaths: string[]): Promise<IngestionResult[]> {
  logger.info('Starting batch document ingestion', {
    documentCount: filePaths.length,
  });

  const results: IngestionResult[] = [];

  for (const filePath of filePaths) {
    const result = await ingestDocument(filePath);
    results.push(result);

    // Small delay between documents to avoid rate limiting
    if (filePaths.length > 1) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  const successful = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success).length;

  logger.info('Batch ingestion completed', {
    total: results.length,
    successful,
    failed,
  });

  return results;
}
