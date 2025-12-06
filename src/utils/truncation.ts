/**
 * Truncation Utilities
 * 
 * Provides helpers to limit input size to LLM models to:
 * - Control costs (billed per token)
 * - Stay within model context limits
 * - Improve response times
 * 
 * Cost Considerations:
 * - OpenAI charges per token (~$0.01-0.10 per 1K tokens)
 * - Longer contexts = higher costs
 * - Truncation helps control costs while maintaining quality
 * 
 * Note: This uses character-based truncation as a simple approximation.
 * In production, use a proper tokenizer (e.g., tiktoken for OpenAI models).
 */

/**
 * Truncate text to a maximum character length
 * Attempts to preserve word boundaries when possible
 * 
 * @param text Text to truncate
 * @param maxLength Maximum character length
 * @returns Truncated text with ellipsis if truncated
 */
export function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }

  // Try to truncate at word boundary
  const truncated = text.substring(0, maxLength - 3);
  const lastSpace = truncated.lastIndexOf(' ');

  if (lastSpace > maxLength * 0.8) {
    // If we can preserve a word boundary relatively close to max, do so
    return truncated.substring(0, lastSpace) + '...';
  }

  // Otherwise, hard truncate
  return truncated + '...';
}

/**
 * Truncate multiple context passages to fit within a total character limit
 * Preserves as many passages as possible, truncating from the end
 * 
 * @param contexts Array of context texts
 * @param maxTotalLength Maximum total character length
 * @returns Array of truncated contexts
 */
export function truncateContexts(
  contexts: string[],
  maxTotalLength: number
): string[] {
  const result: string[] = [];
  let totalLength = 0;

  for (const context of contexts) {
    const remaining = maxTotalLength - totalLength;

    if (remaining <= 0) {
      break;
    }

    if (context.length <= remaining) {
      result.push(context);
      totalLength += context.length;
    } else {
      // Truncate this context to fit
      result.push(truncateText(context, remaining));
      break;
    }
  }

  return result;
}

/**
 * Estimate token count from text (rough approximation)
 * Actual tokenization should use a proper tokenizer like tiktoken
 * 
 * Rule of thumb: ~4 characters = 1 token for English text
 * 
 * @param text Text to estimate tokens for
 * @returns Approximate token count
 */
export function estimateTokenCount(text: string): number {
  // Simple heuristic: ~4 characters per token
  // For accurate counting, use: import { encoding_for_model } from 'tiktoken';
  // const encoding = encoding_for_model('gpt-4');
  // return encoding.encode(text).length;
  return Math.ceil(text.length / 4);
}

