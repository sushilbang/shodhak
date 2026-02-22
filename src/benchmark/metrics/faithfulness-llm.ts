/**
 * LLM-Based Faithfulness Metric
 *
 * Measures how factually consistent a response is with the retrieved context.
 * Uses LLM to extract and verify claims, providing more accurate results than
 * simple keyword matching.
 *
 * Formula:
 *   Faithfulness = Number of claims supported by context / Total number of claims
 *
 * Range: [0, 1], where 1 = perfectly faithful (no hallucinations)
 */

import OpenAI from 'openai';
import { Paper } from '../../models/database.models';
import { createFastClient } from '../../utils/llm-client.factory';
import { logger } from '../../utils/logger';

// ============================================================================
// INTERFACES
// ============================================================================

export interface ClaimVerification {
    claim: string;
    supported: boolean;
    evidence?: string;       // Supporting text from context (if found)
    confidence: number;      // LLM's confidence in the verification [0, 1]
}

export interface FaithfulnessLLMResult {
    score: number;                          // [0, 1] - main faithfulness score
    totalClaims: number;
    supportedClaims: number;
    unsupportedClaims: string[];            // List of hallucinated claims
    hallucinationRate: number;              // 1 - score
    claimDetails: ClaimVerification[];      // Detailed verification for each claim
    processingTime: number;                 // Time taken in ms
}

export interface FaithfulnessLLMOptions {
    llmClient?: OpenAI;
    model?: string;
    maxClaimsToVerify?: number;             // Limit for performance (default: 20)
    confidenceThreshold?: number;           // Min confidence to count as supported (default: 0.7)
}

// ============================================================================
// MAIN IMPLEMENTATION
// ============================================================================

/**
 * Calculate faithfulness score using LLM for claim extraction and verification
 *
 * Steps:
 * 1. Extract all factual claims from the response using LLM
 * 2. For each claim, use LLM to check if it's supported by the context
 * 3. Calculate: supported_claims / total_claims
 */
export async function calculateFaithfulnessLLM(
    response: string,
    context: string[],
    options: FaithfulnessLLMOptions = {}
): Promise<FaithfulnessLLMResult> {
    const startTime = Date.now();

    // Get or create LLM client
    const { client, model } = options.llmClient
        ? { client: options.llmClient, model: options.model || 'llama-3.3-70b-versatile' }
        : createFastClient();

    const maxClaims = options.maxClaimsToVerify || 20;
    const confidenceThreshold = options.confidenceThreshold || 0.7;

    try {
        // Step 1: Extract claims from the response
        logger.debug('Extracting claims from response', { responseLength: response.length });
        const claims = await extractClaimsWithLLM(response, client, model);

        if (claims.length === 0) {
            return {
                score: 1.0,
                totalClaims: 0,
                supportedClaims: 0,
                unsupportedClaims: [],
                hallucinationRate: 0,
                claimDetails: [],
                processingTime: Date.now() - startTime
            };
        }

        // Limit claims for performance
        const claimsToVerify = claims.slice(0, maxClaims);

        // Step 2: Verify each claim against the context
        logger.debug('Verifying claims against context', {
            claimCount: claimsToVerify.length,
            contextDocs: context.length
        });

        const combinedContext = context.join('\n\n---\n\n');
        const verifications = await verifyClaimsWithLLM(
            claimsToVerify,
            combinedContext,
            client,
            model
        );

        // Step 3: Calculate faithfulness score
        const supportedCount = verifications.filter(
            v => v.supported && v.confidence >= confidenceThreshold
        ).length;

        const unsupportedClaims = verifications
            .filter(v => !v.supported || v.confidence < confidenceThreshold)
            .map(v => v.claim);

        const score = claimsToVerify.length > 0
            ? supportedCount / claimsToVerify.length
            : 1.0;

        const result: FaithfulnessLLMResult = {
            score,
            totalClaims: claimsToVerify.length,
            supportedClaims: supportedCount,
            unsupportedClaims,
            hallucinationRate: 1 - score,
            claimDetails: verifications,
            processingTime: Date.now() - startTime
        };

        logger.info('Faithfulness LLM evaluation completed', {
            score: result.score,
            totalClaims: result.totalClaims,
            supportedClaims: result.supportedClaims,
            hallucinationRate: result.hallucinationRate,
            processingTimeMs: result.processingTime
        });

        return result;

    } catch (error) {
        logger.error('Faithfulness LLM evaluation failed', { error });
        throw error;
    }
}

/**
 * Calculate faithfulness with Paper objects (convenience wrapper)
 */
export async function calculateFaithfulnessLLMWithPapers(
    response: string,
    papers: Paper[],
    options: FaithfulnessLLMOptions = {}
): Promise<FaithfulnessLLMResult> {
    // Extract text context from papers
    const context = papers.map(p =>
        `Title: ${p.title}\nAbstract: ${p.abstract || 'N/A'}`
    );

    return calculateFaithfulnessLLM(response, context, options);
}

// ============================================================================
// LLM CLAIM EXTRACTION
// ============================================================================

/**
 * Extract factual claims from text using LLM
 */
