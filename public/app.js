// API Configuration
const API_BASE = '/api/research';
const USER_ID = '1';

// State
const state = {
    currentSession: null,
    papers: [],
    selectedPaperIds: new Set(),
    chatMessages: [],
    reports: [],
    isLoading: false,
};

// DOM Elements
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => document.querySelectorAll(selector);

const elements = {
    // Sidebar
    newSessionBtn: $('#new-session-btn'),
    sessionsList: $('#sessions-list'),

    // Welcome
    welcomeScreen: $('#welcome-screen'),
    welcomeForm: $('#welcome-form'),
    welcomeQuery: $('#welcome-query'),

    // Session View
    sessionView: $('#session-view'),
    sessionTitle: $('#session-title'),
    sessionMeta: $('#session-meta'),
    sessionStatus: $('#session-status'),

    // Tabs
    tabs: $$('.tab'),
    papersTab: $('#papers-tab'),
    chatTab: $('#chat-tab'),
    reportTab: $('#report-tab'),

    // Papers
    papersCount: $('#papers-count'),
    selectionCount: $('#selection-count'),
    selectAllBtn: $('#select-all-btn'),
    generateBtn: $('#generate-btn'),
    papersList: $('#papers-list'),

    // Chat
    chatMessages: $('#chat-messages'),
    chatForm: $('#chat-form'),
    chatInput: $('#chat-input'),
    chatSubmit: $('#chat-submit'),

    // Report
    reportPlaceholder: $('#report-placeholder'),
    reportContent: $('#report-content'),

    // Loading
    loadingOverlay: $('#loading-overlay'),
    loadingText: $('#loading-text'),
    loadingProgress: $('#loading-progress'),
    progressBar: $('#progress-bar'),
};

// ============================================
// API Helper
// ============================================
async function api(endpoint, options = {}) {
    const response = await fetch(`${API_BASE}${endpoint}`, {
        ...options,
        headers: {
            'Content-Type': 'application/json',
            'X-User-Id': USER_ID,
            ...options.headers,
        },
    });

    if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Request failed' }));
        throw new Error(error.error || 'Request failed');
    }

    if (response.status === 204) return null;
    return response.json();
}

// ============================================
// Loading States with RAF Animation
// ============================================
let loadingAnimation = null;
let progressValue = 0;

function showLoading(text = 'Loading...', showProgress = false) {
    state.isLoading = true;
    elements.loadingText.textContent = text;
    elements.loadingOverlay.classList.remove('hidden');

    if (showProgress) {
        elements.loadingProgress.classList.remove('hidden');
        progressValue = 0;
        animateProgress();
    } else {
        elements.loadingProgress.classList.add('hidden');
    }
}

function animateProgress() {
    if (!state.isLoading) return;

    // Smooth progress animation using RAF
    const targetProgress = Math.min(progressValue + Math.random() * 2, 90);
    progressValue += (targetProgress - progressValue) * 0.1;
    elements.progressBar.style.width = `${progressValue}%`;

    loadingAnimation = requestAnimationFrame(animateProgress);
}

function hideLoading() {
    state.isLoading = false;

    // Complete progress bar before hiding
    if (loadingAnimation) {
        cancelAnimationFrame(loadingAnimation);
        elements.progressBar.style.width = '100%';
    }

    setTimeout(() => {
        elements.loadingOverlay.classList.add('hidden');
        elements.progressBar.style.width = '0%';
    }, 200);
}

function updateLoadingText(text) {
    elements.loadingText.textContent = text;
}

// ============================================
// Sessions
// ============================================
async function loadSessions() {
    try {
        const sessions = await api('/sessions?limit=15');
        renderSessions(sessions);
    } catch (err) {
        console.error('Failed to load sessions:', err);
    }
}

