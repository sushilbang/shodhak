# Shodhak

**Shodhak** (Sanskrit for "seeker" or "researcher") is an academic research assistant that helps users find, analyze, and synthesize academic papers using semantic search and natural language processing.

## Features

- **Multi-step Research Workflow** - Guided process from query refinement to report generation
- **Semantic Paper Search** - Vector embeddings for finding conceptually similar papers
- **Multiple Paper Providers** - OpenAlex, Semantic Scholar, and CrossRef integration
- **AI Query Refinement** - Clarifying questions to improve search precision
- **Knowledge Base** - Save annotations and notes with semantic search
- **Report Generation** - AI-powered literature review synthesis
- **Agentic Interface** - Interactive multi-turn research conversations
- **Local LLM Support** - Ollama integration for privacy-focused deployments

## Architecture

```
┌─────────────────────────────────────────────┐
│          HTTP Controllers                    │
│    (ResearchController, AgentController)     │
├─────────────────────────────────────────────┤
│              Services                        │
│  (Search, Embedding, Session, LLM, Agent)    │
├─────────────────────────────────────────────┤
│              Providers                       │
│  (OpenAlex, Semantic Scholar, CrossRef)      │
├─────────────────────────────────────────────┤
│        PostgreSQL + pgvector                 │
└─────────────────────────────────────────────┘
```

## Prerequisites

- Node.js 18+
- PostgreSQL 14+ with [pgvector](https://github.com/pgvector/pgvector) extension
- Redis (optional, for job queues)
- Ollama (for local LLM/embeddings) or OpenAI API key

## Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/sushilbang/shodhak.git
   cd shodhak
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Set up PostgreSQL with pgvector**
   ```sql
   CREATE EXTENSION IF NOT EXISTS vector;
   ```

4. **Configure environment variables**
   ```bash
   cp .env.example .env
   # Edit .env with your configuration
   ```

5. **Run database migrations**
   ```bash
   npm run migrate
   ```

6. **Start the server**
   ```bash
   npm run dev    # Development
   npm start      # Production
   ```

## Configuration

Create a `.env` file with the following variables:

```env
# Server
PORT=3000
NODE_ENV=development

# Database
DATABASE_URL=postgresql://user:password@localhost:5432/shodhak

# LLM Provider (ollama or openai)
LLM_PROVIDER=ollama
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=llama3.2

# Embedding Provider (ollama or openai)
EMBEDDING_PROVIDER=ollama
OLLAMA_EMBEDDING_MODEL=nomic-embed-text
OLLAMA_EMBEDDING_DIMENSIONS=768

# OpenAI (if using)
OPENAI_API_KEY=your-api-key

# Redis (optional)
REDIS_URL=redis://localhost:6379
```

### Embedding Dimensions

Ensure your database schema matches your embedding model dimensions:

| Model | Dimensions |
|-------|------------|
| OpenAI `text-embedding-3-small` | 1536 |
| Ollama `nomic-embed-text` | 768 |
| Ollama `mxbai-embed-large` | 1024 |
| Ollama `all-minilm` | 384 |

## API Endpoints

### Research Sessions

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/research/sessions` | Create a new research session |
| GET | `/api/research/sessions` | List user's sessions |
| GET | `/api/research/sessions/:id` | Get session details |
| POST | `/api/research/sessions/:id/clarify` | Get clarifying questions |
| POST | `/api/research/sessions/:id/answers` | Submit answers, refine query |
| POST | `/api/research/sessions/:id/search` | Search for papers |
| GET | `/api/research/sessions/:id/papers` | Get session papers |
| POST | `/api/research/sessions/:id/select` | Select papers for report |
| POST | `/api/research/sessions/:id/report` | Generate literature review |
| POST | `/api/research/sessions/:id/ask` | Ask questions about papers |

### Papers

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/research/papers/search` | Direct paper search |
| GET | `/api/research/papers/similar` | Semantic similarity search |
| GET | `/api/research/papers/:id` | Get paper details |
| POST | `/api/research/papers/:id/annotations` | Add annotation |

### Knowledge Base

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/research/knowledge` | Get user's knowledge base |
| GET | `/api/research/knowledge/search` | Semantic search notes |
| PUT | `/api/research/knowledge/:id` | Update annotation |
| DELETE | `/api/research/knowledge/:id` | Delete annotation |

### Agent

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/agent/chat` | Interactive agent conversation |

## Usage

### Creating a Research Session

```bash
curl -X POST http://localhost:3000/api/research/sessions \
  -H "Content-Type: application/json" \
  -H "X-User-Id: user123" \
  -d '{"query": "machine learning applications in drug discovery"}'
```

### Searching Papers

```bash
curl -X POST http://localhost:3000/api/research/sessions/{id}/search \
  -H "X-User-Id: user123"
```

### Generating a Report

```bash
curl -X POST http://localhost:3000/api/research/sessions/{id}/report \
  -H "Content-Type: application/json" \
  -H "X-User-Id: user123" \
  -d '{"paperIds": ["paper1", "paper2", "paper3"]}'
```

## Research Workflow

```
1. initiated      → User creates session with initial query
2. clarifying     → AI asks clarifying questions
3. searching      → System searches multiple paper providers
4. papers_ready   → User reviews and selects papers
5. generating     → AI generates literature review
6. completed      → Report ready for download
```

## Project Structure

```
shodhak/
├── src/
│   ├── config/
│   │   └── database.ts         # PostgreSQL connection
│   ├── controllers/
│   │   ├── research.controller.ts
│   │   └── agent.controller.ts
│   ├── services/
│   │   ├── embedding.service.ts  # Vector embeddings
│   │   ├── search.service.ts     # Paper search orchestration
│   │   ├── session.service.ts    # Workflow state machine
│   │   ├── llm.service.ts        # LLM prompts
│   │   ├── knowledge.service.ts  # User annotations
│   │   └── agent.service.ts      # Agentic interface
│   ├── providers/
│   │   ├── openalex.provider.ts
│   │   ├── semantic-scholar.provider.ts
│   │   └── crossref.provider.ts
│   ├── models/
│   │   └── database.models.ts
│   ├── routes/
│   │   └── research.routes.ts
│   ├── middleware/
│   │   └── auth.middleware.ts
│   └── server.ts
├── .env.example
├── package.json
└── README.md
```

## License

MIT

## Contributing

Contributions are welcome! Please open an issue or submit a pull request.