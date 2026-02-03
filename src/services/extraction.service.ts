import { Paper } from '../models/database.models';
import { ExtractionResult, PaperSection } from '../types/agent.types';
import { logger } from '../utils/logger';

class ExtractionService {
    async extractPaperContent(paper: Paper): Promise<ExtractionResult | null> {
        logger.warn('extractPaperContent is a stub — not yet implemented', {
            paperId: paper.id,
            title: paper.title,
            url: paper.url,
        });
        return null;
    }

    async extractFromPdfUrl(url: string): Promise<string | null> {
        logger.warn('extractFromPdfUrl is a stub — not yet implemented', { url });
        return null;
    }

    async extractFromHtml(url: string): Promise<string | null> {
        logger.warn('extractFromHtml is a stub — not yet implemented', { url });
        return null;
    }

    parseSections(rawText: string): PaperSection[] {
        logger.warn('parseSections is a stub — not yet implemented', {
            textLength: rawText.length,
        });
        return [];
    }

    canExtract(paper: Paper): boolean {
        if (!paper.url) return false;

        const url = paper.url.toLowerCase();
        return (
            url.includes('arxiv.org') ||
            url.endsWith('.pdf') ||
            url.includes('doi.org')
        );
    }
}

export const extractionService = new ExtractionService();
