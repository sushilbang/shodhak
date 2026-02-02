/**
 * Re-ranking Service
 *
 * Re-ranks search results using semantic similarity between
 * the query and paper content (title + abstract).
 */

import { embeddingService } from './embedding.service';
import { Paper } from '../models/database.models';
import { logger } from '../utils/logger';

interface RankedPaper {
    paper: Paper;
    originalRank: number;
    semanticScore: number;
    keywordScore: number;
    finalScore: number;
}

interface RerankingConfig {
    semanticWeight: number;    // Weight for semantic similarity (0-1)
    keywordWeight: number;     // Weight for keyword matching (0-1)
    positionDecay: number;     // How much to trust original ranking (0-1)
    boostRecentYears: number;  // Boost papers from last N years
    boostHighCitations: boolean;
}

const DEFAULT_CONFIG: RerankingConfig = {
    semanticWeight: 0.6,
    keywordWeight: 0.2,
    positionDecay: 0.2,
    boostRecentYears: 3,
    boostHighCitations: true
};

class RerankingService {
    private config: RerankingConfig;

    constructor(config: Partial<RerankingConfig> = {}) {
        this.config = { ...DEFAULT_CONFIG, ...config };
        logger.info('Reranking service initialized', { config: this.config });
    }

    /**
     * Re-rank papers based on semantic similarity to query
     */
    async rerankPapers(
        query: string,
        papers: Paper[],
        config?: Partial<RerankingConfig>
    ): Promise<RankedPaper[]> {
        if (papers.length === 0) return [];

        const cfg = { ...this.config, ...config };
        const startTime = Date.now();

        try {
            // Get query embedding
            const queryEmbedding = await embeddingService.generateEmbedding(query);

            // Score each paper
            const rankedPapers: RankedPaper[] = await Promise.all(
                papers.map(async (paper, index) => {
                    // Semantic score
                    const paperText = `${paper.title}\n${paper.abstract || ''}`;
                    const paperEmbedding = await embeddingService.generateEmbedding(paperText);
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
                    const finalScore =
                        (semanticScore * cfg.semanticWeight) +
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
                })
            );

            // Sort by final score (descending)
            rankedPapers.sort((a, b) => b.finalScore - a.finalScore);

            // Log reranking stats
            const reorderCount = rankedPapers.filter(
                (p, i) => p.originalRank !== i + 1
            ).length;

            logger.info('Papers reranked', {
                totalPapers: papers.length,
                reorderedCount: reorderCount,
                latencyMs: Date.now() - startTime
            });

            return rankedPapers;

        } catch (error) {
            logger.error('Reranking failed', { error });
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
    private calculateKeywordScore(query: string, paper: Paper): number {
        const queryTerms = this.tokenize(query);
        const paperTerms = this.tokenize(`${paper.title} ${paper.abstract || ''}`);

        if (queryTerms.length === 0) return 0;

        const matches = queryTerms.filter(term => paperTerms.includes(term));
        return matches.length / queryTerms.length;
    }

    /**
     * Simple tokenization
     */
    private tokenize(text: string): string[] {
        return text
            .toLowerCase()
            .replace(/[^\w\s]/g, ' ')
            .split(/\s+/)
            .filter(t => t.length > 2);
    }

    /**
     * Cosine similarity between two vectors
     */
    private cosineSimilarity(a: number[], b: number[]): number {
        if (a.length !== b.length) {
            logger.warn('Embedding dimension mismatch in reranking');
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
    updateConfig(config: Partial<RerankingConfig>): void {
        this.config = { ...this.config, ...config };
        logger.info('Reranking config updated', { config: this.config });
    }

    /**
     * Get current configuration
     */
    getConfig(): RerankingConfig {
        return { ...this.config };
    }
}

export const rerankingService = new RerankingService();
export type { RankedPaper, RerankingConfig };
