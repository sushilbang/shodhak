/**
 * RACE Framework - Report quality evaluation metrics
 *
 * Implements the RACE (Report Assessment through Criteria Evaluation) framework
 * from DeepResearch-Bench for evaluating research report quality across four dimensions:
 * - Comprehensiveness: Breadth and coverage of the topic
 * - Insight: Depth of analysis and critical thinking
 * - Instruction Following: Adherence to task requirements
 * - Readability: Clarity and organization
 *
 * Key features:
 * - Dynamic task-specific criteria generation
 * - Reference-based comparative scoring
 * - Weighted aggregation across dimensions
 */

import { createLLMClient } from '../utils/llm-client.factory';

// ============================================================================
// INTERFACES
// ============================================================================

export type RACEDimensionName = 'comprehensiveness' | 'insight' | 'instruction_following' | 'readability';

export interface RACECriterion {
    criterion: string;
    explanation: string;
    weight: number;
}

export interface RACEDimension {
    name: RACEDimensionName;
    weight: number;
    criteria: RACECriterion[];
}

export interface RACECriterionScore {
    criterion: string;
    score_target: number;    // 0-10 scale
    score_reference: number; // 0-10 scale
    justification: string;
}

export interface RACEDimensionScore {
    dimension: RACEDimensionName;
    weight: number;
    criteria_scores: RACECriterionScore[];
    target_score: number;      // Weighted average for target (0-10)
    reference_score: number;   // Weighted average for reference (0-10)
    normalized_score: number;  // 0-1 scale comparing target vs reference
}

export interface RACEScores {
    comprehensiveness: number;     // 0-1 normalized
    insight: number;
    instruction_following: number;
    readability: number;
    overall_score: number;         // 0-1 normalized
    raw_scores: {
        target_total: number;      // Sum of weighted dimension scores (0-10 scale)
        reference_total: number;   // Sum of weighted dimension scores (0-10 scale)
    };
    dimension_details: RACEDimensionScore[];
}

export interface RACEEvaluationResult {
    task: string;
    scores: RACEScores;
    criteria_used: RACEDimension[];
    evaluation_model: string;
    timestamp: string;
}

// ============================================================================
// DEFAULT CRITERIA
// ============================================================================

const DEFAULT_CRITERIA: Record<RACEDimensionName, RACECriterion[]> = {
    comprehensiveness: [
        {
            criterion: 'Topic Coverage Breadth',
            explanation: 'Does the report cover all major aspects and sub-topics of the research area?',
            weight: 0.35
        },
        {
            criterion: 'Key Concepts Inclusion',
            explanation: 'Are all fundamental concepts, definitions, and terminology properly introduced and explained?',
            weight: 0.25
        },
        {
            criterion: 'Historical Development',
            explanation: 'Does the report trace the evolution of the field and major milestones?',
            weight: 0.20
        },
        {
            criterion: 'Current State Coverage',
            explanation: 'Does the report adequately cover the current state-of-the-art and recent advances?',
            weight: 0.20
        }
    ],
    insight: [
        {
            criterion: 'Technical Depth',
            explanation: 'Does the report provide deep technical analysis of methods, algorithms, and mechanisms?',
            weight: 0.30
        },
        {
            criterion: 'Critical Analysis',
            explanation: 'Does the report critically evaluate approaches, identifying strengths, weaknesses, and tradeoffs?',
            weight: 0.30
        },
        {
            criterion: 'Connections and Synthesis',
            explanation: 'Does the report make meaningful connections between different works and synthesize insights?',
            weight: 0.25
        },
        {
            criterion: 'Future Directions',
            explanation: 'Does the report identify open problems, challenges, and promising research directions?',
            weight: 0.15
        }
    ],
    instruction_following: [
        {
            criterion: 'Task Relevance',
            explanation: 'Does the report directly address the specific question or topic requested?',
            weight: 0.35
        },
        {
            criterion: 'Scope Adherence',
            explanation: 'Does the report maintain appropriate scope without unnecessary tangents?',
            weight: 0.25
        },
        {
            criterion: 'Format Compliance',
            explanation: 'Does the report follow expected formatting, structure, and organization?',
            weight: 0.20
        },
        {
            criterion: 'Constraint Satisfaction',
            explanation: 'Does the report satisfy any specific constraints or requirements in the prompt?',
            weight: 0.20
        }
    ],
    readability: [
        {
            criterion: 'Clarity of Writing',
            explanation: 'Is the writing clear, precise, and easy to understand?',
            weight: 0.30
        },
        {
            criterion: 'Logical Organization',
            explanation: 'Is the report well-organized with clear sections and logical flow?',
            weight: 0.30
        },
        {
            criterion: 'Technical Accessibility',
            explanation: 'Are complex concepts explained in an accessible manner without oversimplification?',
            weight: 0.25
        },
        {
            criterion: 'Coherence',
            explanation: 'Are transitions smooth and does the narrative maintain coherence throughout?',
            weight: 0.15
        }
    ]
};

