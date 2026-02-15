import { ToolResult, AgentContext } from "../../types/agent.types";
import { searchService } from '../search.service';
import { enhancedSearchService } from "../enhanced-search.service";
import { embeddingService } from "../embedding.service";
import { contextManager } from "../agent-context";

export async function searchPapers(
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
                providers: 'openalex + semantic_scholar + arxiv + pubmed',
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

export async function lookupByDoi(
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

export async function searchSimilar(
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
