/**
 * RAG (Retrieval-Augmented Generation) Evaluation Metrics
 *
 * Implements standard RAG evaluation metrics:
 * - Faithfulness: Does the answer stick to the retrieved context?
 * - Answer Relevance: Does the answer address the user's question?
 * - Context Precision: Are the retrieved documents relevant to the question?
 * - Context Recall: Does the context contain all information needed to answer?
 */

import { Paper } from '../../models/database.models';

// ============================================================================
// MATHEMATICAL MODELS & FORMULAE
// ============================================================================

/**
 * FAITHFULNESS METRIC
 * -------------------
 * Measures if generated claims are supported by the context.
 *
 * Formula:
 *   Faithfulness = |supported_claims| / |total_claims|
 *
 * Where:
 *   - supported_claims = claims that can be verified from context
 *   - total_claims = all factual claims in the generated response
 *
 * Range: [0, 1], where 1 = perfectly faithful
 */
export interface FaithfulnessResult {
    score: number;                    // [0, 1]
    totalClaims: number;
    supportedClaims: number;
    unsupportedClaims: string[];      // Claims not found in context
    hallucinationRate: number;        // 1 - faithfulness
}

/**
 * ANSWER RELEVANCE METRIC
 * -----------------------
 * Measures if the answer addresses the user's question.
 *
 * Formula:
 *   AnswerRelevance = cos_sim(embed(question), embed(answer))
 *                   × coverage_factor
 *
 * Where:
 *   - cos_sim = cosine similarity of embeddings
 *   - coverage_factor = |question_keywords ∩ answer_keywords| / |question_keywords|
 *
 * Range: [0, 1], where 1 = perfectly relevant
 */
export interface AnswerRelevanceResult {
    score: number;                    // [0, 1]
    semanticSimilarity: number;       // Embedding-based similarity
    keywordCoverage: number;          // Keyword overlap
    questionKeywords: string[];
    answeredKeywords: string[];
    missedKeywords: string[];
}

/**
 * CONTEXT PRECISION METRIC
 * ------------------------
 * Measures the proportion of retrieved context that is relevant.
 *
 * Formula:
 *   ContextPrecision = Σ(relevance_i × position_weight_i) / |retrieved_docs|
 *
 * Where:
 *   - relevance_i ∈ {0, 1} indicates if doc_i is relevant
 *   - position_weight_i = 1 / log2(i + 2)  (higher weight for top results)
 *
 * Weighted Average Precision@K:
 *   P@k = (1/k) × Σ_{i=1}^{k} (relevance_i × precision@i)
 *
 * Range: [0, 1], where 1 = all retrieved docs are relevant
 */
export interface ContextPrecisionResult {
    score: number;                    // [0, 1]
    precisionAtK: number[];           // P@1, P@2, ..., P@k
    relevantDocs: number;
    totalDocs: number;
    averagePrecision: number;         // MAP score
    ndcg: number;                     // Normalized Discounted Cumulative Gain
}

/**
 * CONTEXT RECALL METRIC
 * ---------------------
 * Measures if the context contains all information needed to answer.
 *
 * Formula:
 *   ContextRecall = |answer_sentences_attributable_to_context| / |total_answer_sentences|
 *
 * Alternative (ground-truth based):
 *   ContextRecall = |retrieved_relevant| / |total_relevant|
 *
 * Range: [0, 1], where 1 = context contains everything needed
 */
export interface ContextRecallResult {
    score: number;                    // [0, 1]
    attributableSentences: number;
    totalSentences: number;
    groundTruthRecall?: number;       // If ground truth is available
    missingInformation: string[];     // Information gaps
}

/**
 * COMBINED RAG SCORE
 * ------------------
 * Harmonic mean of all metrics (like F1 but for 4 components)
 *
 * Formula:
 *   RAG_Score = 4 / (1/F + 1/AR + 1/CP + 1/CR)
 *
 * Where:
 *   F = Faithfulness
 *   AR = Answer Relevance
 *   CP = Context Precision
 *   CR = Context Recall
 */
