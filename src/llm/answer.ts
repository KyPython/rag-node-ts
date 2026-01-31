/**
 * RAG Answer Generation Flow
 * 
 * This module implements the answer generation phase of the RAG pipeline:
 * 
 * 1. Context Preparation: Receives retrieved passages from the vector database
 * 2. Prompt Construction: Builds a system + user prompt that instructs the LLM to:
 *    - Answer the query using ONLY the provided contexts
 *    - Cite passages using index notation [p0], [p1], etc.
 *    - Explicitly state when information is not in the context
 * 3. LLM Inference: Calls OpenAI GPT model via LangChain to generate answer
 * 4. Citation Extraction: Parses the answer to extract referenced passage indices
 * 5. Response Formatting: Returns structured answer with citations
 * 
 * The citations allow frontends to:
 * - Highlight which passages were used to generate the answer
 * - Display source documents with their relevance scores
 * - Enable users to verify claims by viewing original passages
 */

import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { logger } from '../utils/logger.js';
import { loadConfig } from '../utils/config.js';
import { createLLMClient } from '../utils/factory.js';
import { recordLLMTrace } from './langsmith.js';

export interface Context {
  text: string;
  score: number;
  metadata: Record<string, unknown>;
}

export interface AnswerResult {
  answer: string;
  citations: number[];
}

// Configuration constants
const DEFAULT_TEMPERATURE = 0.7;
// Model can be configured via OPENAI_MODEL env var (e.g., 'gpt-4-turbo', 'gpt-4o', 'gpt-4o-mini')
const DEFAULT_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

/**
 * Constructs the system prompt for RAG answer generation
 */
function buildSystemPrompt(): string {
  return `You are a helpful assistant that answers questions based on provided context passages.

Your task:
1. Answer the user's question using ONLY the information in the provided context passages.
2. Cite passages by index using [p0], [p1], [p2], etc., where the number corresponds to the passage index (0-based).
3. If the answer is not found in the context, explicitly state "The provided context does not contain enough information to answer this question."
4. Be concise but thorough, synthesizing information from multiple passages when relevant.
5. If citing multiple passages, use format like [p0][p1] or cite separately [p0] and [p1].

Guidelines:
- Always cite your sources using the [pN] notation
- Do not make up information not present in the context
- If information from multiple passages is relevant, cite all of them
- Be accurate and truthful based solely on the provided context`;
}

/**
 * Constructs the user prompt with query and context passages
 */
function buildUserPrompt(query: string, contexts: Context[]): string {
  const contextSections = contexts
    .map((ctx, index) => `[p${index}]: ${ctx.text}`)
    .join('\n\n');

  return `Question: ${query}

Context passages:
${contextSections}

Please answer the question using the context passages above. Cite passages using [p0], [p1], etc.`;
}

/**
 * Extracts citation indices from the answer text
 * Looks for patterns like [p0], [p1], [p2], etc.
 */
function extractCitations(answer: string, maxContextIndex: number): number[] {
  // Match [p0], [p1], [p2], etc., including cases like [p0][p1] together
  const citationPattern = /\[p(\d+)\]/g;
  const citations = new Set<number>();
  let match;

  while ((match = citationPattern.exec(answer)) !== null) {
    const index = parseInt(match[1]!, 10);
    // Only include valid indices
    if (index >= 0 && index <= maxContextIndex) {
      citations.add(index);
    }
  }

  return Array.from(citations).sort((a, b) => a - b);
}

/**
 * Generates an answer to a query using retrieved context passages
 * 
 * @param query - The user's question
 * @param contexts - Retrieved passages with scores and metadata
 * @param temperature - Temperature for LLM generation (default: 0.7)
 * @param model - OpenAI model to use (default: 'gpt-4o-mini')
 * @returns Answer with citations
 */
export async function generateAnswer(
  query: string,
  contexts: Context[],
  temperature: number = DEFAULT_TEMPERATURE,
  model: string = DEFAULT_MODEL,
  requestId?: string
): Promise<AnswerResult> {
  const startTime = Date.now();

  try {
    logger.info('Starting answer generation', {
      queryLength: query.length,
      contextsCount: contexts.length,
      model,
      temperature,
    });

    // Validate we have contexts
    if (contexts.length === 0) {
      logger.warn('No contexts provided for answer generation');
      return {
        answer: 'No relevant passages were found to answer this question.',
        citations: [],
      };
    }

    // Load configuration
    const config = loadConfig();

    // Initialize LLM via factory (OpenAI/Azure)
    const llm = createLLMClient(config, model, temperature);

    // Build prompts
    const systemPrompt = buildSystemPrompt();
    const userPrompt = buildUserPrompt(query, contexts);

    logger.debug('Generated prompts', {
      systemPromptLength: systemPrompt.length,
      userPromptLength: userPrompt.length,
    });

    // Generate answer
    logger.debug('Calling LLM for answer generation');
    const messages = [
      new SystemMessage(systemPrompt),
      new HumanMessage(userPrompt),
    ];

    const response = await llm.invoke(messages);
    const answer = typeof response.content === 'string' 
      ? response.content 
      : String(response.content);

    // Extract citations
    const citations = extractCitations(answer, contexts.length - 1);

    const duration = Date.now() - startTime;
    logger.info('Answer generation completed', {
      queryLength: query.length,
      answerLength: answer.length,
      citationsCount: citations.length,
      citations,
      durationMs: duration,
    });

    // Observability: record LLM token usage via LangSmith stub
    try {
      const promptTokens = Math.ceil(contexts.reduce((s, c) => s + (c.text?.length || 0), 0) / 4);
      const completionTokens = Math.ceil(answer.length / 4);
      recordLLMTrace(requestId, promptTokens, completionTokens, model, 0 /* cost placeholder */);
    } catch (err) {
      logger.warn('Failed to record LLM trace', { requestId });
    }

    return { answer, citations };
  } catch (error) {
    const duration = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : String(error);

    logger.error('Answer generation failed', {
      query,
      error: errorMessage,
      durationMs: duration,
    });

    throw new Error(`Answer generation failed: ${errorMessage}`);
  }
}

