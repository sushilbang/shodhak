"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractionService = void 0;
const logger_1 = require("../utils/logger");
class ExtractionService {
    /**
     * Extract full paper content. Currently a stub — returns null.
     */
    async extractPaperContent(paper) {
        logger_1.logger.warn('extractPaperContent is a stub — not yet implemented', {
            paperId: paper.id,
            title: paper.title,
            url: paper.url,
        });
        return null;
    }
    /**
     * Extract content from a PDF URL. Currently a stub — returns null.
     */
    async extractFromPdfUrl(url) {
        logger_1.logger.warn('extractFromPdfUrl is a stub — not yet implemented', { url });
        return null;
    }
    /**
     * Extract content from an HTML page. Currently a stub — returns null.
     */
    async extractFromHtml(url) {
        logger_1.logger.warn('extractFromHtml is a stub — not yet implemented', { url });
        return null;
    }
    /**
     * Parse raw text into sections. Currently a stub — returns empty array.
     */
    parseSections(rawText) {
        logger_1.logger.warn('parseSections is a stub — not yet implemented', {
            textLength: rawText.length,
        });
        return [];
    }
    /**
     * Check if a paper's URL matches extractable patterns (arxiv, .pdf, doi.org).
     */
    canExtract(paper) {
        if (!paper.url)
            return false;
        const url = paper.url.toLowerCase();
        return (url.includes('arxiv.org') ||
            url.endsWith('.pdf') ||
            url.includes('doi.org'));
    }
}
exports.extractionService = new ExtractionService();