async function extractClaimsWithLLM(
    text: string,
    client: OpenAI,
    model: string
): Promise<string[]> {
    const prompt = `Extract all factual claims from the following text. A factual claim is a statement that can be verified as true or false.

Rules:
- Extract only objective, verifiable claims (not opinions or questions)
- Each claim should be a complete, standalone statement
- Focus on claims about research findings, statistics, methodologies, and conclusions
- Ignore meta-statements like "this paper discusses" or "we will explore"

Text:
"""
${text}
"""

Return the claims as a JSON array of strings. Example format:
["Claim 1", "Claim 2", "Claim 3"]

If there are no factual claims, return an empty array: []`;

    try {
        const completion = await client.chat.completions.create({
            model,
            messages: [{ role: 'user', content: prompt }],
            max_tokens: 2048,
            temperature: 0.1  // Low temperature for consistent extraction
        });

        const content = completion.choices[0]?.message?.content || '[]';
        return parseClaimsArray(content);

    } catch (error) {
        logger.error('Failed to extract claims with LLM', { error });
        return [];
    }
}

/**
 * Parse claims array from LLM response
 */
function parseClaimsArray(content: string): string[] {
    try {
        // Try to find JSON array in the response
        const jsonMatch = content.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            if (Array.isArray(parsed)) {
                return parsed.filter(item => typeof item === 'string' && item.trim().length > 0);
            }
        }
    } catch (e) {
        logger.debug('Failed to parse claims as JSON, falling back to line parsing');
    }

    // Fallback: parse as numbered list or line-separated claims
    return content
        .split('\n')
        .map(line => line.replace(/^\d+[\.\)]\s*/, '').replace(/^[-*]\s*/, '').trim())
        .filter(line => line.length > 10 && !line.startsWith('[') && !line.startsWith('{'));
}

// ============================================================================
// LLM CLAIM VERIFICATION
// ============================================================================

/**
 * Verify claims against context using LLM
 */
async function verifyClaimsWithLLM(
    claims: string[],
    context: string,
    client: OpenAI,
    model: string
): Promise<ClaimVerification[]> {
    const prompt = `You are a fact-checker. For each claim below, determine if it is SUPPORTED by the given context.

Context:
"""
${context.slice(0, 8000)}
"""

Claims to verify:
${claims.map((claim, i) => `${i + 1}. ${claim}`).join('\n')}

For each claim, respond with a JSON array containing objects with:
- "claim": the claim text
- "supported": true if the claim can be inferred from the context, false otherwise
- "evidence": if supported, quote the relevant text from context (max 100 chars)
- "confidence": your confidence level from 0.0 to 1.0

Example response:
[
  {"claim": "...", "supported": true, "evidence": "...", "confidence": 0.95},
  {"claim": "...", "supported": false, "evidence": null, "confidence": 0.85}
]

Important: A claim is SUPPORTED only if the context provides clear evidence for it. If the context doesn't mention the claim at all, mark it as NOT supported.`;

    try {
        const completion = await client.chat.completions.create({
            model,
            messages: [{ role: 'user', content: prompt }],
            max_tokens: 4096,
            temperature: 0.1
        });

        const content = completion.choices[0]?.message?.content || '[]';
        return parseVerificationsArray(content, claims);

    } catch (error) {
        logger.error('Failed to verify claims with LLM', { error });
        // Return all claims as unverified
        return claims.map(claim => ({
            claim,
            supported: false,
            confidence: 0
        }));
    }
}

/**
 * Parse verifications array from LLM response
 */
function parseVerificationsArray(content: string, originalClaims: string[]): ClaimVerification[] {
    try {
        // Try to find JSON array in the response
        const jsonMatch = content.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            if (Array.isArray(parsed)) {
                return parsed.map((item, i) => ({
                    claim: item.claim || originalClaims[i] || '',
                    supported: Boolean(item.supported),
                    evidence: item.evidence || undefined,
                    confidence: typeof item.confidence === 'number'
                        ? Math.min(1, Math.max(0, item.confidence))
                        : 0.5
                }));
            }
        }
    } catch (e) {
        logger.debug('Failed to parse verifications as JSON');
    }

    // Fallback: assume all claims are unsupported
    return originalClaims.map(claim => ({
        claim,
        supported: false,
        confidence: 0
    }));
}

// ============================================================================
// AGGREGATION
// ============================================================================

/**
 * Aggregate faithfulness results across multiple evaluations
 */
export function aggregateFaithfulnessLLM(results: FaithfulnessLLMResult[]): {
    avgScore: number;
    avgHallucinationRate: number;
    totalClaims: number;
    totalSupported: number;
    totalUnsupported: number;
    avgProcessingTime: number;
    evaluationCount: number;
} {
    if (results.length === 0) {
        return {
            avgScore: 0,
            avgHallucinationRate: 0,
            totalClaims: 0,
            totalSupported: 0,
            totalUnsupported: 0,
            avgProcessingTime: 0,
            evaluationCount: 0
        };
    }

    const totalClaims = results.reduce((sum, r) => sum + r.totalClaims, 0);
    const totalSupported = results.reduce((sum, r) => sum + r.supportedClaims, 0);

    return {
        avgScore: results.reduce((sum, r) => sum + r.score, 0) / results.length,
        avgHallucinationRate: results.reduce((sum, r) => sum + r.hallucinationRate, 0) / results.length,
        totalClaims,
        totalSupported,
        totalUnsupported: totalClaims - totalSupported,
        avgProcessingTime: results.reduce((sum, r) => sum + r.processingTime, 0) / results.length,
        evaluationCount: results.length
    };
}
