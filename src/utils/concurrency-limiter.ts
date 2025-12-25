import { ConcurrencyConfig } from '../providers/paper-provider.interface';

/**
 * Simple concurrency limiter with rate limiting
 * Prevents accidental bursts to external APIs
 */
export class ConcurrencyLimiter {
    private activeCount = 0;
    private lastRequestTime = 0;
    private queue: (() => void)[] = [];

    constructor(private config: ConcurrencyConfig) {}

    /**
     * Execute a function with concurrency and rate limiting
     */
    async execute<T>(fn: () => Promise<T>): Promise<T> {
        await this.acquire();
        try {
            return await fn();
        } finally {
            this.release();
        }
    }

    private async acquire(): Promise<void> {
        // Wait for rate limit
        const minInterval = 1000 / this.config.requestsPerSecond;
        const timeSinceLastRequest = Date.now() - this.lastRequestTime;

        if (timeSinceLastRequest < minInterval) {
            await this.sleep(minInterval - timeSinceLastRequest);
        }

        // Wait for concurrency slot
        if (this.activeCount >= this.config.maxConcurrent) {
            await new Promise<void>(resolve => {
                this.queue.push(resolve);
            });
        }

        this.activeCount++;
        this.lastRequestTime = Date.now();
    }

    private release(): void {
        this.activeCount--;
        const next = this.queue.shift();
        if (next) {
            next();
        }
    }

    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

/**
 * Registry of concurrency limiters per provider
 */
const limiters = new Map<string, ConcurrencyLimiter>();

export function getLimiter(providerName: string, config: ConcurrencyConfig): ConcurrencyLimiter {
    let limiter = limiters.get(providerName);
    if (!limiter) {
        limiter = new ConcurrencyLimiter(config);
        limiters.set(providerName, limiter);
    }
    return limiter;
}
