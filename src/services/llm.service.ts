import OpenAI from 'openai';
import { logger } from '../utils/logger';
import { Paper, Citation } from '../models/database.models';
import { createLLMClient, createReasoningClient, createFastClient, LLMProvider } from '../benchmark/utils/llm-client.factory';

class LLMService {
    private client: OpenAI;
    private readonly MODEL: string;
    private readonly MAX_TOKENS = 4096;
    private readonly provider: LLMProvider;

    // Dual-model support
    private reasoningClient: OpenAI;
    private readonly reasoningModel: string;
    private fastClient: OpenAI;
    private readonly fastModel: string;

    constructor() {
        const { client, model, provider } = createLLMClient();
        this.client = client;
        this.MODEL = model;
        this.provider = provider;

        const reasoning = createReasoningClient();
        this.reasoningClient = reasoning.client;
        this.reasoningModel = reasoning.model;

        const fast = createFastClient();
        this.fastClient = fast.client;
        this.fastModel = fast.model;

        logger.info('LLM service initialized', {
            provider,
            model,
            reasoningModel: this.reasoningModel,
            fastModel: this.fastModel
        });
    }

    // --- Simple tasks use fast model ---
    async refineQuery(userQuery: string): Promise<string> {
        const response = await this.fastClient.chat.completions.create({
            model: this.fastModel,
            max_tokens: 256,
            messages: [
                {
                    role: 'user',
                    content: `You are an academic research assistant. Convert this user query into a simple search query for Semantic Scholar API.

IMPORTANT RULES:
- Output 3-6 key terms separated by spaces
- NO boolean operators (no AND, OR, NOT)
- NO quotes or special characters
- NO parentheses
- Just simple keywords that capture the core topic

User query: "${userQuery}"

Respond with ONLY the simple keyword query, nothing else.`,
                },
            ],
        });

        const refinedQuery = response.choices[0]?.message?.content?.trim() || userQuery;
        logger.info('Refined query', { original: userQuery, refined: refinedQuery });
        return refinedQuery;
    }

