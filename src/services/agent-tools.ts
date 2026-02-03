import { ToolDefinition, ToolResult, AgentContext } from "../types/agent.types";
import { searchService } from './search.service';
import { enhancedSearchService } from "./enhanced-search.service";
import { embeddingService } from "./embedding.service";
import { llmService } from "./llm.service";
import { knowledgeService } from "./knowledge.service";
import { contextManager } from "./agent-context";
import { Paper } from "../models/database.models";
import { logger } from '../utils/logger';

// All tool definitions
export const AGENT_TOOLS: ToolDefinition[] = [
    // search tools
    {
        type: 'function',
        function: {
            name: 'search_papers',
            description: 'Search academic databases for research papers matching a query. Returns papers with titles, authors, abstracts, and metadata.',
            parameters: {
                type: 'object',
                properties: {
                    query: {
                        type: 'string',
                        description: 'The search query for finding relevant papers'
                    },
                    limit: {
                        type: 'number',
                        description: 'Maximum number of papers to return (default: 10, max: 20)'
                    }
                },
                required: ['query']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'lookup_paper_by_doi',
            description: 'Loop up a specific paper by its DOI (Digital Object Identifier).',
            parameters: {
                type: 'object',
                properties: {
                    doi: {
                        type: 'string',
                        description: 'The DOI of the paper to look up'
                    }
                },
                required: ['doi']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'search_similar_papers',
            description: 'Find papers semantically similar to a query using embeddings. Good for finding related work',
            parameters: {
                type: 'object',
                properties: {   
                    query: {
                        type: 'string',
                        description: 'Natural language description of the papers you want to find' 
                    },
                    limit: {
                        type: 'number',
                        description: 'Maximum number of similar papers to return (default: 10)'
                    }
                },
                required: ['query']
            }
        }
    },
    // Analysis tools
    {
        type: 'function',
        function: {
            name: 'summarize_paper',
            description: 'Generate a concise summary of a specific paper from the current context.',
            parameters: {
                type: 'object',
                properties: {
                    paper_index: {
                        type: 'number',
                        description: 'Index of the paper in the current context (0-based)'
                    }
                },
                required: ['paper_index']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'compare_papers',
            description: 'Compare and contrast multiple papers, analyzing their methodologies, findings, and relationships',
            parameters: {
                type: 'object',
                properties: {
                    paper_indices: {
                        type: 'array',
                        items: { type: 'number' },
                        description: 'Indices of papers to compare (at least 2 required)'
                    }
                },
                required: ['paper_indices']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'generate_literature_review',
            description: 'Generate a comprehensive literature review synthesizing papers around a research topic.',
            parameters: {
                type: 'object',
                properties: {
                    focus_topic: {
                        type: 'string',
                        description: 'Specific topic or angle to focus the review on'
                    },
                    paper_indices: {
                        type: 'array',
                        items: { type: 'number' },
                        description: 'Indices of papers to include (optional, defaults to all)'
                    }
                },
                required: []
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'answer_question',
            description: 'Answer a specific resesarch question based on the collected papers with citations.',
            parameters: {
                type: 'object',
                properties: {
                    question: {
                        type: 'string',
                        description: 'The question to answer based on the papers'
                    },
                    paper_indices: {
                        type: 'array',
                        items: { type: 'number' },
                        description: 'Indices of papers to use for answering (optional, defaults to all)'
                    }
                },
                required: ['question']
            }
        }
    },
    // Knowledge tools
    {
        type: 'function',
        function: {
            name: 'save_annotation',
            description: 'Save a note or annotation about a paper to the user knowledge base.',
            parameters: {
                type: 'object',
                properties: {
                    paper_index: {
                        type: 'number',
                        description: 'Index of the paper to annotate'
                    },
                    content: {
                        type: 'string',
                        description: 'The annotation or note content'
                    },
                    note_type: {
                        type: 'string',
                        enum: ['annotation', 'summary', 'highlight'],
                        description: 'Type of note (default: annotation)'
                    }
                },
                required: ['paper_index', 'content']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'search_user_knowledge',
            description: 'Search through the user save annotations and notes from previous research.',
            parameters: {
                type: 'object',
                properties: {
                    query: {
                        type: 'string',
                        description: 'Search query for finding relevant notes'
                    },
                    limit: {
                        type: 'number',
                        description: 'Maximum number of results (default: 10)'
                    }
                },
                required: ['query']
            }
        }
    },
    // Context tools
    {
        type: 'function',
        function: {
            name: 'get_current_papers',
            description: 'Get the list of papers currently in context with their indices.',
            parameters: {
                type: 'object',
                properties: {},
                required: []
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'clear_papers',
            description: 'Clean all papers from the current context to start fresh.',
            parameters: {
                type: 'object',
                properties: {},
                required: []
            }
        }
    }
];

export class ToolExecutor {
    async execute(
        toolName: string,
        args: Record<string, any>,
        context: AgentContext
    ): Promise<ToolResult> {
        logger.info('Executing tool', { toolName, args, sessionId: context.sessionId });

        try {
            switch(toolName) {
                case 'search_papers':
                    return this.searchPapers(args as { query: string; limit?: number }, context);
                case 'lookup_paper_by_doi':
                    return this.lookupByDoi(args as { doi: string }, context);
                case 'search_similar_papers':
                    return this.searchSimilar(args as { query: string; limit?: number }, context);
                case 'summarize_paper':
                    return this.summarizePaper(args as { paper_index: number }, context);
                case 'compare_papers':
                    return this.comparePapers(args as { paper_indices: number[] }, context);
                case 'generate_literature_review':
                    return this.generateLiteratureReview(args as { focus_topic?: string; paper_indices?: number[] }, context);
                case 'answer_question':
                    return this.answerQuestion(args as { question: string; paper_indices?: number[] }, context);
                case 'save_annotation':
                    return this.saveAnnotation(args as { paper_index: number; content: string; note_type?: string }, context);
                case 'search_user_knowledge':
                    return this.searchUserKnowledge(args as { query: string; limit?: number }, context);
                case 'get_current_papers':
                    return this.getCurrentPapers(context);
                case 'clear_papers':
                    return this.clearPapers(context);
                default:
                    return { success: false, error: `Unknown tool: ${toolName}` };
            }
        } catch (error) {
            logger.error('Tool execution failed', { toolName, error });
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Tool execution failed'
            };
        }
    }

    private async searchPapers(
        args: { query: string, limit?: number },
        context: AgentContext
    ): Promise<ToolResult> {
        const limit = Math.min(args.limit || 10, 20);

        // Use enhanced search with multi-provider (OpenAlex + Semantic Scholar)
        const result = await enhancedSearchService.search(args.query, {
            limit,
            useExpansion: true,
            useReranking: true,
            multiProvider: true,
            deduplicateByDoi: true,
        });

        const papers = result.papers;

        // add papers to context (avoid duplicates by external_id)
        const existingIds = new Set(context.papers.map(p => p.external_id));
        const newPapers = papers.filter(p => !existingIds.has(p.external_id));
        context.papers.push(...newPapers);
        context.metadata.searchCount++;

        // Persist papers to session
        for (const p of newPapers) {
            if (p.id) {
                await contextManager.addPaperToSession(context, p.id);
            }
        }

        return {
            success: true,
            data: {
                newPapersFound: newPapers.length,
                totalPapersInContext: context.papers.length,
                searchMetadata: {
                    providers: 'openalex + semantic_scholar',
                    totalFound: result.metadata.totalFound,
                    deduplicated: result.metadata.deduplicated,
                    reranked: result.metadata.reranked,
                    queryVariants: result.metadata.queryVariants,
                },
                papers: papers.map((p) => ({
                    index: context.papers.findIndex(cp => cp.external_id === p.external_id),
                    title: p.title,
                    authors: p.authors.map(a => a.name).join(', '),
                    year: p.year,
                    abstractPreview: p.abstract?.slice(0, 200) + '...'
                }))
            }
        };
    }

    private async lookupByDoi(
        args: { doi: string },
        context: AgentContext
    ): Promise<ToolResult> {
        const paper = await searchService.lookupByDoi(args.doi);
        if(!paper) {
            return {
                success: false,
                error: `No paper found with DOI: ${args.doi}`
            };
        }
    
        // add to context if new
        const existingIdx = context.papers.findIndex(p => p.external_id === paper.external_id);
        if(existingIdx === -1) {
            context.papers.push(paper);
            if (paper.id) {
                await contextManager.addPaperToSession(context, paper.id);
            }
        }

        const index = existingIdx === -1 ? context.papers.length - 1 : existingIdx;

        return {
            success: true,
            data: {
                index,
                title: paper.title,
                authors: paper.authors.map(a => a.name).join(', '),
                year: paper.year,
                abstract: paper.abstract,
                venue: paper.venue,
                citationCount: paper.citation_count
            }
        };
    }

    private async searchSimilar(
        args: { query: string, limit?: number },
        context: AgentContext
    ): Promise<ToolResult> {
        const limit = args.limit || 10;
        const results = await embeddingService.searchSimilarPapers(args.query, limit);

        // add to context
        const existingIds = new Set(context.papers.map(p => p.external_id));

        const newPapers = results.filter(r => !existingIds.has(r.paper.external_id)).map(r => r.paper);
        context.papers.push(...newPapers);

        // Persist papers to session
        for (const p of newPapers) {
            if (p.id) {
                await contextManager.addPaperToSession(context, p.id);
            }
        }

        return {
            success: true,
            data: {
                newPapersFound: newPapers.length,
                totalPapersInContext: context.papers.length,
                results: results.map(r => ({
                    index: context.papers.findIndex(p => p.external_id === r.paper.external_id),
                    title: r.paper.title,
                    authors: r.paper.authors.map(a => a.name).join(', '),
                    similarityScore: r.score.toFixed(3)
                }))
            }
        };
    }

    private async summarizePaper(
        args: { paper_index: number },
        context: AgentContext
    ): Promise<ToolResult> {
        const paper = context.papers[args.paper_index];
        if(!paper) {
            return {
                success: false,
                error: `Invalid paper index: ${args.paper_index}`
            };
        }
        const summary = await llmService.summarizePaper(paper);
        context.metadata.analysisCount++;

        return {
            success: true,
            data: {
                paperTitle: paper.title,
                summary
            }
        };
    }

    private async comparePapers(
        args: { paper_indices: number[] },
        context: AgentContext
    ): Promise<ToolResult> {
        if(args.paper_indices.length < 2) {
            return {
                success: false,
                error: 'Need at least 2 papers to compare'
            };
        }

        const papers: Paper[] = [];
        for(const idx of args.paper_indices) {
            const paper = context.papers[idx];
            if(!paper) {
                return {
                    success: false,
                    error: `Invalid paper index: ${idx}`
                };
            }
            papers.push(paper);
        }
        const comparison = await llmService.comparePapers(papers);
        context.metadata.analysisCount++;

        return {
            success: true,
            data: {
                comparedPapers: papers.map((p, i) => ({
                    index: args.paper_indices[i], title: p.title
                })),
                comparison
            }
        };
    }

    private async generateLiteratureReview(
        args: { focus_topic?: string; paper_indices?: number[] },
        context: AgentContext
    ): Promise<ToolResult> {
        let papers: Paper[];

        if(args.paper_indices && args.paper_indices.length > 0) {
            papers = args.paper_indices.map(idx => context.papers[idx]).filter(Boolean);
        } else {
            papers = context.papers;
        }

        if(papers.length === 0) {
            return {
                success: false,
                error: 'No papers available for literature review'
            };
        }

        const topic = args.focus_topic || 'the research topic';
        const result = await llmService.generateLiteratureReview(papers, topic);
        context.metadata.analysisCount++;

        return {
            success: true,
            data: {
                papersIncluded: papers.length,
                content: result.content,
                citations: result.citations
            }
        };
    }

    private async answerQuestion(
        args: { question: string; paper_indices?: number[] },
        context: AgentContext
    ): Promise<ToolResult> {
        let papers: Paper[];

        if(args.paper_indices && args.paper_indices.length > 0) {
            papers = args.paper_indices.map(idx => context.papers[idx]).filter(Boolean);
        } else {
            papers = context.papers;
        }

        if(papers.length === 0) {
            return {
                success: false,
                error: 'No papers available to answer the question'
            };
        }

        const answer = await llmService.answerQuestions(args.question, papers);
        context.metadata.analysisCount++;

        return {
            success: true,
            data: {
                question: args.question,
                answer,
                papersUsed: papers.length
            }
        };
    }

    private async saveAnnotation(
        args: { paper_index: number; content: string; note_type?: string },
        context: AgentContext
    ): Promise<ToolResult> {
        const paper = context.papers[args.paper_index];
        if(!paper || !paper.id) {
            return {
                success: false,
                error: `Invalid paper index or paper not saved: ${args.paper_index}`
            };
        }

        const noteType = (args.note_type || 'annotation') as 'annotation' | 'summary' | 'highlight';
        const annotation = await knowledgeService.addAnnotation(
            context.userId,
            paper.id,
            args.content,
            noteType
        );

        return {
            success: true,
            data: {
                annotationId: annotation.id,
                paperTitle: paper.title,
                noteType
            }
        };
    }

    private async searchUserKnowledge (
        args: { query: string; limit?: number },
        context: AgentContext
    ): Promise<ToolResult> {
        const limit = args.limit || 10;
        const results = await knowledgeService.searchUserKnowledge(
            context.userId,
            args.query,
            limit
        );

        return {
            success: true,
            data: {
                resultsFound: results.length,
                notes: results.map(r => ({
                    content: r.knowledge.content,
                    noteType: r.knowledge.note_type,
                    relevanceScore: r.score.toFixed(3),
                    paperId: r.knowledge.paper_id
                }))
            }
        };
    }

    private getCurrentPapers(context: AgentContext): ToolResult {
        return {
            success: true,
            data: {
                totalPapers: context.papers.length,
                papers: context.papers.map((p, idx) => ({
                    index: idx,
                    title: p.title,
                    authors: p.authors.map(a => a.name).join(', '),
                    year: p.year,
                    doi: p.doi
                }))
            }
        };
    }

    private clearPapers(context: AgentContext): ToolResult {
        const clearedCount = context.papers.length;
        context.papers = [];

        return {
            success: true,
            data: {
                message: `Cleared ${clearedCount} papers from context`
            }
        };
    }
}
export const toolExecutor = new ToolExecutor();