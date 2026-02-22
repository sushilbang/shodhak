import { QueryRefinementService } from './query-refinement.service';
import { PaperAnalysisService } from './paper-analysis.service';
import { LiteratureReviewService } from './literature-review.service';

const queryRefinement = new QueryRefinementService();
const paperAnalysis = new PaperAnalysisService();
const literatureReview = new LiteratureReviewService();

// Unified facade for backwards compatibility
export const llmService = {
    refineQuery: queryRefinement.refineQuery.bind(queryRefinement),
    generateClarifyingQuestions: queryRefinement.generateClarifyingQuestions.bind(queryRefinement),
    summarizePaper: paperAnalysis.summarizePaper.bind(paperAnalysis),
    comparePapers: paperAnalysis.comparePapers.bind(paperAnalysis),
    answerQuestions: paperAnalysis.answerQuestions.bind(paperAnalysis),
    generateLiteratureReview: literatureReview.generateLiteratureReview.bind(literatureReview),
    generateEnhancedLiteratureReview: literatureReview.generateEnhancedLiteratureReview.bind(literatureReview),
};

export { QueryRefinementService } from './query-refinement.service';
export { PaperAnalysisService } from './paper-analysis.service';
export { LiteratureReviewService } from './literature-review.service';
