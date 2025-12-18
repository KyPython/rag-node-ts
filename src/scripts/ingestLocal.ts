#!/usr/bin/env node
/**
 * CLI script for ingesting local documents into the RAG system
 * 
 * Usage: npm run ingest -- file1.pdf file2.md path/to/file3.pdf
 * Or: ts-node-dev src/scripts/ingestLocal.ts file1.pdf file2.md
 */

import { resolve, normalize, isAbsolute } from 'path';
import { ingestDocuments } from '../rag/ingest.js';
import { logger } from '../utils/logger.js';

/**
 * Sanitize file path to prevent path traversal attacks
 */
function sanitizePath(inputPath: string): string {
  // Normalize the path to resolve .. and . segments
  const normalized = normalize(inputPath);
  
  // Convert to absolute path from current working directory
  const absolutePath = isAbsolute(normalized) 
    ? normalized 
    : resolve(process.cwd(), normalized);
  
  // Ensure the path doesn't escape the current directory or allowed directories
  const allowedBase = process.cwd();
  if (!absolutePath.startsWith(allowedBase)) {
    throw new Error(`Path traversal detected: ${inputPath} resolves outside allowed directory`);
  }
  
  return absolutePath;
}

async function main() {
  // Get file paths from command line arguments
  const rawPaths = process.argv.slice(2);
  
  // Sanitize all paths to prevent path traversal
  let filePaths: string[];
  try {
    filePaths = rawPaths.map(sanitizePath);
  } catch (error) {
    logger.error('Invalid file path', {
      error: error instanceof Error ? error.message : String(error),
    });
    process.exit(1);
  }

  if (filePaths.length === 0) {
    logger.error('No file paths provided', {
      usage: 'npm run ingest -- file1.pdf file2.md ...',
      example: 'npm run ingest -- uploads/doc1.pdf uploads/doc2.md',
    });
    process.exit(1);
  }

  logger.info('Starting ingestion script', {
    fileCount: filePaths.length,
    files: filePaths,
  });

  try {
    const results = await ingestDocuments(filePaths);

    // Print summary
    const successful = results.filter((r) => r.success);
    const failed = results.filter((r) => !r.success);
    const totalChunks = results.reduce((sum, r) => sum + r.chunksProcessed, 0);

    logger.info('Ingestion summary', {
      total: results.length,
      successful: successful.length,
      failed: failed.length,
      totalChunks,
    });

    // Print detailed results
    for (const result of results) {
      if (result.success) {
        logger.info('Document ingested', {
          filePath: result.filePath,
          chunksProcessed: result.chunksProcessed,
        });
      } else {
        logger.error('Document ingestion failed', {
          filePath: result.filePath,
          error: result.error,
        });
      }
    }

    // Exit with error code if any documents failed
    if (failed.length > 0) {
      logger.error('Some documents failed to ingest', {
        failedCount: failed.length,
      });
      process.exit(1);
    }

    logger.info('All documents ingested successfully');
    process.exit(0);
  } catch (error) {
    logger.error('Ingestion script failed', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    process.exit(1);
  }
}

main();

