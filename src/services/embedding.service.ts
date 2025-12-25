import OpenAI from 'openai';
import axios from 'axios';
import { pool } from '../config/database'
import { logger } from '../utils/logger';
import { Paper, PaperEmbedding } from '../models/database.models'

/*
This service bridges the gap between raw text and semantic search. When a user searches,
their query becomes a vector that's compared against all paper embeddings to find
conceptually similar research - even if they use different words than what appears in the papers.

Supports two embedding providers:
- OpenAI: text-embedding-3-small (1536 dimensions)
- Ollama: nomic-embed-text or other local models (configurable dimensions)
*/

type EmbeddingProvider = 'openai' | 'ollama';

class EmbeddingService {
    private openaiClient?: OpenAI;
    private provider: EmbeddingProvider;
    private ollamaUrl: string;
    private ollamaModel: string;
    private dimensions: number = 768;

    constructor() {
        // Determine provider from env
        this.provider = (process.env.EMBEDDING_PROVIDER || 'openai') as EmbeddingProvider;
        this.ollamaUrl = process.env.OLLAMA_URL?.replace('/v1', '') || 'http://localhost:11434';
        this.ollamaModel = process.env.OLLAMA_EMBEDDING_MODEL || 'nomic-embed-text';

        if (this.provider === 'openai') {
            if (!process.env.OPENAI_API_KEY) {
                logger.warn('No OPENAI_API_KEY found, falling back to Ollama for embeddings');
                this.provider = 'ollama';
            } else {
                this.openaiClient = new OpenAI({
                    apiKey: process.env.OPENAI_API_KEY,
                });
                this.dimensions = 1536;
                logger.info('Embedding service using OpenAI');
            }
        }

        if (this.provider === 'ollama') {
            // nomic-embed-text produces 768 dimensions, adjust based on model
            this.dimensions = parseInt(process.env.OLLAMA_EMBEDDING_DIMENSIONS || '768', 10);
            logger.info('Embedding service using Ollama', {
                model: this.ollamaModel,
                dimensions: this.dimensions
            });
        }
    }

    // create vector embedding used for both paper abstracts and search queries
    async generateEmbedding(text: string): Promise<number[]> {
        if (this.provider === 'openai') {
            return this.generateOpenAIEmbedding(text);
        } else {
            return this.generateOllamaEmbedding(text);
        }
    }

    private async generateOpenAIEmbedding(text: string): Promise<number[]> {
        const response = await this.openaiClient!.embeddings.create({
            model: 'text-embedding-3-small',
            input: text.slice(0, 8000), // truncating to avoid token limits
        });

        return response.data[0].embedding;
    }

    private async generateOllamaEmbedding(text: string): Promise<number[]> {
        const response = await axios.post(`${this.ollamaUrl}/api/embeddings`, {
            model: this.ollamaModel,
            prompt: text.slice(0, 8000),
        });

        return response.data.embedding;
    }

    // embed a paper and store in database
    async embedPaper(paper: Paper): Promise<PaperEmbedding | null> {
        if (!paper.id) {
            logger.error('Paper must have an ID to embed');
            return null;
        }

        // check if embedding already exists
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

        // generate embedding from title + abstract
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
            provider: this.provider,
        });

        return {
            id: result.rows[0].id,
            paper_id: result.rows[0].paper_id,
            embedding: result.rows[0].embedding,
            created_at: result.rows[0].created_at,
        };
    }

    // batch embed multiple papers
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

    // find semantically similar papers
    async searchSimilarPapers(
        query: string,
        limit: number = 10
    ): Promise<{ paper: Paper; score: number }[]> {
        const queryEmbedding = await this.generateEmbedding(query);
        // use cosine similarity to find similar papers
        // PostgreSQL doesn't have native vector ops, so we compute in JS
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
        // sort by similarity score descending and return top results
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

    // Get current provider info
    getProviderInfo(): { provider: string; model: string; dimensions: number } {
        return {
            provider: this.provider,
            model: this.provider === 'openai' ? 'text-embedding-3-small' : this.ollamaModel,
            dimensions: this.dimensions,
        };
    }
}

export const embeddingService = new EmbeddingService();
