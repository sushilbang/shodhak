import axios, { AxiosInstance } from 'axios';
import { pool } from '../config/database';
import { logger } from '../utils/logger';
import { Paper, SemanticScholarPaper, SemanticScholarSearchResponse } from '../models/database.models';

class SearchService {
    private client: AxiosInstance;
    private readonly BASE_URL = 'https://api.semanticscholar.org/graph/v1';
    private readonly FIELDS = 'paperId,title,authors,abstract,url,doi,year,venue,citationCount';

    constructor() {
        this.client = axios.create({
            baseURL: this.BASE_URL,
            timeout: 10000,
            headers: {
                'Content-Type': 'application/json',
            },
        });
    }
    // normalize semantic scholar response to internal Paper model
    private normalizePaper(ssPaper: SemanticScholarPaper): Paper {
        return {
            external_id: ssPaper.paperId,
            title: ssPaper.title,
            authors: ssPaper.authors.map((a) => ({
                name: a.name,
                authorId: a.authorId,
            })),
            abstract: ssPaper.abstract || '',
            url: ssPaper.url,
            doi: ssPaper.doi,
            year: ssPaper.year,
            venue: ssPaper.venue,
            citation_count: ssPaper.citationCount,
            source: 'semantic_scholar',
        };
    }
    // save paper to database if it does not exists
    async savePaperIfNotExists(paper: Paper): Promise<number> {
        const existing = await pool.query(
            'SELECT id FROM papers WHERE external_id = $1',
            [paper.external_id]
        );

        if(existing.rows.length > 0) {
            return existing.rows[0].id;
        }

        const result = await pool.query(
            `INSERT INTO papers (external_id, title, authors, abstract, url, doi, year, venue, citation_count, source, metadata)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
            RETURNING id`,
            [
                paper.external_id,
                paper.title,
                JSON.stringify(paper.authors),
                paper.abstract,
                paper.url,
                paper.doi,
                paper.year,
                paper.venue,
                paper.citation_count,
                paper.source,
                JSON.stringify(paper.metadata || {}),
            ]
        );

        logger.info('Saved new paper', {
            id: result.rows[0].id, title: paper.title
        });

        return result.rows[0].id;
    }
    // get paper details by id
    async getPaperDetails(paperId: string): Promise<Paper | null> {
        try {
            const response = await this.client.get<SemanticScholarPaper>(
                `/paper/${paperId}`,
                {
                    params: { fields: this.FIELDS },
                }
            );

            const paper = this.normalizePaper(response.data);
            await this.savePaperIfNotExists(paper);

            return paper;
        } catch (error) {
            logger.error('Failed to get paper details', {
                error, paperId
            });

            return null;
        }
    }
    // get paper from database by external ID
    async getPaperByExternalId(external_id: string): Promise<Paper | null> {
        const result = await pool.query(
            'SELECT * FROM papers WHERE external_id = $1',
            [external_id]
        );

        if(result.rows.length === 0) return null;

        const row = result.rows[0];

        return {
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
    }
    // search papers from semantic scholar
    async searchPapers(query: string, limit: number=10): Promise<Paper[]> {
        try {
            const response = await this.client.get<SemanticScholarSearchResponse>(
                'paper/search',
                {
                    params: {
                        query,
                        limit,
                        fields: this.FIELDS,
                    },
                }
            );

            const papers = response.data.data.map((p) => this.normalizePaper(p));
            //cache papers in database
            for(const paper of papers) {
                await this.savePaperIfNotExists(paper);
            }

            return papers;
        } catch (error) {
            logger.error('Semantic Scholar search failed', {
                error, query
            });

            throw error;
        }
    } 
}
export const searchService = new SearchService();