    async generateClarifyingQuestions(userQuery: string): Promise<string[]> {
        const response = await this.fastClient.chat.completions.create({
            model: this.fastModel,
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
        const response = await this.fastClient.chat.completions.create({
            model: this.fastModel,
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

    // --- Complex tasks use reasoning model ---
    async generateLiteratureReview(
        papers: Paper[],
        query: string,
        paperContents?: Map<string, string>
    ): Promise<{ content: string; citations: Citation[] }> {
        // Delegate to enhanced version if content is available
        if (paperContents && paperContents.size > 0) {
            return this.generateEnhancedLiteratureReview(papers, query, paperContents);
        }

        const paperContext = papers
            .map((p, idx) => {
                return `[${idx + 1}] Title: ${p.title}
Authors: ${p.authors.map((a) => a.name).join(', ')}
Year: ${p.year || 'N/A'}
Venue: ${p.venue || 'N/A'}
Abstract: ${p.abstract}`;
            })
            .join('\n---\n');

        const response = await this.reasoningClient.chat.completions.create({
            model: this.reasoningModel,
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

    /**
     * Enhanced literature review generation with full paper content.
     * Provides richer context to the LLM and enforces citation grounding.
     */
    async generateEnhancedLiteratureReview(
        papers: Paper[],
        query: string,
        paperContents: Map<string, string>
    ): Promise<{ content: string; citations: Citation[] }> {
        const paperContext = papers
            .map((p, idx) => {
                const extendedContent = paperContents.get(p.external_id);
                const sourceUrl = p.url || (p.doi ? `https://doi.org/${p.doi}` : 'N/A');

                // Use extended content (truncated) or fall back to abstract
                const contentSection = extendedContent && extendedContent !== p.abstract
                    ? `Content (excerpt):\n${extendedContent.slice(0, 3000)}`
                    : `Abstract: ${p.abstract}`;

                return `[${idx + 1}] Title: ${p.title}
Authors: ${p.authors.map((a) => a.name).join(', ')}
Year: ${p.year || 'N/A'}
Venue: ${p.venue || 'N/A'}
URL: ${sourceUrl}
${contentSection}`;
            })
            .join('\n---\n');

        const response = await this.reasoningClient.chat.completions.create({
            model: this.reasoningModel,
            max_tokens: 8192,
            messages: [
                {
                    role: 'user',
                    content: `You are an academic research assistant writing a comprehensive literature review.

Research Topic: "${query}"

CITATION RULES (CRITICAL — follow these exactly):
- ONLY use [N] citations when restating a SPECIFIC finding, result, method, or conclusion from that paper.
- Do NOT cite for general background, well-known facts, or your own synthesis/commentary.
- Each citation must be DIRECTLY traceable to content in that paper's abstract or text below.
- Example of CORRECT citation: "Transformer models achieved 95% accuracy on the benchmark [3]." — specific result from paper [3].
- Example of INCORRECT citation: "Natural language processing has advanced rapidly in recent years [1][2][3]." — this is general knowledge, no citation needed.
- When you cite a paper, the claim in your sentence must appear in that paper's content below. If you cannot find the specific claim in the source, do not cite it.

WRITING GUIDELINES:
1. Write a THOROUGH and COMPREHENSIVE review — aim for at least 800-1200 words.
2. Organize by themes with clear section headings (##).
3. Provide broader context, background, and connections between topics WITHOUT citations — this is your synthesis.
4. Use citations ONLY for specific facts, numbers, methods, and findings from the sources.
5. After the review, include a "## References" section listing each paper as:
   [N] Authors (Year). "Title". Venue.

Available Papers:
${paperContext}

Write a comprehensive literature review that:
1. Introduces the research topic, its significance, and historical context (minimal citations — this is background)
2. Synthesizes findings across the papers, grouping by themes
3. Cites SPECIFIC results, methods, and conclusions from individual papers (with [N] format)
4. Identifies key trends, agreements, and contradictions
5. Critically analyzes strengths and limitations of existing work
6. Highlights research gaps and future directions (your analysis — no citations needed)

Write in academic style with clear section headings, detailed paragraphs, and thorough analysis. Be comprehensive — cover all major aspects of the topic.`,
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

        logger.info('Generated enhanced literature review', {
            query,
            paperCount: papers.length,
            contentLength: content.length,
            papersWithContent: paperContents.size,
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

        const response = await this.reasoningClient.chat.completions.create({
            model: this.reasoningModel,
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
                return `[${idx + 1}] "${p.title}"
Authors: ${p.authors.map(a => a.name).join(', ')}
Year: ${p.year || 'N/A'}
Venue: ${p.venue || 'N/A'}
Citations: ${p.citation_count || 0}
Abstract: ${p.abstract || 'No abstract available'}
---`;
            })
            .join('\n');

        const response = await this.reasoningClient.chat.completions.create({
            model: this.reasoningModel,
            max_tokens: 2048,
            messages: [
                {
                    role: 'system',
                    content: `You are an expert research assistant with access to a collection of academic papers. Your role is to provide accurate, well-informed answers based on the research papers provided. Always cite your sources using [1], [2], etc. Be specific and detailed in your responses.`,
                },
                {
                    role: 'user',
                    content: `I have collected ${papers.length} research papers on a topic. Here are the papers:

${paperContext}

Based on these papers, please answer the following question:
"${question}"

Instructions:
- Provide a comprehensive answer based on the paper contents
- Use inline citations [1], [2], etc. to reference specific papers
- If comparing findings across papers, note any agreements or disagreements
- If the papers don't contain enough information, clearly state what's missing
- Be specific about which paper supports each claim`,
                },
            ],
        });

        return response.choices[0]?.message?.content?.trim() || 'Unable to generate response.';
    }
}

export const llmService = new LLMService();
