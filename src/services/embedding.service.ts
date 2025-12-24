import OpenAI from 'openai';
import { pool } from '../config/database'
import { logger } from '../utils/logger';
import { Paper, PaperEmbedding } from '../models/database.models'

/* 
This service bridges the gap between raw text and semantic search. When a user searches, their query becomes a vector that's compared against all paper embeddings to find conceptually similar research - even if they use different words than what appears in the papers.
*/

class EmbeddingService {
    private client: OpenAI;
    private readonly MODEL = 'text-embedding-3-small';
    private readonly DIMENSIONS = 1536;

    constructor () {
        this.client = new OpenAI({
            apiKey: process.env.OPENAI_API_KEY,
        });
    }

    // create vector embedding (1536-dimensional) used for both paper abstracts and search queries
    async generateEmbedding(text: string): Promise<number[]> {
        const response = await this.client.embeddings.create({
            model: this.MODEL,
            input: text.slice(0, 8000), // truncating to avoid token limits
        });

        return response.data[0].embedding;
    }

    // embed a paper and store in database
    async embedPaper(paper: Paper): Promise<PaperEmbedding | null> {
        if(!paper.id) {
            logger.error('Paper must have an ID to embed');
            return null;
        }

        // check if embedding already exists
        const existing = await pool.query(
            'SELECT * FROM paper_embeddings WHERE paper_id = $1',
            [paper.id]
        );

        if(existing.rows.length > 0) {
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

        for(const paper of papers) {
            try {
                const embedding = await this.embedPaper(paper);
                if(embedding) {
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
        limit: number=10
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
            const paperEmbedding = typeof row.embedding === 'string' ? JSON.stringify(row.embedding) : row.embedding;

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
        let dotProduct = 0;
        let normA = 0;
        let normB = 0;

        for(let i = 0; i < a.length; i++) {
            dotProduct += a[i] * b[i];
            normA += a[i] * a[i];
            normB += b[i] * b[i];
        }

        return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
    }
}

export const embeddingService = new EmbeddingService();