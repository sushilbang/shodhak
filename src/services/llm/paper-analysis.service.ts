import { Paper } from '../../models/database.models';
import { LLMBaseService } from './llm-base';

export class PaperAnalysisService extends LLMBaseService {
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
