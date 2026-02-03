"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.toolExecutor = exports.ToolExecutor = exports.AGENT_TOOLS = void 0;
const search_service_1 = require("./search.service");
const embedding_service_1 = require("./embedding.service");
const llm_service_1 = require("./llm.service");
const knowledge_service_1 = require("./knowledge.service");
const agent_context_1 = require("./agent-context");
const logger_1 = require("../utils/logger");
// All tool definitions
exports.AGENT_TOOLS = [
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
class ToolExecutor {
    async execute(toolName, args, context) {
        logger_1.logger.info('Executing tool', { toolName, args, sessionId: context.sessionId });
        try {
            switch (toolName) {
                case 'search_papers':
                    return this.searchPapers(args, context);
                case 'lookup_paper_by_doi':
                    return this.lookupByDoi(args, context);
                case 'search_similar_papers':
                    return this.searchSimilar(args, context);
                case 'summarize_paper':
                    return this.summarizePaper(args, context);
                case 'compare_papers':
                    return this.comparePapers(args, context);
                case 'generate_literature_review':
                    return this.generateLiteratureReview(args, context);
                case 'answer_question':
                    return this.answerQuestion(args, context);
                case 'save_annotation':
                    return this.saveAnnotation(args, context);
                case 'search_user_knowledge':
                    return this.searchUserKnowledge(args, context);
                case 'get_current_papers':
                    return this.getCurrentPapers(context);
                case 'clear_papers':
                    return this.clearPapers(context);
                default:
                    return { success: false, error: `Unknown tool: ${toolName}` };
            }
        }
        catch (error) {
            logger_1.logger.error('Tool execution failed', { toolName, error });
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Tool execution failed'
            };
        }
    }
    async searchPapers(args, context) {
        const limit = Math.min(args.limit || 10, 20);
        const papers = await search_service_1.searchService.searchPapers(args.query, limit);
        // add papers to context (avoid duplicates by external_id)
        const existingIds = new Set(context.papers.map(p => p.external_id));
        const newPapers = papers.filter(p => !existingIds.has(p.external_id));
        context.papers.push(...newPapers);
        context.metadata.searchCount++;
        // Persist papers to session
        for (const p of newPapers) {
            if (p.id) {
                await agent_context_1.contextManager.addPaperToSession(context, p.id);
            }
        }
        return {
            success: true,
            data: {
                newPapersFound: newPapers.length,
                totalPapersInContext: context.papers.length,
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
    async lookupByDoi(args, context) {
        const paper = await search_service_1.searchService.lookupByDoi(args.doi);
        if (!paper) {
            return {
                success: false,
                error: `No paper found with DOI: ${args.doi}`
            };
        }
        // add to context if new
        const existingIdx = context.papers.findIndex(p => p.external_id === paper.external_id);
        if (existingIdx === -1) {
            context.papers.push(paper);
            if (paper.id) {
                await agent_context_1.contextManager.addPaperToSession(context, paper.id);
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
    async searchSimilar(args, context) {
        const limit = args.limit || 10;
        const results = await embedding_service_1.embeddingService.searchSimilarPapers(args.query, limit);
        // add to context
        const existingIds = new Set(context.papers.map(p => p.external_id));
        const newPapers = results.filter(r => !existingIds.has(r.paper.external_id)).map(r => r.paper);
        context.papers.push(...newPapers);
        // Persist papers to session
        for (const p of newPapers) {
            if (p.id) {
                await agent_context_1.contextManager.addPaperToSession(context, p.id);
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
    async summarizePaper(args, context) {
        const paper = context.papers[args.paper_index];
        if (!paper) {
            return {
                success: false,
                error: `Invalid paper index: ${args.paper_index}`
            };
        }
        const summary = await llm_service_1.llmService.summarizePaper(paper);
        context.metadata.analysisCount++;
        return {
            success: true,
            data: {
                paperTitle: paper.title,
                summary
            }
        };
    }
    async comparePapers(args, context) {
        if (args.paper_indices.length < 2) {
            return {
                success: false,
                error: 'Need at least 2 papers to compare'
            };
        }
        const papers = [];
        for (const idx of args.paper_indices) {
            const paper = context.papers[idx];
            if (!paper) {
                return {
                    success: false,
                    error: `Invalid paper index: ${idx}`
                };
            }
            papers.push(paper);
        }
        const comparison = await llm_service_1.llmService.comparePapers(papers);
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
    async generateLiteratureReview(args, context) {
        let papers;
        if (args.paper_indices && args.paper_indices.length > 0) {
            papers = args.paper_indices.map(idx => context.papers[idx]).filter(Boolean);
        }
        else {
            papers = context.papers;
        }
        if (papers.length === 0) {
            return {
                success: false,
                error: 'No papers available for literature review'
            };
        }
        const topic = args.focus_topic || 'the research topic';
        const result = await llm_service_1.llmService.generateLiteratureReview(papers, topic);
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
    async answerQuestion(args, context) {
        let papers;
        if (args.paper_indices && args.paper_indices.length > 0) {
            papers = args.paper_indices.map(idx => context.papers[idx]).filter(Boolean);
        }
        else {
            papers = context.papers;
        }
        if (papers.length === 0) {
            return {
                success: false,
                error: 'No papers available to answer the question'
            };
        }
        const answer = await llm_service_1.llmService.answerQuestions(args.question, papers);
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
    async saveAnnotation(args, context) {
        const paper = context.papers[args.paper_index];
        if (!paper || !paper.id) {
            return {
                success: false,
                error: `Invalid paper index or paper not saved: ${args.paper_index}`
            };
        }
        const noteType = (args.note_type || 'annotation');
        const annotation = await knowledge_service_1.knowledgeService.addAnnotation(context.userId, paper.id, args.content, noteType);
        return {
            success: true,
            data: {
                annotationId: annotation.id,
                paperTitle: paper.title,
                noteType
            }
        };
    }
    async searchUserKnowledge(args, context) {
        const limit = args.limit || 10;
        const results = await knowledge_service_1.knowledgeService.searchUserKnowledge(context.userId, args.query, limit);
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
    getCurrentPapers(context) {
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
    clearPapers(context) {
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
exports.ToolExecutor = ToolExecutor;
exports.toolExecutor = new ToolExecutor();