export interface RAGEvaluationResult {
    faithfulness: FaithfulnessResult;
    answerRelevance: AnswerRelevanceResult;
    contextPrecision: ContextPrecisionResult;
    contextRecall: ContextRecallResult;
    overallScore: number;             // Harmonic mean
    weightedScore: number;            // Configurable weighted average
}

// ============================================================================
// IMPLEMENTATION
// ============================================================================

/**
 * Extract factual claims from generated text
 * Uses simple sentence segmentation and heuristic filtering
 */
export function extractClaims(text: string): string[] {
    // Split into sentences
    const sentences = text
        .split(/[.!?]+/)
        .map(s => s.trim())
        .filter(s => s.length > 20);  // Filter very short fragments

    // Filter to likely factual claims (exclude questions, opinions)
    return sentences.filter(s => {
        const lower = s.toLowerCase();
        // Exclude questions
        if (s.endsWith('?')) return false;
        // Exclude pure opinion markers
        if (lower.startsWith('i think') || lower.startsWith('i believe')) return false;
        // Exclude meta-statements
        if (lower.startsWith('this paper') && lower.includes('will')) return false;
        return true;
    });
}

/**
 * Check if a claim is supported by the context
 * Uses keyword overlap and semantic matching
 */
export function isClaimSupported(
    claim: string,
    context: string[],
    threshold: number = 0.3
): boolean {
    const claimTokens = tokenize(claim);

    for (const doc of context) {
        const docTokens = new Set(tokenize(doc));
        const overlap = claimTokens.filter(t => docTokens.has(t)).length;
        const similarity = overlap / claimTokens.length;

        if (similarity >= threshold) {
            return true;
        }
    }

    return false;
}

/**
 * Calculate Faithfulness score
 *
 * PSEUDOCODE:
 * ```
 * function calculateFaithfulness(answer, context):
 *     claims = extractClaims(answer)
 *     supported = 0
 *     unsupported = []
 *
 *     for each claim in claims:
 *         if isClaimSupported(claim, context):
 *             supported += 1
 *         else:
 *             unsupported.append(claim)
 *
 *     faithfulness = supported / len(claims) if claims else 1.0
 *     return faithfulness, unsupported
 * ```
 */
export function calculateFaithfulness(
    generatedAnswer: string,
    contextDocuments: string[]
): FaithfulnessResult {
    const claims = extractClaims(generatedAnswer);

    if (claims.length === 0) {
        return {
            score: 1.0,
            totalClaims: 0,
            supportedClaims: 0,
            unsupportedClaims: [],
            hallucinationRate: 0
        };
    }

    const unsupportedClaims: string[] = [];
    let supportedCount = 0;

    for (const claim of claims) {
        if (isClaimSupported(claim, contextDocuments)) {
            supportedCount++;
        } else {
            unsupportedClaims.push(claim);
        }
    }

    const score = supportedCount / claims.length;

    return {
        score,
        totalClaims: claims.length,
        supportedClaims: supportedCount,
        unsupportedClaims,
        hallucinationRate: 1 - score
    };
}

/**
 * Calculate Answer Relevance score
 *
 * PSEUDOCODE:
 * ```
 * function calculateAnswerRelevance(question, answer):
 *     q_keywords = extractKeywords(question)
 *     a_keywords = extractKeywords(answer)
 *
 *     # Keyword coverage
 *     covered = intersection(q_keywords, a_keywords)
 *     keyword_score = len(covered) / len(q_keywords)
 *
 *     # Semantic similarity (simplified without embeddings)
 *     semantic_score = jaccardSimilarity(q_keywords, a_keywords)
 *
 *     # Combined score
 *     return 0.6 * semantic_score + 0.4 * keyword_score
 * ```
 */
