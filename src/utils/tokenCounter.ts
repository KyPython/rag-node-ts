/**
 * Token counting utility
 * - Attempts to use @dqbd/tiktoken if available for accurate counts
 * - Falls back to a simple heuristic (chars / 4) if tiktoken is not installed
 */
export async function countTokens(text: string, model?: string): Promise<number> {
  if (!text) return 0;

  // Try to dynamically import tiktoken if present
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const tiktoken = await import('@dqbd/tiktoken');
    // Map model to encoding when possible; default to 'gpt2' safe encoding
    const encodingName = 'gpt2';
    const enc = tiktoken.getEncoding(encodingName);
    const tokens = enc.encode(text).length;
    try { enc.free(); } catch (e) { /* ignore */ }
    return tokens;
  } catch (err) {
    // Fallback heuristic: average 4 chars per token (conservative)
    return Math.ceil(text.length / 4);
  }
}
