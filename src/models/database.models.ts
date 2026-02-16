export interface User {
    id: number;
    email: string;
    created_at: Date;
}

export interface ResearchSession {
    id: number;
    user_id: number;
    initial_query: string;
    refined_query?: string;
    status: 'initiated' | 'clarifying' | 'searching' | 'papers_ready' | 'generating' | 'completed';
    created_at: Date;
    updated_at: Date;
}

export interface Author {
    name: string;
    authorId?: string;
}

export interface Paper {
    id?: number;
    external_id: string;
    title: string;
    authors: Author[];
    abstract: string;
    url: string;
    doi?: string;
    year?: number;
    venue?: string;
    citation_count?: number;
    source: 'semantic_scholar' | 'openalex' | 'crossref' | 'arxiv' | 'pubmed' | 'custom';
    metadata?: Record<string, any>;
    created_at?: Date;
}

export interface PaperEmbedding {
    id: number;
    paper_id: number;
    embedding: number[];
    created_at: Date;
}

export interface SessionPaper {
    id: number;
    research_session_id: number;
    paper_id: number;
    user_selected: boolean;
    relevance_score?: number;
    created_at: Date;
}

export interface UserKnowledge {
    id: number;
    user_id: number;
    paper_id: number;
    content: string;
    embedding?: number[];
    note_type: 'annotation' | 'summary' | 'highlight';
    created_at: Date;
}

export interface Citation {
    index: number;
    paper_id: number;
    title: string;
    authors: string;
    year?: number;
    venue?: string;
}

export interface Report {
    id: number;
    research_session_id: number;
    content: string;
    report_type: 'literature_review' | 'summary' | 'comparison';
    citations: Citation[];
    created_at: Date;
}

// --- Agent Session Persistence Models ---

export interface AgentSession {
    id: string; // UUID
    user_id: number;
    status: 'active' | 'expired' | 'ended';
    created_at: Date;
    last_activity_at: Date;
    metadata: Record<string, any>;
}

export interface SessionMessage {
    id: number;
    session_id: string;
    role: string;
    content: string | null;
    tool_calls: any | null;
    tool_call_id: string | null;
    name: string | null;
    message_order: number;
    created_at: Date;
}

export interface AgentSessionPaper {
    id: number;
    session_id: string;
    paper_id: number;
    added_at: Date;
}
