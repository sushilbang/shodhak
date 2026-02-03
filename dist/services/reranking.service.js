"use strict";
/**
 * Re-ranking Service
 *
 * Re-ranks search results using semantic similarity between
 * the query and paper content (title + abstract).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.rerankingService = void 0;
const embedding_service_1 = require("./embedding.service");
const logger_1 = require("../utils/logger");
const DEFAULT_CONFIG = {
    semanticWeight: 0.6,
    keywordWeight: 0.2,
    positionDecay: 0.2,
    boostRecentYears: 3,
    boostHighCitations: true
};
class RerankingService {
    constructor(config = {}) {
        this.config = { ...DEFAULT_CONFIG, ...config };
        logger_1.logger.info('Reranking service initialized', { config: this.config });
    }
    /**
     * Re-rank papers based on semantic similarity to query
     */
    async rerankPapers(query, papers, config) {
        if (papers.length === 0)
            return [];
        const cfg = { ...this.config, ...config };
        const startTime = Date.now();
        try {
            // Get query embedding
            const queryEmbedding = await embedding_service_1.embeddingService.generateEmbedding(query);
            // Score each paper
            const rankedPapers = await Promise.all(papers.map(async (paper, index) => {
                // Semantic score
                const paperText = `${paper.title}\n${paper.abstract || ''}`;
                const paperEmbedding = await embedding_service_1.embeddingService.generateEmbedding(paperText);
                const semanticScore = this.cosineSimilarity(queryEmbedding, paperEmbedding);
                // Keyword score
                const keywordScore = this.calculateKeywordScore(query, paper);
                // Position score (trust original ranking somewhat)
                const positionScore = 1 - (index / papers.length);
                // Year boost
                const currentYear = new Date().getFullYear();
                const yearBoost = paper.year && (currentYear - paper.year <= cfg.boostRecentYears)
                    ? 0.1
                    : 0;
                // Citation boost (log scale)
                const citationBoost = cfg.boostHighCitations && paper.citation_count
                    ? Math.min(0.1, Math.log10(paper.citation_count + 1) / 50)
                    : 0;
                // Combined score
                const finalScore = (semanticScore * cfg.semanticWeight) +
                    (keywordScore * cfg.keywordWeight) +
                    (positionScore * cfg.positionDecay) +
                    yearBoost +
                    citationBoost;
                return {
                    paper,
                    originalRank: index + 1,
                    semanticScore,
                    keywordScore,
                    finalScore
                };
            }));
            // Sort by final score (descending)
            rankedPapers.sort((a, b) => b.finalScore - a.finalScore);
            // Log reranking stats
            const reorderCount = rankedPapers.filter((p, i) => p.originalRank !== i + 1).length;
            logger_1.logger.info('Papers reranked', {
                totalPapers: papers.length,
                reorderedCount: reorderCount,
                latencyMs: Date.now() - startTime
            });
            return rankedPapers;
        }
        catch (error) {
            logger_1.logger.error('Reranking failed', { error });
            // Return papers in original order on failure
            return papers.map((paper, index) => ({
                paper,
                originalRank: index + 1,
                semanticScore: 0,
                keywordScore: 0,
                finalScore: 1 - (index / papers.length)
            }));
        }
    }
    /**
     * Calculate keyword overlap score
     */
    calculateKeywordScore(query, paper) {
        const queryTerms = this.tokenize(query);
        const paperTerms = this.tokenize(`${paper.title} ${paper.abstract || ''}`);
        if (queryTerms.length === 0)
            return 0;
        const matches = queryTerms.filter(term => paperTerms.includes(term));
        return matches.length / queryTerms.length;
    }
    /**
     * Simple tokenization
     */
    tokenize(text) {
        return text
            .toLowerCase()
            .replace(/[^\w\s]/g, ' ')
            .split(/\s+/)
            .filter(t => t.length > 2);
    }
    /**
     * Cosine similarity between two vectors
     */
    cosineSimilarity(a, b) {
        if (a.length !== b.length) {
            logger_1.logger.warn('Embedding dimension mismatch in reranking');
            return 0;
        }
        let dotProduct = 0;
        let normA = 0;
        let normB = 0;
        for (let i = 0; i < a.length; i++) {
            dotProduct += a[i] * b[i];
            normA += a[i] * a[i];
            normB += b[i] * b[i];
        }
        const denominator = Math.sqrt(normA) * Math.sqrt(normB);
        return denominator === 0 ? 0 : dotProduct / denominator;
    }
    /**
     * Update configuration
     */
    updateConfig(config) {
        this.config = { ...this.config, ...config };
        logger_1.logger.info('Reranking config updated', { config: this.config });
    }
    /**
     * Get current configuration
     */
    getConfig() {
        return { ...this.config };
    }
}
exports.rerankingService = new RerankingService();