function renderSessions(sessions) {
    if (!sessions.length) {
        elements.sessionsList.innerHTML = `
            <div class="empty-state">
                <p>No sessions yet</p>
            </div>
        `;
        return;
    }

    elements.sessionsList.innerHTML = sessions.map(s => `
        <div class="session-item ${state.currentSession?.id === s.id ? 'active' : ''}" data-id="${s.id}">
            <div class="query">${escapeHtml(s.initial_query)}</div>
            <div class="meta">
                <span class="status">${s.status.replace('_', ' ')}</span>
            </div>
        </div>
    `).join('');

    // Add click handlers with animation
    elements.sessionsList.querySelectorAll('.session-item').forEach(item => {
        item.addEventListener('click', () => {
            const id = parseInt(item.dataset.id);
            loadSession(id);
        });
    });
}

async function createSession(query) {
    showLoading('Creating research session...', true);
    try {
        updateLoadingText('Initializing session...');
        const session = await api('/sessions', {
            method: 'POST',
            body: JSON.stringify({ query }),
        });

        state.currentSession = session;
        state.papers = [];
        state.selectedPaperIds.clear();
        state.chatMessages = [];
        state.reports = [];

        updateLoadingText('Searching papers...');
        await searchPapers();

        showSessionView();
        loadSessions();
    } catch (err) {
        alert('Failed to create session: ' + err.message);
    } finally {
        hideLoading();
    }
}

async function loadSession(sessionId) {
    showLoading('Loading session...', true);
    try {
        state.currentSession = await api(`/sessions/${sessionId}`);
        state.chatMessages = [];

        updateLoadingText('Loading papers...');
        if (['papers_ready', 'generating', 'completed'].includes(state.currentSession.status)) {
            await loadSessionPapers();
        }

        updateLoadingText('Loading reports...');
        if (state.currentSession.status === 'completed') {
            await loadReports();
        }

        showSessionView();
        loadSessions();
    } catch (err) {
        alert('Failed to load session: ' + err.message);
    } finally {
        hideLoading();
    }
}

function showSessionView() {
    elements.welcomeScreen.classList.add('hidden');
    elements.sessionView.classList.remove('hidden');

    const query = state.currentSession.refined_query || state.currentSession.initial_query;
    elements.sessionTitle.textContent = truncate(query, 60);
    elements.sessionMeta.textContent = `Session #${state.currentSession.id} · Created ${formatDate(state.currentSession.created_at)}`;
    updateStatus(state.currentSession.status);

    // Switch to papers tab
    switchTab('papers');
}

function showWelcomeScreen() {
    elements.sessionView.classList.add('hidden');
    elements.welcomeScreen.classList.remove('hidden');
    state.currentSession = null;
}

function updateStatus(status) {
    elements.sessionStatus.textContent = status.replace('_', ' ');
    elements.sessionStatus.className = 'status-pill ' + status;
}

// ============================================
// Papers
// ============================================
async function searchPapers() {
    try {
        const result = await api(`/sessions/${state.currentSession.id}/search`, {
            method: 'POST',
            body: JSON.stringify({ limit: 15 }),
        });

        state.papers = result.papers;
        state.selectedPaperIds.clear();
        renderPapers();
        updateStatus('papers_ready');
    } catch (err) {
        console.error('Failed to search papers:', err);
        throw err;
    }
}

async function loadSessionPapers() {
    try {
        const papers = await api(`/sessions/${state.currentSession.id}/papers`);
        state.papers = papers.map(p => p.paper);
        state.selectedPaperIds = new Set(
            papers.filter(p => p.user_selected).map(p => p.paper.id)
        );
        renderPapers();
    } catch (err) {
        console.error('Failed to load papers:', err);
    }
}