export function calculateAnswerRelevance(
    question: string,
    answer: string
): AnswerRelevanceResult {
    const questionKeywords = extractKeywords(question);
    const answerKeywords = extractKeywords(answer);

    const questionSet = new Set(questionKeywords);
    const answerSet = new Set(answerKeywords);

    // Find covered and missed keywords
    const answeredKeywords = questionKeywords.filter(k => answerSet.has(k));
    const missedKeywords = questionKeywords.filter(k => !answerSet.has(k));

    // Keyword coverage
    const keywordCoverage = questionKeywords.length > 0
        ? answeredKeywords.length / questionKeywords.length
        : 1.0;

    // Semantic similarity (Jaccard as proxy without embeddings)
    const intersection = [...questionSet].filter(k => answerSet.has(k)).length;
    const union = new Set([...questionSet, ...answerSet]).size;
    const semanticSimilarity = union > 0 ? intersection / union : 0;

    // Combined score (weighted)
    const score = 0.6 * semanticSimilarity + 0.4 * keywordCoverage;

    return {
        score,
        semanticSimilarity,
        keywordCoverage,
        questionKeywords,
        answeredKeywords,
        missedKeywords
    };
}

/**
 * Calculate Context Precision score
 *
 * PSEUDOCODE:
 * ```
 * function calculateContextPrecision(question, documents, relevanceJudgments):
 *     precision_at_k = []
 *     relevant_count = 0
 *     cumulative_precision = 0
 *
 *     for i, doc in enumerate(documents):
 *         if isRelevant(doc, question):
 *             relevant_count += 1
 *             precision_at_i = relevant_count / (i + 1)
 *             cumulative_precision += precision_at_i
 *         precision_at_k.append(relevant_count / (i + 1))
 *
 *     # Average Precision
 *     AP = cumulative_precision / max(relevant_count, 1)
 *
 *     # NDCG calculation
 *     DCG = sum(relevance[i] / log2(i + 2) for i in range(len(docs)))
 *     IDCG = sum(1 / log2(i + 2) for i in range(relevant_count))
 *     NDCG = DCG / IDCG if IDCG > 0 else 0
 *
 *     return AP, precision_at_k, NDCG
 * ```
 */
export function calculateContextPrecision(
    question: string,
    documents: string[],
    relevanceScores?: number[]  // Optional explicit relevance judgments
): ContextPrecisionResult {
    const questionKeywords = new Set(extractKeywords(question));

    // Calculate relevance for each document
    const relevance = documents.map((doc, i) => {
        if (relevanceScores && relevanceScores[i] !== undefined) {
            return relevanceScores[i];
        }
        // Auto-judge relevance based on keyword overlap
        const docKeywords = extractKeywords(doc);
        const overlap = docKeywords.filter(k => questionKeywords.has(k)).length;
        return overlap >= 2 ? 1 : 0;  // Binary relevance
    });

    // Precision@K for each position
    const precisionAtK: number[] = [];
    let relevantCount = 0;
    let cumulativePrecision = 0;

    for (let i = 0; i < documents.length; i++) {
        if (relevance[i] > 0) {
            relevantCount++;
            cumulativePrecision += relevantCount / (i + 1);
        }
        precisionAtK.push(relevantCount / (i + 1));
    }

    // Average Precision
    const averagePrecision = relevantCount > 0
        ? cumulativePrecision / relevantCount
        : 0;

    // NDCG (Normalized Discounted Cumulative Gain)
    let dcg = 0;
    for (let i = 0; i < documents.length; i++) {
        dcg += relevance[i] / Math.log2(i + 2);
    }

    // Ideal DCG (all relevant docs at top)
    let idcg = 0;
    for (let i = 0; i < relevantCount; i++) {
        idcg += 1 / Math.log2(i + 2);
    }

    const ndcg = idcg > 0 ? dcg / idcg : 0;

    // Overall score (use NDCG as primary metric)
    const score = ndcg;

    return {
        score,
        precisionAtK,
        relevantDocs: relevantCount,
        totalDocs: documents.length,
        averagePrecision,
        ndcg
    };
}

