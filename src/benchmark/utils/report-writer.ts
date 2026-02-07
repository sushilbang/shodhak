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

/**
 * Generate and save an HTML report for DeepResearch benchmark
 */
export function saveHtmlReport(
    filename: string,
    data: {
        title: string;
        timestamp: string;
        leaderboardScore: number;
        grade: string;
        race?: {
            comprehensiveness: number;
            insight: number;
            instructionFollowing: number;
            readability: number;
            overall: number;
        };
        fact?: {
            citationAccuracy: number;
            supportRate: number;
            totalCitations: number;
            supported: number;
            unsupported: number;
            unknown: number;
        };
        summary: {
            strengths: string[];
            weaknesses: string[];
            recommendations: string[];
        };
        queryResults?: Array<{
            id: string;
            topic: string;
            score: number;
        }>;
    },
    outputDir: string = process.cwd()
): string {
    const getGradeColor = (grade: string) => {
        if (grade.startsWith('A')) return '#22c55e';
        if (grade === 'B') return '#84cc16';
        if (grade === 'C') return '#eab308';
        if (grade === 'D') return '#f97316';
        return '#ef4444';
    };

    const formatPercent = (n: number) => `${(n * 100).toFixed(1)}%`;
    const gradeColor = getGradeColor(data.grade);

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${data.title}</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background: #f8fafc; color: #334155; line-height: 1.6; padding: 40px 20px; }
        .container { max-width: 900px; margin: 0 auto; }
        .header { text-align: center; margin-bottom: 40px; }
        .header h1 { font-size: 2.5rem; color: #1e293b; margin-bottom: 8px; }
        .header .timestamp { color: #64748b; font-size: 0.95rem; }
        .score-card { background: linear-gradient(135deg, #1e293b 0%, #334155 100%); color: white; border-radius: 16px; padding: 40px; text-align: center; margin-bottom: 30px; box-shadow: 0 10px 40px rgba(0,0,0,0.15); }
        .score-card .score { font-size: 5rem; font-weight: 700; }
        .score-card .grade { display: inline-block; background: ${gradeColor}; padding: 8px 24px; border-radius: 30px; font-size: 1.5rem; font-weight: 600; margin-top: 10px; }
        .score-card .label { color: #94a3b8; margin-top: 15px; font-size: 1.1rem; }
        .section { background: white; border-radius: 12px; padding: 30px; margin-bottom: 24px; box-shadow: 0 2px 8px rgba(0,0,0,0.06); }
        .section h2 { color: #1e293b; font-size: 1.4rem; margin-bottom: 20px; padding-bottom: 12px; border-bottom: 2px solid #e2e8f0; }
        .metrics-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; }
        .metric-card { background: #f8fafc; border-radius: 10px; padding: 20px; text-align: center; border: 1px solid #e2e8f0; }
        .metric-card .value { font-size: 2rem; font-weight: 700; color: #1e293b; }
        .metric-card .label { color: #64748b; font-size: 0.9rem; margin-top: 4px; }
        .metric-card .grade { font-size: 0.85rem; color: white; padding: 3px 10px; border-radius: 12px; display: inline-block; margin-top: 8px; }
        .list { list-style: none; }
        .list li { padding: 12px 16px; margin: 8px 0; border-radius: 8px; display: flex; align-items: flex-start; gap: 12px; }
        .list.strengths li { background: #f0fdf4; color: #166534; }
        .list.weaknesses li { background: #fef2f2; color: #991b1b; }
        .list.recommendations li { background: #eff6ff; color: #1e40af; }
        .list li::before { font-size: 1.2rem; }
        .list.strengths li::before { content: "\\2713"; }
        .list.weaknesses li::before { content: "\\2717"; }
        .list.recommendations li::before { content: "\\27A4"; }
        .stats-row { display: flex; justify-content: space-around; flex-wrap: wrap; gap: 20px; padding: 20px 0; }
        .stat { text-align: center; }
        .stat .num { font-size: 2.2rem; font-weight: 700; color: #1e293b; }
        .stat .lbl { color: #64748b; font-size: 0.9rem; }
        .footer { text-align: center; color: #94a3b8; margin-top: 40px; font-size: 0.9rem; }
        @media print { body { padding: 20px; } .section { break-inside: avoid; } }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>${data.title}</h1>
            <div class="timestamp">Generated: ${new Date(data.timestamp).toLocaleString()}</div>
        </div>

        <div class="score-card">
            <div class="score">${data.leaderboardScore}</div>
            <div class="grade">${data.grade}</div>
            <div class="label">Leaderboard Score (out of 100)</div>
        </div>

        ${data.race ? `
        <div class="section">
            <h2>RACE Metrics - Report Quality</h2>
            <div class="metrics-grid">
                <div class="metric-card">
                    <div class="value">${formatPercent(data.race.comprehensiveness)}</div>
                    <div class="label">Comprehensiveness</div>
                </div>
                <div class="metric-card">
                    <div class="value">${formatPercent(data.race.insight)}</div>
                    <div class="label">Insight & Depth</div>
                </div>
                <div class="metric-card">
                    <div class="value">${formatPercent(data.race.instructionFollowing)}</div>
                    <div class="label">Instruction Following</div>
                </div>
                <div class="metric-card">
                    <div class="value">${formatPercent(data.race.readability)}</div>
                    <div class="label">Readability</div>
                </div>
            </div>
        </div>
        ` : ''}

        ${data.fact ? `
        <div class="section">
            <h2>FACT Metrics - Citation Accuracy</h2>
            <div class="metrics-grid">
                <div class="metric-card">
                    <div class="value">${formatPercent(data.fact.citationAccuracy)}</div>
                    <div class="label">Citation Accuracy</div>
                </div>
                <div class="metric-card">
                    <div class="value">${formatPercent(data.fact.supportRate)}</div>
                    <div class="label">Support Rate</div>
                </div>
            </div>
            <div class="stats-row">
                <div class="stat"><div class="num">${data.fact.totalCitations}</div><div class="lbl">Total Citations</div></div>
                <div class="stat"><div class="num" style="color:#22c55e">${data.fact.supported}</div><div class="lbl">Supported</div></div>
                <div class="stat"><div class="num" style="color:#ef4444">${data.fact.unsupported}</div><div class="lbl">Unsupported</div></div>
                <div class="stat"><div class="num" style="color:#94a3b8">${data.fact.unknown}</div><div class="lbl">Unknown</div></div>
            </div>
        </div>
        ` : ''}

        ${data.summary.strengths.length > 0 ? `
        <div class="section">
            <h2>Strengths</h2>
            <ul class="list strengths">
                ${data.summary.strengths.map(s => `<li>${s}</li>`).join('')}
            </ul>
        </div>
        ` : ''}

        ${data.summary.weaknesses.length > 0 ? `
        <div class="section">
            <h2>Weaknesses</h2>
            <ul class="list weaknesses">
                ${data.summary.weaknesses.map(w => `<li>${w}</li>`).join('')}
            </ul>
        </div>
        ` : ''}

        ${data.summary.recommendations.length > 0 ? `
        <div class="section">
            <h2>Recommendations</h2>
            <ul class="list recommendations">
                ${data.summary.recommendations.map(r => `<li>${r}</li>`).join('')}
            </ul>
        </div>
        ` : ''}

        <div class="footer">
            <p>DeepResearch-Bench Report | Shodhak Research Assistant</p>
        </div>
    </div>
</body>
</html>`;

    const outputPath = path.join(outputDir, filename);
    fs.writeFileSync(outputPath, html);
    return outputPath;
}
