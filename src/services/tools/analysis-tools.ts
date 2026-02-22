import { ToolResult, AgentContext } from "../../types/agent.types";
import { Paper } from "../../models/database.models";
import { llmService } from "../llm";
import { extractionService } from "../extraction.service";

export async function summarizePaper(
    args: { paper_index: number },
    context: AgentContext
): Promise<ToolResult> {
    const paper = context.papers[args.paper_index];
    if(!paper) {
        return {
            success: false,
            error: `Invalid paper index: ${args.paper_index}`
        };
    }
    const summary = await llmService.summarizePaper(paper);
    context.metadata.analysisCount++;

    return {
        success: true,
        data: {
            paperTitle: paper.title,
            summary
        }
    };
}

export async function comparePapers(
    args: { paper_indices: number[] },
    context: AgentContext
): Promise<ToolResult> {
    if(args.paper_indices.length < 2) {
        return {
            success: false,
            error: 'Need at least 2 papers to compare'
        };
    }

    const papers: Paper[] = [];
    for(const idx of args.paper_indices) {
        const paper = context.papers[idx];
        if(!paper) {
            return {
                success: false,
                error: `Invalid paper index: ${idx}`
            };
        }
        papers.push(paper);
    }
    const comparison = await llmService.comparePapers(papers);
    context.metadata.analysisCount++;

    return {
        success: true,
        data: {
            comparedPapers: papers.map((p, i) => ({
                index: args.paper_indices[i], title: p.title
            })),
            comparison
        }
    };
}

export async function generateLiteratureReview(
    args: { focus_topic?: string; paper_indices?: number[] },
    context: AgentContext
): Promise<ToolResult> {
    let papers: Paper[];

    if(args.paper_indices && args.paper_indices.length > 0) {
        papers = args.paper_indices.map(idx => context.papers[idx]).filter(Boolean);
    } else {
        papers = context.papers;
    }

    if(papers.length === 0) {
        return {
            success: false,
            error: 'No papers available for literature review'
        };
    }

    const topic = args.focus_topic || 'the research topic';

    // Extract paper content for enhanced generation
    const paperContents = await extractionService.extractMultiplePapers(papers);
    const result = await llmService.generateLiteratureReview(papers, topic, paperContents);
    context.metadata.analysisCount++;

    return {
        success: true,
        data: {
            papersIncluded: papers.length,
            content: result.content,
            citations: result.citations
        }
    };
}

export async function answerQuestion(
    args: { question: string; paper_indices?: number[] },
    context: AgentContext
): Promise<ToolResult> {
    let papers: Paper[];

    if(args.paper_indices && args.paper_indices.length > 0) {
        papers = args.paper_indices.map(idx => context.papers[idx]).filter(Boolean);
    } else {
        papers = context.papers;
    }

    if(papers.length === 0) {
        return {
            success: false,
            error: 'No papers available to answer the question'
        };
    }

    const answer = await llmService.answerQuestions(args.question, papers);
    context.metadata.analysisCount++;

    return {
        success: true,
        data: {
            question: args.question,
            answer,
            papersUsed: papers.length
        }
    };
}
