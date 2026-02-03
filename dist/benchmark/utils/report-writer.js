"use strict";
/**
 * Report Writer Utility
 * Centralized report generation and file writing
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.saveJsonReport = saveJsonReport;
exports.createTimestampedFilename = createTimestampedFilename;
exports.createReport = createReport;
exports.loadReport = loadReport;
exports.listReports = listReports;
exports.generateMarkdownReport = generateMarkdownReport;
exports.metricsToMarkdownTable = metricsToMarkdownTable;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
/**
 * Save a report as JSON
 */
function saveJsonReport(filename, data, outputDir = process.cwd()) {
    const outputPath = path.join(outputDir, filename);
    fs.writeFileSync(outputPath, JSON.stringify(data, null, 2));
    return outputPath;
}
/**
 * Create a timestamped filename
 */
function createTimestampedFilename(baseName, extension = 'json') {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    return `${baseName}-${timestamp}.${extension}`;
}
/**
 * Create a report with standard metadata
 */
function createReport(benchmarkType, data, additionalMeta) {
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
function loadReport(filepath) {
    try {
        const content = fs.readFileSync(filepath, 'utf-8');
        return JSON.parse(content);
    }
    catch {
        return null;
    }
}
/**
 * List available reports in a directory
 */
function listReports(dir = process.cwd(), pattern = /benchmark.*\.json$/) {
    try {
        return fs.readdirSync(dir)
            .filter(f => pattern.test(f))
            .map(f => path.join(dir, f))
            .sort()
            .reverse(); // Most recent first
    }
    catch {
        return [];
    }
}
/**
 * Generate a simple markdown report
 */
function generateMarkdownReport(title, sections) {
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
function metricsToMarkdownTable(metrics, options = {}) {
    const { headers = ['Metric', 'Value'], decimals = 2 } = options;
    let table = `| ${headers[0]} | ${headers[1]} |\n`;
    table += '|------|-------|\n';
    for (const [key, value] of Object.entries(metrics)) {
        const formattedValue = typeof value === 'number' ? value.toFixed(decimals) : value;
        table += `| ${key} | ${formattedValue} |\n`;
    }
    return table;
}
