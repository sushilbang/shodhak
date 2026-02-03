/**
 * Report Writer Utility
 * Centralized report generation and file writing
 */

import * as fs from 'fs';
import * as path from 'path';

export interface ReportMetadata {
    timestamp: string;
    benchmarkType: string;
    version?: string;
}

/**
 * Save a report as JSON
 */
export function saveJsonReport(
    filename: string,
    data: any,
    outputDir: string = process.cwd()
): string {
    const outputPath = path.join(outputDir, filename);
    fs.writeFileSync(outputPath, JSON.stringify(data, null, 2));
    return outputPath;
}

/**
 * Create a timestamped filename
 */
export function createTimestampedFilename(baseName: string, extension: string = 'json'): string {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    return `${baseName}-${timestamp}.${extension}`;
}

/**
 * Create a report with standard metadata
 */
export function createReport<T>(
    benchmarkType: string,
    data: T,
    additionalMeta?: Record<string, any>
): T & ReportMetadata {
    return {
        timestamp: new Date().toISOString(),
        benchmarkType,
        ...additionalMeta,
        ...data
    };
}

/**
 * Load a previous report
 */
export function loadReport<T>(filepath: string): T | null {
    try {
        const content = fs.readFileSync(filepath, 'utf-8');
        return JSON.parse(content) as T;
    } catch {
        return null;
    }
}

/**
 * List available reports in a directory
 */
export function listReports(
    dir: string = process.cwd(),
    pattern: RegExp = /benchmark.*\.json$/
): string[] {
    try {
        return fs.readdirSync(dir)
            .filter(f => pattern.test(f))
            .map(f => path.join(dir, f))
            .sort()
            .reverse(); // Most recent first
    } catch {
        return [];
    }
}

/**
 * Generate a simple markdown report
 */
export function generateMarkdownReport(
    title: string,
    sections: { heading: string; content: string }[]
): string {
    let md = `# ${title}\n\n`;
    md += `*Generated: ${new Date().toISOString()}*\n\n`;

    for (const section of sections) {
        md += `## ${section.heading}\n\n${section.content}\n\n`;
    }

    return md;
}

/**
 * Format a metrics object as a markdown table
 */
export function metricsToMarkdownTable(
    metrics: Record<string, number>,
    options: { headers?: [string, string]; decimals?: number } = {}
): string {
    const { headers = ['Metric', 'Value'], decimals = 2 } = options;

    let table = `| ${headers[0]} | ${headers[1]} |\n`;
    table += '|------|-------|\n';

    for (const [key, value] of Object.entries(metrics)) {
        const formattedValue = typeof value === 'number' ? value.toFixed(decimals) : value;
        table += `| ${key} | ${formattedValue} |\n`;
    }

    return table;
}
