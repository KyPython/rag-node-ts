#!/usr/bin/env ts-node-dev
/**
 * Script to create and configure Pinecone index for RAG service
 * 
 * Usage:
 *   npm run setup-pinecone
 * 
 * Or directly:
 *   ts-node-dev src/scripts/setupPinecone.ts
 */

import { Pinecone } from '@pinecone-database/pinecone';
import { loadConfig } from '../utils/config.js';
import { logger } from '../utils/logger.js';
import dotenv from 'dotenv';

dotenv.config();

const INDEX_NAME = process.env.PINECONE_INDEX_NAME || 'rag-index';
const DIMENSION = 1536; // OpenAI embeddings dimension
const METRIC = 'cosine'; // Best for semantic search

async function setupPinecone() {
  try {
    logger.info('Starting Pinecone setup', {
      indexName: INDEX_NAME,
      dimension: DIMENSION,
      metric: METRIC,
    });

    // Load config to get API key
    const config = loadConfig();

    // Initialize Pinecone
    const pinecone = new Pinecone({
      apiKey: config.pineconeApiKey,
    });

    // List existing indexes
    const existingIndexes = await pinecone.listIndexes();
    logger.info('Existing indexes', {
      indexes: existingIndexes.indexes?.map((idx) => idx.name) || [],
    });

    // Check if index already exists
    const indexExists = existingIndexes.indexes?.some(
      (idx) => idx.name === INDEX_NAME
    );

    if (indexExists) {
      logger.info('Index already exists', { indexName: INDEX_NAME });

      // Get index stats
      const index = pinecone.index(INDEX_NAME);
      const stats = await index.describeIndexStats();
      
      logger.info('Index statistics', {
        indexName: INDEX_NAME,
        totalVectors: stats.totalRecordCount || 0,
        dimension: stats.dimension,
      });

      console.log(`\n✅ Index '${INDEX_NAME}' already exists and is ready to use!`);
      console.log(`   Total vectors: ${stats.totalRecordCount || 0}`);
      return;
    }

    // Create new index
    logger.info('Creating new index', {
      indexName: INDEX_NAME,
      dimension: DIMENSION,
      metric: METRIC,
    });

    // Note: Serverless spec - adjust cloud/region as needed
    await pinecone.createIndex({
      name: INDEX_NAME,
      dimension: DIMENSION,
      metric: METRIC,
      spec: {
        serverless: {
          cloud: 'aws', // or 'gcp', 'azure'
          region: 'us-east-1', // choose your preferred region
        },
      },
    });

    logger.info('Index creation initiated', { indexName: INDEX_NAME });
    console.log(`\n⏳ Creating index '${INDEX_NAME}'...`);
    console.log(`   This may take 1-2 minutes.`);
    console.log(`   Dimensions: ${DIMENSION}`);
    console.log(`   Metric: ${METRIC}`);

    // Wait a bit and check status
    let attempts = 0;
    const maxAttempts = 30; // 30 attempts * 2 seconds = 60 seconds max wait

    while (attempts < maxAttempts) {
      await new Promise((resolve) => setTimeout(resolve, 2000)); // Wait 2 seconds

      const indexes = await pinecone.listIndexes();
      const index = indexes.indexes?.find((idx) => idx.name === INDEX_NAME);

      if (index) {
        console.log(`\n✅ Index '${INDEX_NAME}' created successfully!`);
        logger.info('Index created successfully', { indexName: INDEX_NAME });
        return;
      }

      attempts++;
      process.stdout.write('.');
    }

    console.log(`\n⚠️  Index creation is taking longer than expected.`);
    console.log(`   Please check the Pinecone dashboard for status.`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('Pinecone setup failed', {
      error: errorMessage,
      indexName: INDEX_NAME,
    });

    console.error(`\n❌ Error: ${errorMessage}`);

    if (errorMessage.includes('already exists')) {
      console.log(`\nℹ️  Index '${INDEX_NAME}' already exists. You're all set!`);
    } else if (errorMessage.includes('API key')) {
      console.log(`\nℹ️  Please check your PINECONE_API_KEY in .env file`);
    }

    process.exit(1);
  }
}

setupPinecone();