function renderPapers() {
    elements.papersCount.textContent = state.papers.length;
    updateSelectionCount();

    if (!state.papers.length) {
        elements.papersList.innerHTML = `
            <div class="empty-state">
                <p>No papers found</p>
            </div>
        `;
        return;
    }

    elements.papersList.innerHTML = state.papers.map((paper, index) => `
        <div class="paper-card ${state.selectedPaperIds.has(paper.id) ? 'selected' : ''}"
             data-id="${paper.id}"
             style="animation-delay: ${index * 0.05}s">
            <div class="paper-card-header">
                <div class="paper-checkbox">
                    <input type="checkbox" ${state.selectedPaperIds.has(paper.id) ? 'checked' : ''}>
                </div>
                <div class="paper-info">
                    <div class="paper-title">
                        <a href="${escapeHtml(paper.url)}" target="_blank" rel="noopener">
                            ${escapeHtml(paper.title)}
                        </a>
                    </div>
                    <div class="paper-authors">
                        ${formatAuthors(paper.authors)}
                    </div>
                    <div class="paper-meta">
                        <span class="paper-tag source">${paper.source}</span>
                        ${paper.year ? `<span class="paper-tag">${paper.year}</span>` : ''}
                        ${paper.venue ? `<span class="paper-tag">${escapeHtml(truncate(paper.venue, 30))}</span>` : ''}
                        ${paper.citation_count ? `<span class="paper-tag">${paper.citation_count} citations</span>` : ''}
                    </div>
                    ${paper.abstract ? `
                        <div class="paper-abstract">${escapeHtml(paper.abstract)}</div>
                    ` : ''}
                </div>
            </div>
        </div>
    `).join('');

    // Add click handlers
    elements.papersList.querySelectorAll('.paper-card').forEach(card => {
        const checkbox = card.querySelector('input[type="checkbox"]');
        const paperId = parseInt(card.dataset.id);

        card.addEventListener('click', (e) => {
            if (e.target.tagName === 'A') return;
            e.preventDefault();
            togglePaper(paperId);
        });

        checkbox.addEventListener('click', (e) => {
            e.stopPropagation();
            togglePaper(paperId);
        });
    });
}

function togglePaper(paperId) {
    if (state.selectedPaperIds.has(paperId)) {
        state.selectedPaperIds.delete(paperId);
    } else {
        state.selectedPaperIds.add(paperId);
    }

    // Update UI with animation
    const card = elements.papersList.querySelector(`[data-id="${paperId}"]`);
    const checkbox = card?.querySelector('input[type="checkbox"]');

    if (card) {
        card.classList.toggle('selected', state.selectedPaperIds.has(paperId));
    }
    if (checkbox) {
        checkbox.checked = state.selectedPaperIds.has(paperId);
    }

    updateSelectionCount();
}

function selectAllPapers() {
    const allSelected = state.selectedPaperIds.size === state.papers.length;

    if (allSelected) {
        state.selectedPaperIds.clear();
        elements.selectAllBtn.textContent = 'Select All';
    } else {
        state.papers.forEach(p => state.selectedPaperIds.add(p.id));
        elements.selectAllBtn.textContent = 'Deselect All';
    }

    renderPapers();
}

function updateSelectionCount() {
    const count = state.selectedPaperIds.size;
    elements.selectionCount.textContent = `${count} selected`;
    elements.generateBtn.disabled = count === 0;
    elements.selectAllBtn.textContent =
        count === state.papers.length ? 'Deselect All' : 'Select All';
}

// ============================================
// Chat
// ============================================
function renderChatMessages() {
    if (state.chatMessages.length === 0) {
        elements.chatMessages.innerHTML = `
            <div class="chat-welcome">
                <p>Ask questions about the papers in this session.</p>
                <p class="hint">The AI will analyze all ${state.papers.length} papers to answer your questions with citations.</p>
            </div>
        `;
        return;
    }

    elements.chatMessages.innerHTML = state.chatMessages.map(msg => `
        <div class="chat-message ${msg.role}">
            <div class="message-content">${formatMessage(msg.content)}</div>
            <div class="message-time">${formatTime(msg.timestamp)}</div>
        </div>
    `).join('');

    // Smooth scroll to bottom using RAF
    requestAnimationFrame(() => {
        elements.chatMessages.scrollTop = elements.chatMessages.scrollHeight;
    });
}

