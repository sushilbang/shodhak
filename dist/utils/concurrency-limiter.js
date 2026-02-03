"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ConcurrencyLimiter = void 0;
exports.getLimiter = getLimiter;
/**
 * Simple concurrency limiter with rate limiting
 * Prevents accidental bursts to external APIs
 */
class ConcurrencyLimiter {
    constructor(config) {
        this.config = config;
        this.activeCount = 0;
        this.lastRequestTime = 0;
        this.queue = [];
    }
    /**
     * Execute a function with concurrency and rate limiting
     */
    async execute(fn) {
        await this.acquire();
        try {
            return await fn();
        }
        finally {
            this.release();
        }
    }
    async acquire() {
        // Wait for rate limit
        const minInterval = 1000 / this.config.requestsPerSecond;
        const timeSinceLastRequest = Date.now() - this.lastRequestTime;
        if (timeSinceLastRequest < minInterval) {
            await this.sleep(minInterval - timeSinceLastRequest);
        }
        // Wait for concurrency slot
        if (this.activeCount >= this.config.maxConcurrent) {
            await new Promise(resolve => {
                this.queue.push(resolve);
            });
        }
        this.activeCount++;
        this.lastRequestTime = Date.now();
    }
    release() {
        this.activeCount--;
        const next = this.queue.shift();
        if (next) {
            next();
        }
    }
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}
exports.ConcurrencyLimiter = ConcurrencyLimiter;
/**
 * Registry of concurrency limiters per provider
 */
const limiters = new Map();
function getLimiter(providerName, config) {
    let limiter = limiters.get(providerName);
    if (!limiter) {
        limiter = new ConcurrencyLimiter(config);
        limiters.set(providerName, limiter);
    }
    return limiter;
}
