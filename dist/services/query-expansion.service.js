"use strict";
/**
 * Query Expansion Service
 *
 * Expands user queries with synonyms, related terms, and academic vocabulary
 * to improve recall in paper search.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.queryExpansionService = void 0;
const logger_1 = require("../utils/logger");
const llm_client_factory_1 = require("../benchmark/utils/llm-client.factory");
class QueryExpansionService {
    constructor() {
        // Cache for expanded queries (in-memory, could be Redis)
        this.cache = new Map();
        const { client, model, provider } = (0, llm_client_factory_1.createLLMClient)();
        this.client = client;
        this.MODEL = model;
        this.provider = provider;
        logger_1.logger.info('Query expansion service initialized', { provider });
    }
    /**
     * Expand a query with related terms and synonyms
     */
    async expandQuery(query) {
        // Check cache first
        const cacheKey = query.toLowerCase().trim();
        if (this.cache.has(cacheKey)) {
            logger_1.logger.debug('Query expansion cache hit', { query });
            return this.cache.get(cacheKey);
        }
        const startTime = Date.now();
        try {
            const response = await this.client.chat.completions.create({
                model: this.MODEL,
                max_tokens: 256,
                temperature: 0.3, // Low temperature for consistency
                messages: [
                    {
                        role: 'system',
                        content: `You are an academic search query expander. Given a research query, output related terms to improve search recall.

Output JSON only:
{
  "terms": ["term1", "term2", ...],  // 5-8 key academic terms/phrases
  "variants": ["var1", "var2", ...]   // 3-5 alternative phrasings or acronyms
}`
                    },
                    {
                        role: 'user',
                        content: `Expand this research query: "${query}"`
                    }
                ]
            });
            const content = response.choices[0]?.message?.content || '{}';
            // Parse JSON from response
            let parsed = {};
            try {
                // Extract JSON from response (handle markdown code blocks)
                const jsonMatch = content.match(/\{[\s\S]*\}/);
                if (jsonMatch) {
                    parsed = JSON.parse(jsonMatch[0]);
                }
            }
            catch (e) {
                logger_1.logger.warn('Failed to parse query expansion response', { content });
            }
            const terms = parsed.terms || [];
            const variants = parsed.variants || [];
            // Build expanded query
            const allTerms = [...new Set([
                    ...query.split(/\s+/),
                    ...terms,
                    ...variants
                ])].filter(t => t.length > 2);
            const expanded = {
                original: query,
                expanded: allTerms.slice(0, 15).join(' '), // Limit to 15 terms
                terms,
                variants
            };
            // Cache the result
            this.cache.set(cacheKey, expanded);
            logger_1.logger.info('Query expanded', {
                original: query,
                termsAdded: terms.length,
                variantsAdded: variants.length,
                latencyMs: Date.now() - startTime
            });
            return expanded;
        }
        catch (error) {
            logger_1.logger.error('Query expansion failed', { error, query });
            // Return original query on failure
            return {
                original: query,
                expanded: query,
                terms: [],
                variants: []
            };
        }
    }
    /**
     * Generate multiple query variants for parallel search
     */
    async generateQueryVariants(query, count = 3) {
        const expanded = await this.expandQuery(query);
        const variants = [query]; // Always include original
        // Add variant phrasings
        for (const variant of expanded.variants.slice(0, count - 1)) {
            variants.push(variant);
        }
        // If we don't have enough variants, create term combinations
        while (variants.length < count && expanded.terms.length > 0) {
            const subset = expanded.terms
                .sort(() => Math.random() - 0.5)
                .slice(0, 4)
                .join(' ');
            if (!variants.includes(subset)) {
                variants.push(subset);
            }
        }
        return variants.slice(0, count);
    }
    /**
     * Clear the cache
     */
    clearCache() {
        this.cache.clear();
        logger_1.logger.info('Query expansion cache cleared');
    }
    /**
     * Get cache stats
     */
    getCacheStats() {
        return {
            size: this.cache.size,
            queries: Array.from(this.cache.keys())
        };
    }
}
exports.queryExpansionService = new QueryExpansionService();