/**
 * Calculate Context Recall score
 *
 * PSEUDOCODE:
 * ```
 * function calculateContextRecall(answer, context, groundTruth=None):
 *     sentences = splitSentences(answer)
 *     attributable = 0
 *     missing = []
 *
 *     for sentence in sentences:
 *         if canBeAttributedTo(sentence, context):
 *             attributable += 1
 *         else:
 *             missing.append(sentence)
 *
 *     recall = attributable / len(sentences) if sentences else 1.0
 *
 *     # If ground truth available
 *     if groundTruth:
 *         gt_recall = len(intersection(retrieved, groundTruth)) / len(groundTruth)
 *         return average(recall, gt_recall)
 *
 *     return recall
 * ```
 */
export function calculateContextRecall(
    generatedAnswer: string,
    contextDocuments: string[],
    groundTruthDocs?: string[]
): ContextRecallResult {
    // Split answer into sentences
    const sentences = generatedAnswer
        .split(/[.!?]+/)
        .map(s => s.trim())
        .filter(s => s.length > 10);

    if (sentences.length === 0) {
        return {
            score: 1.0,
            attributableSentences: 0,
            totalSentences: 0,
            missingInformation: []
        };
    }

    const missingInformation: string[] = [];
    let attributableCount = 0;

    // Check if each sentence can be attributed to context
    for (const sentence of sentences) {
        if (isClaimSupported(sentence, contextDocuments, 0.25)) {
            attributableCount++;
        } else {
            missingInformation.push(sentence);
        }
    }

    let score = attributableCount / sentences.length;

    // If ground truth is available, factor it in
    let groundTruthRecall: number | undefined;
    if (groundTruthDocs && groundTruthDocs.length > 0) {
        const contextSet = new Set(contextDocuments.map(d => d.toLowerCase().slice(0, 100)));
        const matchedGroundTruth = groundTruthDocs.filter(gt =>
            contextSet.has(gt.toLowerCase().slice(0, 100))
        ).length;
        groundTruthRecall = matchedGroundTruth / groundTruthDocs.length;

        // Average the two recall measures
        score = (score + groundTruthRecall) / 2;
    }

    return {
        score,
        attributableSentences: attributableCount,
        totalSentences: sentences.length,
        groundTruthRecall,
        missingInformation
    };
}

/**
 * Calculate combined RAG evaluation score
 *
 * PSEUDOCODE:
 * ```
 * function evaluateRAG(question, answer, context, groundTruth=None):
 *     F = calculateFaithfulness(answer, context)
 *     AR = calculateAnswerRelevance(question, answer)
 *     CP = calculateContextPrecision(question, context)
 *     CR = calculateContextRecall(answer, context, groundTruth)
 *
 *     # Harmonic mean (all metrics equally important)
 *     overall = 4 / (1/F + 1/AR + 1/CP + 1/CR)
 *
 *     # Weighted average (customizable)
 *     weights = {F: 0.3, AR: 0.25, CP: 0.2, CR: 0.25}
 *     weighted = sum(w * score for w, score in zip(weights, [F, AR, CP, CR]))
 *
 *     return {overall, weighted, F, AR, CP, CR}
 * ```
 */
export function evaluateRAG(
    question: string,
    generatedAnswer: string,
    contextDocuments: string[],
    options: {
        groundTruthDocs?: string[];
        relevanceScores?: number[];
        weights?: {
            faithfulness: number;
            answerRelevance: number;
            contextPrecision: number;
            contextRecall: number;
        };
    } = {}
): RAGEvaluationResult {
    const {
        groundTruthDocs,
        relevanceScores,
        weights = {
            faithfulness: 0.30,
            answerRelevance: 0.25,
            contextPrecision: 0.20,
            contextRecall: 0.25
        }
    } = options;

    // Calculate individual metrics
    const faithfulness = calculateFaithfulness(generatedAnswer, contextDocuments);
    const answerRelevance = calculateAnswerRelevance(question, generatedAnswer);
    const contextPrecision = calculateContextPrecision(question, contextDocuments, relevanceScores);
    const contextRecall = calculateContextRecall(generatedAnswer, contextDocuments, groundTruthDocs);

    // Harmonic mean (penalizes low scores heavily)
    const scores = [
        faithfulness.score,
        answerRelevance.score,
        contextPrecision.score,
        contextRecall.score
    ].filter(s => s > 0);

    const overallScore = scores.length === 4
        ? 4 / (1/faithfulness.score + 1/answerRelevance.score + 1/contextPrecision.score + 1/contextRecall.score)
        : scores.reduce((a, b) => a + b, 0) / scores.length;

    // Weighted average
    const weightedScore =
        weights.faithfulness * faithfulness.score +
        weights.answerRelevance * answerRelevance.score +
        weights.contextPrecision * contextPrecision.score +
        weights.contextRecall * contextRecall.score;

    return {
        faithfulness,
        answerRelevance,
        contextPrecision,
        contextRecall,
        overallScore,
        weightedScore
    };
}