const DEFAULT_DIMENSION_WEIGHTS: Record<RACEDimensionName, number> = {
    comprehensiveness: 0.30,
    insight: 0.25,
    instruction_following: 0.25,
    readability: 0.20
};

// ============================================================================
// CORE FUNCTIONS
// ============================================================================

/**
 * Generate task-specific evaluation criteria using LLM
 *
 * @param task - The research task/prompt
 * @param baseWeights - Optional custom dimension weights
 * @returns Array of RACE dimensions with task-specific criteria
 */
export async function generateTaskCriteria(
    task: string,
    baseWeights?: Partial<Record<RACEDimensionName, number>>
): Promise<RACEDimension[]> {
    const { client, model } = createLLMClient();

    const weights = { ...DEFAULT_DIMENSION_WEIGHTS, ...baseWeights };

    const prompt = `You are an expert evaluator for research reports. Given the following research task, generate specific evaluation criteria tailored to this task.

Research Task:
${task}

Generate evaluation criteria for these four dimensions:
1. Comprehensiveness - Breadth and coverage of the topic
2. Insight - Depth of analysis and critical thinking
3. Instruction Following - Adherence to task requirements
4. Readability - Clarity and organization

For each dimension, provide 3-4 specific criteria with:
- criterion: A short descriptive name
- explanation: What this criterion evaluates (specific to the task)
- weight: Relative importance within the dimension (weights should sum to 1.0 within each dimension)

Output as JSON with this exact structure:
{
  "comprehensiveness": [{"criterion": "...", "explanation": "...", "weight": 0.X}, ...],
  "insight": [{"criterion": "...", "explanation": "...", "weight": 0.X}, ...],
  "instruction_following": [{"criterion": "...", "explanation": "...", "weight": 0.X}, ...],
  "readability": [{"criterion": "...", "explanation": "...", "weight": 0.X}, ...]
}`;

    try {
        const response = await client.chat.completions.create({
            model,
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.3,
            response_format: { type: 'json_object' }
        });

        const content = response.choices[0]?.message?.content;
        if (!content) {
            throw new Error('Empty response from LLM');
        }

        const parsed = JSON.parse(content) as Record<RACEDimensionName, RACECriterion[]>;

        // Build dimensions with weights
        const dimensions: RACEDimension[] = [
            { name: 'comprehensiveness', weight: weights.comprehensiveness, criteria: parsed.comprehensiveness || DEFAULT_CRITERIA.comprehensiveness },
            { name: 'insight', weight: weights.insight, criteria: parsed.insight || DEFAULT_CRITERIA.insight },
            { name: 'instruction_following', weight: weights.instruction_following, criteria: parsed.instruction_following || DEFAULT_CRITERIA.instruction_following },
            { name: 'readability', weight: weights.readability, criteria: parsed.readability || DEFAULT_CRITERIA.readability }
        ];

        // Validate and normalize weights within each dimension
        for (const dim of dimensions) {
            const totalWeight = dim.criteria.reduce((sum, c) => sum + c.weight, 0);
            if (Math.abs(totalWeight - 1.0) > 0.01) {
                // Normalize weights
                dim.criteria = dim.criteria.map(c => ({
                    ...c,
                    weight: c.weight / totalWeight
                }));
            }
        }

        return dimensions;
    } catch (error) {
        console.warn('Failed to generate task-specific criteria, using defaults:', error);
        return getDefaultCriteria(weights);
    }
}

/**
 * Get default RACE criteria with specified weights
 */
export function getDefaultCriteria(
    weights?: Partial<Record<RACEDimensionName, number>>
): RACEDimension[] {
    const w = { ...DEFAULT_DIMENSION_WEIGHTS, ...weights };

    return [
        { name: 'comprehensiveness', weight: w.comprehensiveness, criteria: DEFAULT_CRITERIA.comprehensiveness },
        { name: 'insight', weight: w.insight, criteria: DEFAULT_CRITERIA.insight },
        { name: 'instruction_following', weight: w.instruction_following, criteria: DEFAULT_CRITERIA.instruction_following },
        { name: 'readability', weight: w.readability, criteria: DEFAULT_CRITERIA.readability }
    ];
}

/**
 * Score a target report against a reference report using comparative evaluation
 *
 * @param targetReport - The report to evaluate
 * @param referenceReport - The baseline/reference report
 * @param task - The original research task
 * @param criteria - RACE dimensions and criteria to use
 * @returns RACE scores for the target report
 */
