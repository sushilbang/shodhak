import { Paper } from '../models/database.models'
// OpenAI-compatible message types
export interface ChatMessage {
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string | null;
    tool_calls?: ToolCall[];
    tool_call_id?: string;
    name?: string;
}

export interface ToolCall {
    id: string;
    type: 'function';
    function: {
        name: string;
        arguments: string;
    };
}

export interface ToolDefinition {
    type: 'function';
    function: {
        name: string;
        description: string;
        parameters: {
            type: 'object';
            properties: Record<string, {
                type: string;
                description: string;
                enum?: string[];
                items?: { type: string };
            }>;
            required: string[];
        };
    };
}

// --- Context Compression / Memory Types ---

export interface ConversationSummary {
    content: string;
    messageRange: { from: number; to: number };
    createdAt: Date;
    tokenEstimate: number;
}

export type KeyFactType = 'paper_conclusion' | 'user_preference' | 'research_direction' | 'decision' | 'entity';

export interface KeyFact {
    type: KeyFactType;
    content: string;
    relatedPaperIndices: number[];
    extractedAt: Date;
}

export interface MemoryState {
    summaries: ConversationSummary[];
    keyFacts: KeyFact[];
    recentBufferStart: number;
}

// Agent context state
export interface AgentContext {
    sessionId: string;
    userId: number;
    papers: Paper[];
    conversationHistory: ChatMessage[];
    metadata: {
        createdAt: Date;
        lastActivityAt: Date;
        totalIterations: number;
        searchCount: number;
        analysisCount: number;
    };
    memoryState: MemoryState;
}
// Tool execution result
export interface ToolResult {
    success: boolean;
    data?: any;
    error?: string;
}
// Agent response
export interface AgentResponse {
    sessionId: string;
    message: string;
    papers?: Paper[];
    toolsUsed?: string[];
    iterationCount: number;
    done: boolean;
}
// API request/response types
export interface AgentChatRequest {
    message: string;
    session_id?: string;
}

export interface AgentChatResponse {
    session_id: string;
    response: string;
    papers?: PaperSummary[];
    metadata: {
        tools_used: string[];
        iterations: number;
        papers_in_context: number;
        completed: boolean;
    };
}

export interface PaperSummary {
    index: number;
    title: string;
    authors: string;
    year?: number;
    abstract?: string;
    doi?: string;
}

// --- Extraction Types ---

export interface PaperSection {
    title: string;
    content: string;
    order: number;
    type: 'abstract' | 'introduction' | 'methods' | 'results' | 'discussion' | 'conclusion' | 'references' | 'other';
}

export interface ExtractionResult {
    paperId: number;
    fullText: string;
    sections: PaperSection[];
    extractedAt: Date;
    source: 'arxiv' | 'pdf' | 'html' | 'other';
    metadata: Record<string, any>;
}