function addTypingIndicator() {
    const indicator = document.createElement('div');
    indicator.className = 'chat-message assistant';
    indicator.id = 'typing-indicator';
    indicator.innerHTML = `
        <div class="typing-indicator">
            <span></span>
            <span></span>
            <span></span>
        </div>
    `;
    elements.chatMessages.appendChild(indicator);

    requestAnimationFrame(() => {
        elements.chatMessages.scrollTop = elements.chatMessages.scrollHeight;
    });
}

function removeTypingIndicator() {
    const indicator = $('#typing-indicator');
    if (indicator) {
        indicator.remove();
    }
}

async function sendChatMessage(question) {
    // Add user message
    state.chatMessages.push({
        role: 'user',
        content: question,
        timestamp: new Date(),
    });
    renderChatMessages();

    // Show typing indicator
    addTypingIndicator();
    elements.chatInput.disabled = true;
    elements.chatSubmit.disabled = true;

    try {
        const result = await api(`/sessions/${state.currentSession.id}/ask`, {
            method: 'POST',
            body: JSON.stringify({ question }),
        });

        removeTypingIndicator();

        // Add assistant message with typewriter effect
        const assistantMessage = {
            role: 'assistant',
            content: result.answer,
            timestamp: new Date(),
        };
        state.chatMessages.push(assistantMessage);
        renderChatMessages();

    } catch (err) {
        removeTypingIndicator();
        state.chatMessages.push({
            role: 'assistant',
            content: 'Sorry, I encountered an error processing your question. Please try again.',
            timestamp: new Date(),
        });
        renderChatMessages();
    } finally {
        elements.chatInput.disabled = false;
        elements.chatSubmit.disabled = false;
        elements.chatInput.focus();
    }
}

// ============================================
// Reports
// ============================================
async function loadReports() {
    try {
        const reports = await api(`/sessions/${state.currentSession.id}/reports`);
        state.reports = reports;
        if (reports.length > 0) {
            renderReport(reports[0]);
        }
    } catch (err) {
        console.error('Failed to load reports:', err);
    }
}

async function generateReport() {
    if (state.selectedPaperIds.size === 0) {
        alert('Please select at least one paper');
        return;
    }

    showLoading('Generating literature review...', true);

    try {
        updateLoadingText('Saving paper selections...');
        await api(`/sessions/${state.currentSession.id}/select`, {
            method: 'POST',
            body: JSON.stringify({ paper_ids: Array.from(state.selectedPaperIds) }),
        });

        updateLoadingText('Analyzing papers...');
        await sleep(500);

        updateLoadingText('Writing literature review...');
        const report = await api(`/sessions/${state.currentSession.id}/report`, {
            method: 'POST',
            body: JSON.stringify({ report_type: 'literature_review' }),
        });

        state.reports = [report];
        renderReport(report);
        updateStatus('completed');

        // Switch to report tab
        switchTab('report');
    } catch (err) {
        alert('Failed to generate report: ' + err.message);
    } finally {
        hideLoading();
    }
}

function renderReport(report) {
    elements.reportPlaceholder.classList.add('hidden');
    elements.reportContent.classList.remove('hidden');

    // Format report content with markdown-like styling
    const formattedContent = formatReportContent(report.content);
    elements.reportContent.innerHTML = formattedContent;

    // Add citations section if available
    if (report.citations && report.citations.length > 0) {
        const citationsHtml = `
            <div class="report-citations">
                <h3>References</h3>
                <ol>
                    ${report.citations.map(c => `
                        <li>
                            <strong>${escapeHtml(c.title)}</strong><br>
                            <span>${escapeHtml(c.authors)}${c.year ? ` (${c.year})` : ''}${c.venue ? ` - ${escapeHtml(c.venue)}` : ''}</span>
                        </li>
                    `).join('')}
                </ol>
            </div>
        `;
        elements.reportContent.innerHTML += citationsHtml;
    }
}

