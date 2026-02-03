"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeToInternalPaper = normalizeToInternalPaper;
function normalizeToInternalPaper(raw) {
    return {
        external_id: raw.id,
        title: raw.title,
        authors: raw.authors.map(a => ({
            name: a.name,
            authorId: a.id,
        })),
        abstract: raw.abstract || '',
        url: raw.url || '',
        doi: raw.doi,
        year: raw.year,
        venue: raw.venue,
        citation_count: raw.citationCount,
        source: raw.source,
        metadata: raw.metadata,
    };
}
