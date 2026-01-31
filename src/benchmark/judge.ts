/**
 * Automated evaluation harness (the "Judge")
 * - Runs a set of golden queries in `samples/` and scores results for
 *   Faithfulness, Relevancy, and Precision (RAG Triad).
 *
 * This is a lightweight harness that calls the running local API (/query)
 * to evaluate behavior repeatedly. It is intentionally simple and intended
 * to be extended with domain-specific scoring rules.
 */
import fetch from 'node-fetch';
import dotenv from 'dotenv';
import { logger } from '../utils/logger.js';

dotenv.config();

const API_URL = process.env.JUDGE_API_URL || 'http://localhost:3000/query';

const GOLDEN_QUERIES = [
  {
    id: 'g1',
    query: 'What are the essential elements of a valid contract in California?',
  },
  {
    id: 'g2',
    query: 'How does the statute of limitations affect breach of contract claims?',
  },
  // Add more golden queries referencing samples/ in the repository
];

function simpleScorer(answer: string): { faithfulness: number; relevancy: number; precision: number } {
  // Placeholder heuristic scoring: presence of keywords
  const low = 0.0;
  const high = 1.0;

  const faithfulness = answer.length > 50 ? high : low;
  const relevancy = /contract|statute|limitations|breach|california/i.test(answer) ? high : 0.5;
  const precision = answer.split('.').length <= 5 ? high : 0.6;

  return { faithfulness, relevancy, precision };
}

async function run() {
  logger.info('Judge: starting automated evaluation');

  for (const q of GOLDEN_QUERIES) {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: q.query, topK: 5 }),
    });

    if (!res.ok) {
      logger.error(`Judge: API request failed for ${q.id}`, { status: res.status });
      continue;
    }

    const data = await res.json();
    const answer = data?.data?.answer || '';
    const scores = simpleScorer(answer);

    logger.info('Judge: result', {
      id: q.id,
      query: q.query,
      answerPreview: answer.slice(0, 300),
      scores,
    });
  }

  logger.info('Judge: evaluation completed');
}

if (require.main === module) {
  run().catch((err) => {
    logger.error('Judge: unexpected error', { error: err instanceof Error ? err.message : String(err) });
    process.exit(1);
  });
}