function formatReportContent(content) {
    // Simple markdown-like formatting
    let formatted = escapeHtml(content);

    // Headers
    formatted = formatted.replace(/^### (.+)$/gm, '<h3>$1</h3>');
    formatted = formatted.replace(/^## (.+)$/gm, '<h2>$1</h2>');
    formatted = formatted.replace(/^# (.+)$/gm, '<h1>$1</h1>');

    // Bold
    formatted = formatted.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

    // Italic
    formatted = formatted.replace(/\*(.+?)\*/g, '<em>$1</em>');

    // Citations [1], [2], etc.
    formatted = formatted.replace(/\[(\d+)\]/g, '<span class="citation">[$1]</span>');

    // Paragraphs
    formatted = formatted.split('\n\n').map(p => {
        if (p.startsWith('<h') || p.trim() === '') return p;
        return `<p>${p.replace(/\n/g, '<br>')}</p>`;
    }).join('');

    return formatted;
}

// ============================================
// Tabs
// ============================================
function switchTab(tabName) {
    // Update tab buttons
    elements.tabs.forEach(tab => {
        tab.classList.toggle('active', tab.dataset.tab === tabName);
    });

    // Update tab panels
    elements.papersTab.classList.toggle('hidden', tabName !== 'papers');
    elements.chatTab.classList.toggle('hidden', tabName !== 'chat');
    elements.reportTab.classList.toggle('hidden', tabName !== 'report');

    // Render chat messages when switching to chat tab
    if (tabName === 'chat') {
        renderChatMessages();
    }
}

// ============================================
// Utility Functions
// ============================================
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function truncate(text, maxLength) {
    if (!text || text.length <= maxLength) return text;
    return text.slice(0, maxLength) + '...';
}

function formatAuthors(authors) {
    if (!authors || !authors.length) return 'Unknown authors';
    const names = authors.slice(0, 3).map(a => a.name);
    if (authors.length > 3) {
        names.push(`+${authors.length - 3} more`);
    }
    return names.join(', ');
}

function formatDate(dateString) {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
    });
}

function formatTime(date) {
    return new Date(date).toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
    });
}

function formatMessage(content) {
    // Format citations in chat messages
    let formatted = escapeHtml(content);
    formatted = formatted.replace(/\[(\d+)\]/g, '<span class="citation">[$1]</span>');
    formatted = formatted.replace(/\n/g, '<br>');
    return formatted;
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================
// Event Listeners
// ============================================
function initEventListeners() {
    // New session button
    elements.newSessionBtn.addEventListener('click', () => {
        showWelcomeScreen();
    });

    // Welcome form
    elements.welcomeForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const query = elements.welcomeQuery.value.trim();
        if (query) {
            createSession(query);
            elements.welcomeQuery.value = '';
        }
    });

    // Suggestion buttons
    $$('.suggestion').forEach(btn => {
        btn.addEventListener('click', () => {
            const query = btn.dataset.query;
            elements.welcomeQuery.value = query;
            createSession(query);
        });
    });

    // Tab switching
    elements.tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            switchTab(tab.dataset.tab);
        });
    });

    // Select all button
    elements.selectAllBtn.addEventListener('click', selectAllPapers);

    // Generate report button
    elements.generateBtn.addEventListener('click', generateReport);

    // Chat form
    elements.chatForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const question = elements.chatInput.value.trim();
        if (question && !elements.chatInput.disabled) {
            sendChatMessage(question);
            elements.chatInput.value = '';
        }
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        // Ctrl/Cmd + Enter to generate report
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            if (state.currentSession && state.selectedPaperIds.size > 0) {
                generateReport();
            }
        }
    });
}

// ============================================
// Initialize
// ============================================
function init() {
    initEventListeners();
    loadSessions();

    // Focus on query input
    elements.welcomeQuery.focus();
}

// Start the app
init();
