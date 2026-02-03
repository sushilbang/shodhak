import OpenAI from 'openai';
import { pool } from '../config/database'
import { logger } from '../utils/logger';
import { Paper, PaperEmbedding } from '../models/database.models'

/*
This service bridges the gap between raw text and semantic search. When a user searches,
their query becomes a vector that's compared against all paper embeddings to find
conceptually similar research - even if they use different words than what appears in the papers.

Uses OpenAI text-embedding-3-small (1536 dimensions).
*/

class EmbeddingService {
    private openaiClient: OpenAI;
    private readonly dimensions: number = 1536;

    constructor() {
        if (!process.env.OPENAI_API_KEY) {
            throw new Error('OPENAI_API_KEY is required for embedding service. Set it in your .env file.');
        }

        this.openaiClient = new OpenAI({
            apiKey: process.env.OPENAI_API_KEY,
        });

        logger.info('Embedding service initialized with OpenAI text-embedding-3-small');
    }

    async generateEmbedding(text: string): Promise<number[]> {
        const response = await this.openaiClient.embeddings.create({
            model: 'text-embedding-3-small',
            input: text.slice(0, 8000),
        });

        return response.data[0].embedding;
    }

    async embedPaper(paper: Paper): Promise<PaperEmbedding | null> {
        if (!paper.id) {
            logger.error('Paper must have an ID to embed');
            return null;
        }

        const existing = await pool.query(
            'SELECT * FROM paper_embeddings WHERE paper_id = $1',
            [paper.id]
        );

        if (existing.rows.length > 0) {
            return {
                id: existing.rows[0].id,
                paper_id: existing.rows[0].paper_id,
                embedding: existing.rows[0].embedding,
                created_at: existing.rows[0].created_at,
            };
        }

        const textToEmbed = `${paper.title}\n\n${paper.abstract}`;
        const embedding = await this.generateEmbedding(textToEmbed);

        const result = await pool.query(
            `INSERT INTO paper_embeddings (paper_id, embedding)
            VALUES ($1, $2)
            RETURNING id, paper_id, embedding, created_at`,
            [paper.id, JSON.stringify(embedding)]
        );

        logger.info('Generated embedding for paper', {
            paperId: paper.id,
            title: paper.title,
            dimensions: this.dimensions,
        });

        return {
            id: result.rows[0].id,
            paper_id: result.rows[0].paper_id,
            embedding: result.rows[0].embedding,
            created_at: result.rows[0].created_at,
        };
    }

    async embedPapers(papers: Paper[]): Promise<PaperEmbedding[]> {
        const embeddings: PaperEmbedding[] = [];

        for (const paper of papers) {
            try {
                const embedding = await this.embedPaper(paper);
                if (embedding) {
                    embeddings.push(embedding);
                }
            } catch (error) {
                logger.error('Failed to embed paper', {
                    error,
                    paperId: paper.id,
                    title: paper.title,
                });
            }
        }

        return embeddings;
    }

    async searchSimilarPapers(
        query: string,
        limit: number = 10
    ): Promise<{ paper: Paper; score: number }[]> {
        const queryEmbedding = await this.generateEmbedding(query);
        const result = await pool.query(`
          SELECT p.*, pe.embedding
          FROM papers p
          JOIN paper_embeddings pe ON p.id = pe.paper_id
        `);

        const scored = result.rows.map((row) => {
            const paperEmbedding = typeof row.embedding === 'string'
                ? JSON.parse(row.embedding)
                : row.embedding;

            const score = this.cosineSimilarity(queryEmbedding, paperEmbedding);

            return {
                paper: {
                    id: row.id,
                    external_id: row.external_id,
                    title: row.title,
                    authors: row.authors,
                    abstract: row.abstract,
                    url: row.url,
                    doi: row.doi,
                    year: row.year,
                    venue: row.venue,
                    citation_count: row.citation_count,
                    source: row.source,
                    metadata: row.metadata,
                    created_at: row.created_at,
                } as Paper,
                score,
            };
        });
        return scored.sort((a, b) => b.score - a.score).slice(0, limit);
    }

    private cosineSimilarity(a: number[], b: number[]): number {
        if (a.length !== b.length) {
            logger.warn('Embedding dimension mismatch', { a: a.length, b: b.length });
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

        return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
    }

    async migrateEmbeddings(): Promise<void> {
        const result = await pool.query('SELECT COUNT(*) as count FROM paper_embeddings');
        const count = parseInt(result.rows[0].count, 10);

        if (count === 0) {
            logger.info('No embeddings to migrate');
            return;
        }

        // Check if any embedding has wrong dimensions
        const sample = await pool.query('SELECT embedding FROM paper_embeddings LIMIT 1');
        if (sample.rows.length > 0) {
            const embedding = typeof sample.rows[0].embedding === 'string'
                ? JSON.parse(sample.rows[0].embedding)
                : sample.rows[0].embedding;

            if (Array.isArray(embedding) && embedding.length !== this.dimensions) {
                logger.info('Embedding dimension mismatch detected, re-embedding all papers', {
                    currentDimensions: embedding.length,
                    targetDimensions: this.dimensions,
                });

                await pool.query('TRUNCATE paper_embeddings');

                const papers = await pool.query('SELECT * FROM papers');
                for (const row of papers.rows) {
                    const paper: Paper = {
                        id: row.id,
                        external_id: row.external_id,
                        title: row.title,
                        authors: row.authors,
                        abstract: row.abstract,
                        url: row.url,
                        doi: row.doi,
                        year: row.year,
                        venue: row.venue,
                        citation_count: row.citation_count,
                        source: row.source,
                        metadata: row.metadata,
                        created_at: row.created_at,
                    };
                    await this.embedPaper(paper);
                }

                logger.info('Embedding migration complete', { papersReEmbedded: papers.rows.length });
            } else {
                logger.info('Embeddings already at correct dimensions');
            }
        }
    }

    getProviderInfo(): { provider: string; model: string; dimensions: number } {
        return {
            provider: 'openai',
            model: 'text-embedding-3-small',
            dimensions: this.dimensions,
        };
    }
}

export const embeddingService = new EmbeddingService();
