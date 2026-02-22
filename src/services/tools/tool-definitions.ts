import { ToolDefinition } from "../../types/agent.types";

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
