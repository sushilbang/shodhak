/**
 * Text Utilities for Benchmark Evaluation
 *
 * Provides text cleaning functions to prepare LLM outputs
 * for evaluation (e.g., stripping reasoning/thinking chains).
 */

/**
 * Strip thinking chain artifacts from LLM output.
 *
 * Some models (e.g., Qwen3) emit reasoning chains wrapped in
 * <think>...</think> tags or similar patterns. These should be
 * removed before evaluating report quality or citation accuracy.
 *
 * @param text - Raw LLM output
 * @returns Cleaned text with thinking chains removed
 */
export function stripThinkingChain(text: string): string {
    if (!text) return text;

    let cleaned = text;

    // Remove <think>...</think> blocks (Qwen3 style, potentially multi-line)
    cleaned = cleaned.replace(/<think>[\s\S]*?<\/think>/gi, '');

    // Remove <reasoning>...</reasoning> blocks
    cleaned = cleaned.replace(/<reasoning>[\s\S]*?<\/reasoning>/gi, '');

    // Remove <reflection>...</reflection> blocks
    cleaned = cleaned.replace(/<reflection>[\s\S]*?<\/reflection>/gi, '');

    // Remove orphaned opening tags (model cut off mid-thought)
    cleaned = cleaned.replace(/<think>[\s\S]*$/gi, '');
    cleaned = cleaned.replace(/<reasoning>[\s\S]*$/gi, '');
    cleaned = cleaned.replace(/<reflection>[\s\S]*$/gi, '');

    // Clean up excessive whitespace left behind
    cleaned = cleaned.replace(/\n{3,}/g, '\n\n');

    return cleaned.trim();
}
