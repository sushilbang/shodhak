import { ToolResult, AgentContext } from "../../types/agent.types";
import { logger } from '../../utils/logger';
import { searchPapers, lookupByDoi, searchSimilar } from './search-tools';
import { summarizePaper, comparePapers, generateLiteratureReview, answerQuestion } from './analysis-tools';
import { saveAnnotation, searchUserKnowledge } from './knowledge-tools';
import { getCurrentPapers, clearPapers } from './context-tools';

export class ToolExecutor {
    async execute(
        toolName: string,
        args: Record<string, any>,
        context: AgentContext
    ): Promise<ToolResult> {
        logger.info('Executing tool', { toolName, args, sessionId: context.sessionId });

        try {
            switch(toolName) {
                case 'search_papers':
                    return searchPapers(args as { query: string; limit?: number }, context);
                case 'lookup_paper_by_doi':
                    return lookupByDoi(args as { doi: string }, context);
                case 'search_similar_papers':
                    return searchSimilar(args as { query: string; limit?: number }, context);
                case 'summarize_paper':
                    return summarizePaper(args as { paper_index: number }, context);
                case 'compare_papers':
                    return comparePapers(args as { paper_indices: number[] }, context);
                case 'generate_literature_review':
                    return generateLiteratureReview(args as { focus_topic?: string; paper_indices?: number[] }, context);
                case 'answer_question':
                    return answerQuestion(args as { question: string; paper_indices?: number[] }, context);
                case 'save_annotation':
                    return saveAnnotation(args as { paper_index: number; content: string; note_type?: string }, context);
                case 'search_user_knowledge':
                    return searchUserKnowledge(args as { query: string; limit?: number }, context);
                case 'get_current_papers':
                    return getCurrentPapers(context);
                case 'clear_papers':
                    return clearPapers(context);
                default:
                    return { success: false, error: `Unknown tool: ${toolName}` };
            }
        } catch (error) {
            logger.error('Tool execution failed', { toolName, error });
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Tool execution failed'
            };
        }
    }
}

export const toolExecutor = new ToolExecutor();
