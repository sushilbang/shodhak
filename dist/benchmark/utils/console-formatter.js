"use strict";
/**
 * Console Formatter Utility
 * Consistent console output formatting for benchmarks
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.printHeader = printHeader;
exports.printSection = printSection;
exports.printDivider = printDivider;
exports.printTable = printTable;
exports.printKeyValue = printKeyValue;
exports.printMetricDelta = printMetricDelta;
exports.printProgress = printProgress;
exports.clearLine = clearLine;
exports.printList = printList;
exports.printVerdict = printVerdict;
/**
 * Print a boxed header
 */
function printHeader(title, width = 50) {
    const padding = Math.max(0, width - title.length - 4);
    const leftPad = Math.floor(padding / 2);
    const rightPad = padding - leftPad;
    console.log('\n' + '╔' + '═'.repeat(width - 2) + '╗');
    console.log('║' + ' '.repeat(leftPad + 1) + title + ' '.repeat(rightPad + 1) + '║');
    console.log('╚' + '═'.repeat(width - 2) + '╝\n');
}
/**
 * Print a section header (lighter style)
 */
function printSection(title) {
    console.log('\n' + '═'.repeat(40));
    console.log('  ' + title);
    console.log('═'.repeat(40) + '\n');
}
/**
 * Print a simple divider
 */
function printDivider(char = '─', width = 60) {
    console.log(char.repeat(width));
}
/**
 * Print a table with custom columns
 */
function printTable(columns, rows) {
    // Header
    const headerSep = '┌' + columns.map(c => '─'.repeat(c.width)).join('┬') + '┐';
    const headerRow = '│' + columns.map(c => padCell(c.header, c.width, 'center')).join('│') + '│';
    const headerEnd = '├' + columns.map(c => '─'.repeat(c.width)).join('┼') + '┤';
    console.log(headerSep);
    console.log(headerRow);
    console.log(headerEnd);
    // Data rows
    for (const row of rows) {
        const cells = row.map((cell, i) => {
            const col = columns[i];
            return padCell(cell, col.width, col.align || 'left');
        });
        console.log('│' + cells.join('│') + '│');
    }
    // Footer
    const footer = '└' + columns.map(c => '─'.repeat(c.width)).join('┴') + '┘';
    console.log(footer);
}
/**
 * Pad a cell value to fit column width
 */
function padCell(value, width, align) {
    const str = String(value).slice(0, width - 2);
    const padding = width - str.length - 2;
    switch (align) {
        case 'right':
            return ' '.repeat(padding + 1) + str + ' ';
        case 'center':
            const left = Math.floor(padding / 2);
            const right = padding - left;
            return ' '.repeat(left + 1) + str + ' '.repeat(right + 1);
        default:
            return ' ' + str + ' '.repeat(padding + 1);
    }
}
/**
 * Print key-value pairs
 */
function printKeyValue(pairs, indent = 2) {
    const prefix = ' '.repeat(indent);
    const maxKeyLength = Math.max(...Object.keys(pairs).map(k => k.length));
    for (const [key, value] of Object.entries(pairs)) {
        console.log(`${prefix}${key.padEnd(maxKeyLength)}: ${value}`);
    }
}
/**
 * Print a metric with delta indicator
 */
function printMetricDelta(label, value, unit = '', decimals = 1) {
    const sign = value >= 0 ? '+' : '';
    const formatted = `${sign}${value.toFixed(decimals)}${unit}`;
    console.log(`  ${label}: ${formatted}`);
}
/**
 * Print a progress indicator
 */
function printProgress(current, total, label = '') {
    const percentage = Math.round((current / total) * 100);
    const filled = Math.round(percentage / 5);
    const bar = '█'.repeat(filled) + '░'.repeat(20 - filled);
    process.stdout.write(`\r  [${bar}] ${percentage}% ${label}`);
}
/**
 * Clear the current line (for progress updates)
 */
function clearLine() {
    process.stdout.write('\r' + ' '.repeat(80) + '\r');
}
/**
 * Print a list with checkmarks or indicators
 */
function printList(items, marker = '○') {
    for (const item of items) {
        console.log(`  ${marker} ${item}`);
    }
}
/**
 * Print a verdict box
 */
function printVerdict(verdict, message) {
    const icons = { success: '✓', warning: '○', failure: '✗' };
    const labels = { success: 'PASS', warning: 'WARN', failure: 'FAIL' };
    console.log('\n' + '─'.repeat(60));
    console.log(`${icons[verdict]} ${labels[verdict]}: ${message}`);
}
