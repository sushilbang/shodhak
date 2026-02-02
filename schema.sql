-- Shodhak Database Schema
-- Run this SQL file to initialize the database

-- Enable pgvector extension (required for semantic search)
CREATE EXTENSION IF NOT EXISTS vector;

-- Users table
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Papers table (cached papers from external APIs)
CREATE TABLE IF NOT EXISTS papers (
    id SERIAL PRIMARY KEY,
    external_id VARCHAR(255) UNIQUE NOT NULL,
    title TEXT NOT NULL,
    authors JSONB NOT NULL DEFAULT '[]',
    abstract TEXT,
    url TEXT,
    doi VARCHAR(255),
    year INTEGER,
    venue TEXT,
    citation_count INTEGER DEFAULT 0,
    source VARCHAR(50) NOT NULL,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Paper embeddings for semantic search
CREATE TABLE IF NOT EXISTS paper_embeddings (
    id SERIAL PRIMARY KEY,
    paper_id INTEGER REFERENCES papers(id) ON DELETE CASCADE,
    embedding TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(paper_id)
);

-- Research sessions (workflow state)
CREATE TABLE IF NOT EXISTS research_sessions (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    initial_query TEXT NOT NULL,
    refined_query TEXT,
    status VARCHAR(50) DEFAULT 'initiated',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Session papers (papers found in a research session)
CREATE TABLE IF NOT EXISTS session_papers (
    id SERIAL PRIMARY KEY,
    research_session_id INTEGER REFERENCES research_sessions(id) ON DELETE CASCADE,
    paper_id INTEGER REFERENCES papers(id) ON DELETE CASCADE,
    user_selected BOOLEAN DEFAULT FALSE,
    relevance_score DECIMAL(5,4),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(research_session_id, paper_id)
);

-- User knowledge base (annotations, notes, highlights)
CREATE TABLE IF NOT EXISTS user_knowledge (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    paper_id INTEGER REFERENCES papers(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    embedding TEXT,
    note_type VARCHAR(50) DEFAULT 'annotation',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Reports (generated literature reviews)
CREATE TABLE IF NOT EXISTS reports (
    id SERIAL PRIMARY KEY,
    research_session_id INTEGER REFERENCES research_sessions(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    report_type VARCHAR(50) DEFAULT 'literature_review',
    citations JSONB DEFAULT '[]',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_papers_external_id ON papers(external_id);
CREATE INDEX IF NOT EXISTS idx_papers_doi ON papers(doi);
CREATE INDEX IF NOT EXISTS idx_papers_source ON papers(source);
CREATE INDEX IF NOT EXISTS idx_research_sessions_user_id ON research_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_session_papers_session_id ON session_papers(research_session_id);
CREATE INDEX IF NOT EXISTS idx_user_knowledge_user_id ON user_knowledge(user_id);
CREATE INDEX IF NOT EXISTS idx_user_knowledge_paper_id ON user_knowledge(paper_id);

-- Insert a test user for development
INSERT INTO users (id, email) VALUES (1, 'test@example.com') ON CONFLICT (id) DO NOTHING;
