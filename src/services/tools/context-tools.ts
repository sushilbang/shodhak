import { ToolResult, AgentContext } from "../../types/agent.types";

export function getCurrentPapers(context: AgentContext): ToolResult {
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

export function clearPapers(context: AgentContext): ToolResult {
    const clearedCount = context.papers.length;
    context.papers = [];

    return {
        success: true,
        data: {
            message: `Cleared ${clearedCount} papers from context`
        }
    };
}
