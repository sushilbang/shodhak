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