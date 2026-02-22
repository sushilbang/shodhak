import { ToolResult, AgentContext } from "../../types/agent.types";
import { knowledgeService } from "../knowledge.service";

export async function saveAnnotation(
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

export async function searchUserKnowledge(
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