export async function scoreReport(
    targetReport: string,
    referenceReport: string,
    task: string,
    criteria: RACEDimension[]
): Promise<RACEScores> {
    const { client, model } = createLLMClient();

    // Build criteria string for prompt
    const criteriaStr = criteria.map(dim => {
        const criteriaList = dim.criteria.map(c =>
            `  - ${c.criterion} (weight: ${c.weight.toFixed(2)}): ${c.explanation}`
        ).join('\n');
        return `${dim.name.toUpperCase()} (dimension weight: ${dim.weight.toFixed(2)}):\n${criteriaList}`;
    }).join('\n\n');

    const prompt = `You are an expert evaluator comparing two research reports on the same topic. Score each report on a 0-10 scale for each criterion.

RESEARCH TASK:
${task}

REPORT A (Target Report to Evaluate):
${targetReport.slice(0, 15000)}${targetReport.length > 15000 ? '\n[... truncated ...]' : ''}

REPORT B (Reference Report for Comparison):
${referenceReport.slice(0, 15000)}${referenceReport.length > 15000 ? '\n[... truncated ...]' : ''}

EVALUATION CRITERIA:
${criteriaStr}

SCORING GUIDELINES:
- 0-2: Very poor, criterion barely addressed
- 3-4: Below average, significant gaps
- 5-6: Average, meets basic expectations
- 7-8: Good, exceeds expectations
- 9-10: Excellent, exceptional quality

For each criterion, provide:
- criterion: The criterion name
- score_a: Score for Report A (0-10)
- score_b: Score for Report B (0-10)
- justification: Brief explanation (1-2 sentences)

Output as JSON:
{
  "evaluations": [
    {"criterion": "...", "dimension": "...", "score_a": N, "score_b": N, "justification": "..."},
    ...
  ]
}`;

    const response = await client.chat.completions.create({
        model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.2,
        response_format: { type: 'json_object' }
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
        throw new Error('Empty response from LLM');
    }

    const parsed = JSON.parse(content) as {
        evaluations: Array<{
            criterion: string;
            dimension?: string;
            score_a: number;
            score_b: number;
            justification: string;
        }>;
    };

    return calculateWeightedScores(parsed.evaluations, criteria);
}

/**
 * Score a report without a reference (self-evaluation mode)
 * Uses a synthetic baseline approach
 */
export async function scoreReportSolo(
    report: string,
    task: string,
    criteria: RACEDimension[]
): Promise<RACEScores> {
    const { client, model } = createLLMClient();

    // Build criteria string for prompt
    const criteriaStr = criteria.map(dim => {
        const criteriaList = dim.criteria.map(c =>
            `  - ${c.criterion} (weight: ${c.weight.toFixed(2)}): ${c.explanation}`
        ).join('\n');
        return `${dim.name.toUpperCase()} (dimension weight: ${dim.weight.toFixed(2)}):\n${criteriaList}`;
    }).join('\n\n');

    const prompt = `You are an expert evaluator for research reports. Evaluate the following report on a 0-10 scale for each criterion.

RESEARCH TASK:
${task}

REPORT TO EVALUATE:
${report.slice(0, 20000)}${report.length > 20000 ? '\n[... truncated ...]' : ''}

EVALUATION CRITERIA:
${criteriaStr}

SCORING GUIDELINES:
- 0-2: Very poor, criterion barely addressed
- 3-4: Below average, significant gaps
- 5-6: Average, meets basic expectations
- 7-8: Good, exceeds expectations
- 9-10: Excellent, exceptional quality

For each criterion, provide:
- criterion: The criterion name
- score: Score (0-10)
- justification: Brief explanation (1-2 sentences)

Output as JSON:
{
  "evaluations": [
    {"criterion": "...", "dimension": "...", "score": N, "justification": "..."},
    ...
  ]
}`;

    const response = await client.chat.completions.create({
        model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.2,
        response_format: { type: 'json_object' }
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
        throw new Error('Empty response from LLM');
    }

    const parsed = JSON.parse(content) as {
        evaluations: Array<{
            criterion: string;
            dimension?: string;
            score: number;
            justification: string;
        }>;
    };

    // Convert to comparative format with reference = 5.0 (baseline average)
    const comparativeEvals = parsed.evaluations.map(e => ({
        criterion: e.criterion,
        dimension: e.dimension,
        score_a: e.score,
        score_b: 5.0, // Baseline score
        justification: e.justification
    }));

    return calculateWeightedScores(comparativeEvals, criteria);
}

/**
 * Calculate weighted RACE scores from criterion-level evaluations
 */
export function calculateWeightedScores(
    evaluations: Array<{
        criterion: string;
        dimension?: string;
        score_a: number;
        score_b: number;
        justification: string;
    }>,
    criteria: RACEDimension[]
): RACEScores {
    const dimensionScores: RACEDimensionScore[] = [];

    for (const dim of criteria) {
        const criteriaScores: RACECriterionScore[] = [];

        for (const crit of dim.criteria) {
            // Find matching evaluation (fuzzy match on criterion name)
            const evalMatch = evaluations.find(e =>
                e.criterion.toLowerCase().includes(crit.criterion.toLowerCase().slice(0, 10)) ||
                crit.criterion.toLowerCase().includes(e.criterion.toLowerCase().slice(0, 10)) ||
                e.dimension?.toLowerCase() === dim.name.toLowerCase()
            );

            if (evalMatch) {
                criteriaScores.push({
                    criterion: crit.criterion,
                    score_target: Math.max(0, Math.min(10, evalMatch.score_a)),
                    score_reference: Math.max(0, Math.min(10, evalMatch.score_b)),
                    justification: evalMatch.justification
                });
            } else {
                // Default scores if no match found
                criteriaScores.push({
                    criterion: crit.criterion,
                    score_target: 5,
                    score_reference: 5,
                    justification: 'No explicit evaluation provided'
                });
            }
        }

        // Calculate weighted averages for dimension
        let targetWeightedSum = 0;
        let referenceWeightedSum = 0;

        for (let i = 0; i < dim.criteria.length; i++) {
            targetWeightedSum += criteriaScores[i].score_target * dim.criteria[i].weight;
            referenceWeightedSum += criteriaScores[i].score_reference * dim.criteria[i].weight;
        }

        // Normalized score: target / (target + reference)
        // This gives 0.5 if equal, >0.5 if target is better
        const totalScore = targetWeightedSum + referenceWeightedSum;
        const normalizedScore = totalScore > 0 ? targetWeightedSum / totalScore : 0.5;

        dimensionScores.push({
            dimension: dim.name,
            weight: dim.weight,
            criteria_scores: criteriaScores,
            target_score: targetWeightedSum,
            reference_score: referenceWeightedSum,
            normalized_score: normalizedScore
        });
    }

    // Calculate overall scores
    let targetTotal = 0;
    let referenceTotal = 0;

    for (const dimScore of dimensionScores) {
        targetTotal += dimScore.target_score * dimScore.weight;
        referenceTotal += dimScore.reference_score * dimScore.weight;
    }

    const overallTotal = targetTotal + referenceTotal;
    const overallNormalized = overallTotal > 0 ? targetTotal / overallTotal : 0.5;

    // Extract dimension normalized scores
    const dimScoreMap = new Map(dimensionScores.map(d => [d.dimension, d.normalized_score]));

    return {
        comprehensiveness: dimScoreMap.get('comprehensiveness') || 0.5,
        insight: dimScoreMap.get('insight') || 0.5,
        instruction_following: dimScoreMap.get('instruction_following') || 0.5,
        readability: dimScoreMap.get('readability') || 0.5,
        overall_score: overallNormalized,
        raw_scores: {
            target_total: targetTotal,
            reference_total: referenceTotal
        },
        dimension_details: dimensionScores
    };
}

/**
 * Aggregate RACE scores across multiple evaluations
 */
export function aggregateRACEScores(results: RACEScores[]): {
    avgComprehensiveness: number;
    avgInsight: number;
    avgInstructionFollowing: number;
    avgReadability: number;
    avgOverallScore: number;
    stdOverallScore: number;
    totalEvaluations: number;
} {
    if (results.length === 0) {
        return {
            avgComprehensiveness: 0,
            avgInsight: 0,
            avgInstructionFollowing: 0,
            avgReadability: 0,
            avgOverallScore: 0,
            stdOverallScore: 0,
            totalEvaluations: 0
        };
    }

    const avg = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;
    const std = (arr: number[]) => {
        const mean = avg(arr);
        const squaredDiffs = arr.map(x => Math.pow(x - mean, 2));
        return Math.sqrt(avg(squaredDiffs));
    };

    const overallScores = results.map(r => r.overall_score);

    return {
        avgComprehensiveness: avg(results.map(r => r.comprehensiveness)),
        avgInsight: avg(results.map(r => r.insight)),
        avgInstructionFollowing: avg(results.map(r => r.instruction_following)),
        avgReadability: avg(results.map(r => r.readability)),
        avgOverallScore: avg(overallScores),
        stdOverallScore: std(overallScores),
        totalEvaluations: results.length
    };
}

/**
 * Convert normalized score (0-1) to letter grade
 */
export function scoreToGrade(score: number): string {
    if (score >= 0.9) return 'A+';
    if (score >= 0.8) return 'A';
    if (score >= 0.7) return 'B';
    if (score >= 0.6) return 'C';
    if (score >= 0.5) return 'D';
    return 'F';
}

/**
 * Convert normalized score to percentage string
 */
export function scoreToPercent(score: number): string {
    return `${(score * 100).toFixed(1)}%`;
}