/**
 * Evaluate RAG with Paper objects (convenience wrapper)
 */
export function evaluateRAGWithPapers(
    question: string,
    generatedAnswer: string,
    papers: Paper[],
    options?: {
        groundTruthDois?: string[];
        weights?: {
            faithfulness: number;
            answerRelevance: number;
            contextPrecision: number;
            contextRecall: number;
        };
    }
): RAGEvaluationResult {
    // Extract text context from papers
    const contextDocuments = papers.map(p =>
        `${p.title}. ${p.abstract || ''}`
    );

    // Map ground truth DOIs to paper texts if provided
    let groundTruthDocs: string[] | undefined;
    if (options?.groundTruthDois) {
        const doiSet = new Set(options.groundTruthDois.map(d => d.toLowerCase()));
        groundTruthDocs = papers
            .filter(p => p.doi && doiSet.has(p.doi.toLowerCase()))
            .map(p => `${p.title}. ${p.abstract || ''}`);
    }

    return evaluateRAG(question, generatedAnswer, contextDocuments, {
        groundTruthDocs,
        weights: options?.weights
    });
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Tokenize text into words
 */
function tokenize(text: string): string[] {
    return text
        .toLowerCase()
        .replace(/[^\w\s]/g, ' ')
        .split(/\s+/)
        .filter(t => t.length > 2);
}

/**
 * Extract keywords from text (removes stopwords)
 */
function extractKeywords(text: string): string[] {
    const stopwords = new Set([
        'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
        'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'been',
        'be', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would',
        'could', 'should', 'may', 'might', 'must', 'shall', 'can', 'need',
        'this', 'that', 'these', 'those', 'it', 'its', 'they', 'them', 'their',
        'what', 'which', 'who', 'whom', 'how', 'when', 'where', 'why',
        'all', 'each', 'every', 'both', 'few', 'more', 'most', 'other',
        'some', 'such', 'no', 'nor', 'not', 'only', 'own', 'same', 'so',
        'than', 'too', 'very', 'just', 'also', 'now', 'here', 'there'
    ]);

    return tokenize(text).filter(t => !stopwords.has(t) && t.length > 2);
}

/**
 * Aggregate RAG metrics across multiple evaluations
 */
export function aggregateRAGMetrics(results: RAGEvaluationResult[]): {
    avgFaithfulness: number;
    avgAnswerRelevance: number;
    avgContextPrecision: number;
    avgContextRecall: number;
    avgOverallScore: number;
    avgWeightedScore: number;
    totalEvaluations: number;
} {
    if (results.length === 0) {
        return {
            avgFaithfulness: 0,
            avgAnswerRelevance: 0,
            avgContextPrecision: 0,
            avgContextRecall: 0,
            avgOverallScore: 0,
            avgWeightedScore: 0,
            totalEvaluations: 0
        };
    }

    const avg = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;

    return {
        avgFaithfulness: avg(results.map(r => r.faithfulness.score)),
        avgAnswerRelevance: avg(results.map(r => r.answerRelevance.score)),
        avgContextPrecision: avg(results.map(r => r.contextPrecision.score)),
        avgContextRecall: avg(results.map(r => r.contextRecall.score)),
        avgOverallScore: avg(results.map(r => r.overallScore)),
        avgWeightedScore: avg(results.map(r => r.weightedScore)),
        totalEvaluations: results.length
    };
}
