import { logger } from '../../utils/logger';
import { Paper, Citation } from '../../models/database.models';
import { LLMBaseService } from './llm-base';

export class LiteratureReviewService extends LLMBaseService {
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
}
