import OpenAI from 'openai';
import { logger } from '../utils/logger';
import { Paper, Citation } from '../models/database.models';

class LLMService {
    private client: OpenAI;
    private readonly MODEL = process.env.OLLAMA_MODEL || 'llama3.2';
    private readonly MAX_TOKENS = 4096;

    constructor() {
        this.client = new OpenAI({
            baseURL: process.env.OLLAMA_URL || 'http://localhost:11434/v1',
            apiKey: 'ollama',
        });
    }

    async refineQuery(userQuery: string): Promise<string> {
        const response = await this.client.chat.completions.create({
            model: this.MODEL,
            max_tokens: 256,
            messages: [
                {
                    role: 'user',
                    content: `You are an academic research assistant. Convert this user query into an optimized search query for finding academic papers. Extract key concepts, add relevant synonyms, and structure it for academic databases.

User query: "${userQuery}"

Respond with ONLY the refined search query, nothing else.`,
                },
            ],
        });

        const refinedQuery = response.choices[0]?.message?.content?.trim() || userQuery;
        logger.info('Refined query', { original: userQuery, refined: refinedQuery });
        return refinedQuery;
    }

    async generateClarifyingQuestions(userQuery: string): Promise<string[]> {
        const response = await this.client.chat.completions.create({
            model: this.MODEL,
            max_tokens: 512,
            messages: [
                {
                    role: 'user',
                    content: `You are academic research assistant. The user wants to research: "${userQuery}"

Generate 3-4 clarifying questions to better understand their research need. Focus on:
- Specific aspects or subtopics they're interested in
- Time period or recency requirements
- Application domain or field
- Depth of coverage needed

Respond with ONLY the questions, one per line, numbered.`,
                },
            ],
        });

        const content = response.choices[0]?.message?.content || '';
        const questions = content
            .split('\n')
            .map((q) => q.replace(/^\d+\.\s*/, '').trim())
            .filter((q) => q.length > 0);

        return questions;
    }

    async summarizePaper(paper: Paper): Promise<string> {
        const response = await this.client.chat.completions.create({
            model: this.MODEL,
            max_tokens: 512,
            messages: [
                {
                    role: 'user',
                    content: `Summarize this academic paper in 2-3 sentences, focusing on the key contributions and findings:

Title: ${paper.title}
Authors: ${paper.authors.map((a) => a.name).join(', ')}
Year: ${paper.year || 'Unknown'}
Abstract: ${paper.abstract}

Provide a concise summary.`,
                },
            ],
        });

        return response.choices[0]?.message?.content?.trim() || '';
    }

    async generateLiteratureReview(
        papers: Paper[],
        query: string
    ): Promise<{ content: string; citations: Citation[] }> {
        const paperContext = papers
            .map((p, idx) => {
                return `[${idx + 1}] Title: ${p.title}
Authors: ${p.authors.map((a) => a.name).join(', ')}
Year: ${p.year || 'N/A'}
Venue: ${p.venue || 'N/A'}
Abstract: ${p.abstract}`;
            })
            .join('\n---\n');

        const response = await this.client.chat.completions.create({
            model: this.MODEL,
            max_tokens: this.MAX_TOKENS,
            messages: [
                {
                    role: 'user',
                    content: `You are an academic research assistant writing a literature review.

Research Topic: "${query}"

Available Papers:
${paperContext}

Write a comprehensive literature review that:
1. Introduces the research topic and its significance.
2. Synthesizes findings across the papers, grouping by themes
3. Identifies key trends, agreements, and contradictions
4. Highlight research gaps and future directions
5. Uses inline citations in the format [1], [2], etc.

Write in academic style with clear paragraphs. Include citations for all claims.`,
                },
            ],
        });

        const content = response.choices[0]?.message?.content?.trim() || '';

        const citations: Citation[] = papers.map((p, idx) => ({
            index: idx + 1,
            paper_id: p.id!,
            title: p.title,
            authors: p.authors.map((a) => a.name).join(', '),
            year: p.year,
            venue: p.venue,
        }));

        logger.info('Generated literature review', {
            query,
            paperCount: papers.length,
            contentLength: content.length,
        });

        return { content, citations };
    }

    async comparePapers(papers: Paper[]): Promise<string> {
        if (papers.length < 2) {
            return 'Need at least 2 papers to compare.';
        }

        const paperContext = papers
            .map((p, idx) => {
                return `Paper ${idx + 1}: ${p.title}
Authors: ${p.authors.map((a) => a.name).join(', ')}
Year: ${p.year || 'N/A'}
Abstract: ${p.abstract}`;
            })
            .join('\n--\n');

        const response = await this.client.chat.completions.create({
            model: this.MODEL,
            max_tokens: this.MAX_TOKENS,
            messages: [
                {
                    role: 'user',
                    content: `Compare and contrast these academic papers:

${paperContext}

Provide a structured comparison covering:
1. Research objectives and questions
2. Methodological approaches
3. Key findings and conclusions
4. Strengths and limitations of each
5. How they complement or contradict each other

Be specific and cite which paper you're referring to.`,
                },
            ],
        });

        return response.choices[0]?.message?.content?.trim() || '';
    }

    async answerQuestions(question: string, papers: Paper[]): Promise<string> {
        const paperContext = papers
            .map((p, idx) => {
                return `[${idx + 1}] ${p.title}
Abstract: ${p.abstract}`;
            })
            .join('\n');

        const response = await this.client.chat.completions.create({
            model: this.MODEL,
            max_tokens: 1024,
            messages: [
                {
                    role: 'user',
                    content: `Based on these research papers, answer the following question.

Papers:
${paperContext}

Question: ${question}

Provide a clear, well-cited answer using [1], [2], etc. to reference papers. If the papers don't contain enough information to answer, say so.`,
                },
            ],
        });

        return response.choices[0]?.message?.content?.trim() || '';
    }
}

export const llmService = new LLMService();
