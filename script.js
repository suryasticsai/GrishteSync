// ======================== GRISHTESYNC FULL SCRIPT ========================
// Includes: Monaco editor, file management, undo/delete, drafts (GitHub Gists),
// console with filtering/search/commands, theme, share, deploy, diagnose, preview, etc.



// ========== Configuration ==========
const API_BASE = "https://grishtesync-backend.onrender.com";
let githubToken = localStorage.getItem("github_token");
let githubUser = localStorage.getItem("github_user");
let generatedFiles = {};
let currentFile = null;
let editor = null;
let deployments = JSON.parse(localStorage.getItem("deployments") || "[]");
let currentPlatform = 'python';
let previewMode = false;
let undoStack = [];

// ========== DOM Helpers ==========
const $ = id => document.getElementById(id);

// ========== Console System (Enhanced) ==========
let consoleLines = []; // store { text, type, timestamp }
let currentFilter = 'all';
let searchTerm = '';

function appendToConsole(msg, type = 'info') {
    const consoleDiv = $('console');
    if (!consoleDiv) return;
    const line = document.createElement('div');
    line.className = `console-line ${type}`;
    const timestamp = new Date().toLocaleTimeString();
    line.textContent = `[${timestamp}] ${msg}`;
    consoleDiv.appendChild(line);
    line.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    consoleLines.push({ text: msg, type, timestamp, element: line });
    applyConsoleFilters();
}

function clearConsole() {
    const consoleDiv = $('console');
    if (consoleDiv) consoleDiv.innerHTML = '';
    consoleLines = [];
    appendToConsole('Console cleared.', 'info');
}

function applyConsoleFilters() {
    const consoleDiv = $('console');
    if (!consoleDiv) return;
    for (const log of consoleLines) {
        if (!log.element) continue;
        const matchesFilter = currentFilter === 'all' || log.type === currentFilter;
        const matchesSearch = !searchTerm || log.text.toLowerCase().includes(searchTerm.toLowerCase());
        log.element.style.display = (matchesFilter && matchesSearch) ? 'block' : 'none';
    }
}

function setupConsoleFilters() {
    const filterContainer = document.createElement('div');
    filterContainer.className = 'console-toolbar';
    filterContainer.innerHTML = `
        <div class="console-filter">
            <button data-filter="all" class="active">All</button>
            <button data-filter="success">Success</button>
            <button data-filter="error">Error</button>
            <button data-filter="warning">Warning</button>
            <button data-filter="info">Info</button>
        </div>
        <div class="console-actions">
            <input type="text" id="console-search" placeholder="Search logs..." />
            <button id="console-export">📋 Export</button>
            <button id="console-clear">🗑️ Clear</button>
        </div>
        <div class="console-command">
            <span style="color:#10b981;">$</span>
            <input type="text" id="console-input" placeholder="Type a command (help for list)..." />
        </div>
    `;
    const consoleContainer = $('console')?.parentNode;
    if (consoleContainer && !document.querySelector('.console-toolbar')) {
        consoleContainer.insertBefore(filterContainer, $('console'));
    }
    // Filter buttons
    document.querySelectorAll('.console-filter button').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.console-filter button').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentFilter = btn.dataset.filter;
            applyConsoleFilters();
        });
    });
    // Search
    const searchInput = document.getElementById('console-search');
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            searchTerm = e.target.value;
            applyConsoleFilters();
        });
    }
    // Export
    const exportBtn = document.getElementById('console-export');
    if (exportBtn) {
        exportBtn.addEventListener('click', () => {
            const logsText = consoleLines.map(l => `[${l.timestamp}] ${l.text}`).join('\n');
            const blob = new Blob([logsText], { type: 'text/plain' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = `grishtesync-console-${Date.now()}.log`;
            a.click();
            URL.revokeObjectURL(a.href);
            appendToConsole('Console logs exported.', 'success');
        });
    }
    // Command input
    const cmdInput = document.getElementById('console-input');
    if (cmdInput) {
        cmdInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                const cmd = cmdInput.value.trim();
                if (cmd) handleConsoleCommand(cmd);
                cmdInput.value = '';
            }
        });
    }
}

async function handleConsoleCommand(cmd) {
    const parts = cmd.split(' ');
    const command = parts[0].toLowerCase();
    const args = parts.slice(1);
    switch (command) {
        case 'help':
            appendToConsole('Available commands: help, clear, ls, save, load, list, deploy, theme, export', 'info');
            break;
        case 'clear':
            clearConsole();
            break;
        case 'ls':
            appendToConsole(`Files: ${Object.keys(generatedFiles).join(', ') || 'none'}`, 'info');
            break;
        case 'save':
            if (args[0]) await saveAsDraft(args[0]);
            else appendToConsole('Usage: save <draft-name>', 'error');
            break;
        case 'load':
            if (args[0]) await loadDraftByName(args.join(' '));
            else appendToConsole('Usage: load <draft-name>', 'error');
            break;
        case 'list':
            await loadDraftsList();
            break;
        case 'deploy':
            if (args[0] === 'github') await deployToGitHub();
            else if (args[0] === 'hf') await deployToHF();
            else appendToConsole('Usage: deploy github|hf', 'error');
            break;
        case 'theme':
            document.body.classList.toggle('light');
            localStorage.setItem('theme', document.body.classList.contains('light') ? 'light' : 'dark');
            appendToConsole(`Theme switched to ${document.body.classList.contains('light') ? 'light' : 'dark'}`, 'success');
            break;
        case 'export':
            await exportToGist();
            break;
        default:
            appendToConsole(`Unknown command: ${command}. Type 'help' for available commands.`, 'error');
    }
}

// ========== Theme ==========
function initTheme() {
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme === 'light') document.body.classList.add('light');
    const themeBtn = $('themeToggleBtn');
    if (themeBtn) {
        themeBtn.onclick = () => {
            document.body.classList.toggle('light');
            localStorage.setItem('theme', document.body.classList.contains('light') ? 'light' : 'dark');
        };
    }
}

// ========== Share latest deployment ==========
async function shareLatestUrl() {
    const latestDeploy = deployments[0];
    if (!latestDeploy) { appendToConsole('No deployments found to share.', 'warning'); return; }
    const url = latestDeploy.hfUrl || latestDeploy.githubUrl || latestDeploy.pagesUrl;
    if (url) {
        await navigator.clipboard.writeText(url);
        appendToConsole(`✅ Copied URL to clipboard: ${url}`, 'success');
    } else { appendToConsole('No live URL available.', 'error'); }
}

// ========== Export current files as ad-hoc Gist ==========
async function exportToGist() {
    if (!githubToken) { appendToConsole('Connect GitHub first.', 'error'); return; }
    if (Object.keys(generatedFiles).length === 0) { appendToConsole('No files to export.', 'error'); return; }
    const gistFiles = {};
    for (const [name, content] of Object.entries(generatedFiles)) {
        gistFiles[name] = { content };
    }
    try {
        const res = await fetch('https://api.github.com/gists', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${githubToken}`, 'Accept': 'application/vnd.github.v3+json' },
            body: JSON.stringify({
                description: `App generated by GrishteSync: ${$('appName').value.trim()}`,
                public: false,
                files: gistFiles
            })
        });
        const data = await res.json();
        if (data.html_url) {
            await navigator.clipboard.writeText(data.html_url);
            appendToConsole(`✅ Gist created and URL copied: ${data.html_url}`, 'success');
        } else throw new Error(data.message || 'Failed to create gist');
    } catch(e) { appendToConsole(`❌ Gist failed: ${e.message}`, 'error'); }
}

// ========== Undo Delete ==========
function pushToUndo(action) {
    undoStack.push(action);
    if (undoStack.length > 50) undoStack.shift();
    setTimeout(() => {
        const index = undoStack.indexOf(action);
        if (index !== -1) undoStack.splice(index, 1);
    }, 30000);
}

function undoDelete() {
    if (undoStack.length === 0) { appendToConsole("Nothing to undo.", 'warning'); return; }
    const action = undoStack.pop();
    if (action.type === 'delete') {
        generatedFiles[action.filename] = action.content;
        appendToConsole(`↩️ Restored file: ${action.filename}`, 'success');
        renderFileTabs();
        openFile(action.filename);
    }
}

// ========== Draft Manager (GitHub Gists) ==========
let currentDraftGistId = null;

async function saveAsDraft(draftName = null) {
    if (!githubToken) { appendToConsole('Connect GitHub first to save drafts.', 'error'); return; }
    if (!draftName) draftName = prompt("Enter a name for this draft:", $('appName').value.trim() || "Untitled Draft");
    if (!draftName) return;
    const draftData = {
        draftName: draftName,
        appName: $('appName').value.trim(),
        projectType: $('projectType').value,
        aiMode: $('aiMode').value,
        prompt: $('prompt').value,
        files: generatedFiles,
        currentPlatform: currentPlatform,
        previewMode: previewMode,
        currentFile: currentFile,
        timestamp: Date.now()
    };
    let gistId = currentDraftGistId;
    let isUpdate = false;
    let existingGist = null;
    if (gistId) {
        try {
            const res = await fetch(`https://api.github.com/gists/${gistId}`, { headers: { 'Authorization': `Bearer ${githubToken}` } });
            if (res.ok) existingGist = await res.json();
        } catch(e) { console.error(e); }
    }
    const filesForGist = { "draft.json": { content: JSON.stringify(draftData, null, 2) } };
    if (existingGist) {
        const res = await fetch(`https://api.github.com/gists/${gistId}`, {
            method: 'PATCH',
            headers: { 'Authorization': `Bearer ${githubToken}`, 'Accept': 'application/vnd.github.v3+json' },
            body: JSON.stringify({ files: filesForGist })
        });
        if (res.ok) isUpdate = true;
        else throw new Error("Failed to update draft");
    } else {
        const res = await fetch('https://api.github.com/gists', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${githubToken}`, 'Accept': 'application/vnd.github.v3+json' },
            body: JSON.stringify({
                description: `GrishteSync Draft: ${draftName}`,
                public: false,
                files: filesForGist
            })
        });
        const data = await res.json();
        if (data.id) {
            gistId = data.id;
            isUpdate = false;
        } else throw new Error("Failed to create draft");
    }
    currentDraftGistId = gistId;
    appendToConsole(`✅ Draft "${draftName}" ${isUpdate ? 'updated' : 'saved'} successfully!`, 'success');
    await loadDraftsList();
}

async function loadDraftsList() {
    if (!githubToken) { appendToConsole('Connect GitHub to load drafts.', 'error'); return; }
    const res = await fetch(`https://api.github.com/gists?per_page=50`, { headers: { 'Authorization': `Bearer ${githubToken}` } });
    if (!res.ok) { appendToConsole('Failed to load drafts.', 'error'); return; }
    const gists = await res.json();
    const drafts = [];
    for (const gist of gists) {
        if (gist.description && gist.description.startsWith('GrishteSync Draft:')) {
            try {
                const draftFile = gist.files['draft.json'];
                if (!draftFile) continue;
                const fileRes = await fetch(draftFile.raw_url);
                const draftData = await fileRes.json();
                drafts.push({
                    gistId: gist.id,
                    name: draftData.draftName,
                    timestamp: draftData.timestamp,
                    data: draftData
                });
            } catch(e) { console.error(e); }
        }
    }
    drafts.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    showDraftsModal(drafts);
}

function showDraftsModal(drafts) {
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    Object.assign(modal.style, {
        position: 'fixed', top: '0', left: '0', width: '100%', height: '100%',
        backgroundColor: 'rgba(0,0,0,0.7)', zIndex: '1000',
        display: 'flex', alignItems: 'center', justifyContent: 'center'
    });
    const modalContent = document.createElement('div');
    Object.assign(modalContent.style, {
        backgroundColor: '#1e1e2e', borderRadius: '12px', width: '600px',
        maxWidth: '90%', maxHeight: '80%', overflow: 'auto', padding: '20px', color: '#e2e8f0'
    });
    modalContent.innerHTML = `
        <h2 style="margin-bottom: 16px;">Saved Drafts</h2>
        <div id="drafts-list" style="max-height: 400px; overflow-y: auto;">
            ${drafts.length === 0 ? '<p>No drafts found.</p>' : drafts.map(draft => `
                <div class="draft-item" data-gistid="${draft.gistId}" style="padding: 12px; border-bottom: 1px solid #2a2a3a; display: flex; justify-content: space-between; align-items: center;">
                    <div><strong>${escapeHtml(draft.name)}</strong><br><span style="font-size: 0.7rem;">${new Date(draft.timestamp).toLocaleString()}</span></div>
                    <div>
                        <button class="load-draft-btn" data-gistid="${draft.gistId}" style="margin-right: 8px; padding: 4px 8px; background: #10b981; color: white; border: none; border-radius: 4px; cursor: pointer;">Load</button>
                        <button class="rename-draft-btn" data-gistid="${draft.gistId}" data-name="${escapeHtml(draft.name)}" style="margin-right: 8px; padding: 4px 8px; background: #f59e0b; color: white; border: none; border-radius: 4px; cursor: pointer;">Rename</button>
                        <button class="delete-draft-btn" data-gistid="${draft.gistId}" style="padding: 4px 8px; background: #ef4444; color: white; border: none; border-radius: 4px; cursor: pointer;">Delete</button>
                    </div>
                </div>
            `).join('')}
        </div>
        <div style="margin-top: 16px; text-align: right;">
            <button id="close-drafts-modal" style="padding: 8px 16px; background: #2a2a3a; color: white; border: none; border-radius: 4px; cursor: pointer;">Close</button>
        </div>
    `;
    modal.appendChild(modalContent);
    document.body.appendChild(modal);
    modalContent.querySelectorAll('.load-draft-btn').forEach(btn => {
        btn.addEventListener('click', () => loadDraft(btn.dataset.gistid));
    });
    modalContent.querySelectorAll('.rename-draft-btn').forEach(btn => {
        btn.addEventListener('click', () => renameDraft(btn.dataset.gistid, btn.dataset.name));
    });
    modalContent.querySelectorAll('.delete-draft-btn').forEach(btn => {
        btn.addEventListener('click', () => deleteDraft(btn.dataset.gistid));
    });
    modalContent.querySelector('#close-drafts-modal').onclick = () => modal.remove();
}

function escapeHtml(str) {
    return str.replace(/[&<>]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[m]));
}

async function loadDraft(gistId) {
    try {
        const res = await fetch(`https://api.github.com/gists/${gistId}`, { headers: { 'Authorization': `Bearer ${githubToken}` } });
        const gist = await res.json();
        const draftFile = gist.files['draft.json'];
        if (!draftFile) throw new Error('No draft.json found');
        const draftRes = await fetch(draftFile.raw_url);
        const draftData = await draftRes.json();
        $('appName').value = draftData.appName || '';
        $('projectType').value = draftData.projectType || 'python';
        $('aiMode').value = draftData.aiMode || 'generate';
        $('prompt').value = draftData.prompt || '';
        generatedFiles = draftData.files || {};
        currentPlatform = draftData.currentPlatform || 'python';
        previewMode = draftData.previewMode || false;
        currentFile = draftData.currentFile || null;
        renderFileTabs();
        if (currentFile && generatedFiles[currentFile]) openFile(currentFile);
        else if (Object.keys(generatedFiles).length > 0) openFile(Object.keys(generatedFiles)[0]);
        appendToConsole(`✅ Draft "${draftData.draftName}" loaded.`, 'success');
        document.querySelector('.modal-overlay')?.remove();
    } catch(e) { appendToConsole(`❌ Failed to load draft: ${e.message}`, 'error'); }
}

async function renameDraft(gistId, oldName) {
    const newName = prompt("Enter new name:", oldName);
    if (!newName || newName === oldName) return;
    try {
        const res = await fetch(`https://api.github.com/gists/${gistId}`, { headers: { 'Authorization': `Bearer ${githubToken}` } });
        const gist = await res.json();
        const draftFile = gist.files['draft.json'];
        if (!draftFile) throw new Error('No draft.json found');
        const draftRes = await fetch(draftFile.raw_url);
        const draftData = await draftRes.json();
        draftData.draftName = newName;
        const updateRes = await fetch(`https://api.github.com/gists/${gistId}`, {
            method: 'PATCH',
            headers: { 'Authorization': `Bearer ${githubToken}`, 'Accept': 'application/vnd.github.v3+json' },
            body: JSON.stringify({
                description: `GrishteSync Draft: ${newName}`,
                files: { "draft.json": { content: JSON.stringify(draftData, null, 2) } }
            })
        });
        if (updateRes.ok) {
            appendToConsole(`✅ Draft renamed to "${newName}".`, 'success');
            await loadDraftsList();
        } else throw new Error("Rename failed");
    } catch(e) { appendToConsole(`❌ Rename failed: ${e.message}`, 'error'); }
}

async function deleteDraft(gistId) {
    if (!confirm("Are you sure you want to delete this draft?")) return;
    try {
        const res = await fetch(`https://api.github.com/gists/${gistId}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${githubToken}` }
        });
        if (res.ok) {
            appendToConsole(`✅ Draft deleted.`, 'success');
            await loadDraftsList();
        } else throw new Error("Delete failed");
    } catch(e) { appendToConsole(`❌ Delete failed: ${e.message}`, 'error'); }
}

async function loadDraftByName(name) {
    const res = await fetch(`https://api.github.com/gists?per_page=50`, { headers: { 'Authorization': `Bearer ${githubToken}` } });
    const gists = await res.json();
    for (const gist of gists) {
        if (gist.description && gist.description.startsWith('GrishteSync Draft:')) {
            const draftFile = gist.files['draft.json'];
            if (!draftFile) continue;
            const fileRes = await fetch(draftFile.raw_url);
            const draftData = await fileRes.json();
            if (draftData.draftName === name) {
                await loadDraft(gist.id);
                return;
            }
        }
    }
    appendToConsole(`Draft "${name}" not found.`, 'error');
}

// ========== Monaco Editor ==========
require.config({ paths: { vs: 'https://cdn.jsdelivr.net/npm/monaco-editor@0.45.0/min/vs' } });
require(['vs/editor/editor.main'], function() {
    editor = monaco.editor.create(document.getElementById('editor-container'), {
        value: '// Generate or select a file',
        language: 'python',
        theme: 'vs-dark',
        automaticLayout: true,
        minimap: { enabled: false },
        fontSize: 13
    });
});

function getLanguage(filename) {
    const ext = filename.split('.').pop();
    const map = { py: 'python', js: 'javascript', html: 'html', css: 'css', json: 'json', md: 'markdown', txt: 'text' };
    return map[ext] || 'text';
}

function openFile(filename) {
    currentFile = filename;
    if (editor && generatedFiles[filename]) {
        editor.setValue(generatedFiles[filename]);
        monaco.editor.setModelLanguage(editor.getModel(), getLanguage(filename));
        renderFileTabs();
        if (previewMode && filename === 'index.html') refreshPreview();
    }
}

function renderFileTabs() {
    const tabsDiv = $('fileTabs');
    if (!tabsDiv) return;
    tabsDiv.innerHTML = '';
    for (const [name] of Object.entries(generatedFiles)) {
        const tab = document.createElement('div');
        tab.className = `file-tab ${currentFile === name ? 'active' : ''}`;
        tab.innerHTML = `<span>${name}</span><button class="delete-file-btn" data-filename="${name}">&times;</button>`;
        tab.onclick = (e) => { if (e.target !== tab.querySelector('button')) openFile(name); };
        tabsDiv.appendChild(tab);
    }
    document.querySelectorAll('.delete-file-btn').forEach(btn => {
        btn.onclick = (e) => {
            e.stopPropagation();
            const name = btn.dataset.filename;
            if (generatedFiles[name]) {
                pushToUndo({ type: 'delete', filename: name, content: generatedFiles[name] });
                delete generatedFiles[name];
                if (currentFile === name) {
                    currentFile = null;
                    if (editor) editor.setValue('// File deleted');
                }
                renderFileTabs();
                appendToConsole(`🗑️ Deleted ${name}. Use "Undo Delete" to restore.`, 'warning');
            }
        };
    });
}

function saveCurrentFile() {
    if (currentFile && editor) {
        generatedFiles[currentFile] = editor.getValue();
        appendToConsole(`✅ Saved ${currentFile}`, 'success');
        if (previewMode && currentFile === 'index.html') refreshPreview();
    }
}

function downloadZip() {
    if (Object.keys(generatedFiles).length === 0) return appendToConsole("❌ No files to download", 'error');
    const zip = new JSZip();
    for (const [name, content] of Object.entries(generatedFiles)) zip.file(name, content);
    zip.generateAsync({ type: 'blob' }).then(blob => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `${$('appName').value.trim() || 'app'}.zip`;
        a.click();
        URL.revokeObjectURL(a.href);
        appendToConsole("📦 Downloaded ZIP", 'success');
    });
}

// ========== Preview ==========
function buildPreviewHTML() {
    if (!generatedFiles['index.html']) return '<div style="padding:20px;">No index.html to preview</div>';
    let html = generatedFiles['index.html'];
    if (generatedFiles['style.css'] && !html.includes('style.css')) {
        html = html.replace('</head>', '<link rel="stylesheet" href="data:text/css;base64,' + btoa(generatedFiles['style.css']) + '">\n</head>');
    }
    if (generatedFiles['script.js'] && !html.includes('script.js')) {
        html = html.replace('</body>', '<script src="data:text/javascript;base64,' + btoa(generatedFiles['script.js']) + '"><\/script>\n</body>');
    }
    return html;
}

function loadSpacePreview(url) {
    const container = $('preview-iframe-container');
    const statusDiv = $('preview-status');
    if (!url.includes('huggingface.co/spaces/')) {
        if (statusDiv) statusDiv.innerHTML = '❌ Invalid Space URL.';
        if (container) container.innerHTML = '';
        return;
    }
    if (statusDiv) statusDiv.innerHTML = '🔄 Loading Space...';
    if (container) container.innerHTML = `<iframe src="${url}" style="width:100%; height:100%; border:none;" sandbox="allow-same-origin allow-scripts allow-popups allow-forms allow-downloads"></iframe>`;
    if (statusDiv) statusDiv.innerHTML = '✅ Preview loaded.';
    localStorage.setItem('previewSpaceUrl', url);
}

function refreshPreview() {
    const controls = $('preview-controls');
    const iframeContainer = $('preview-iframe-container');
    const statusDiv = $('preview-status');
    if (iframeContainer) iframeContainer.innerHTML = '';
    if (currentPlatform === 'web' && generatedFiles['index.html']) {
        if (controls) controls.style.display = 'none';
        const iframe = document.createElement('iframe');
        iframe.srcdoc = buildPreviewHTML();
        iframe.style.width = '100%';
        iframe.style.height = '100%';
        iframe.style.border = 'none';
        iframeContainer.appendChild(iframe);
    } else {
        if (controls) controls.style.display = 'flex';
        const lastHfDeploy = deployments.find(d => d.hfUrl);
        let spaceUrl = localStorage.getItem('previewSpaceUrl') || (lastHfDeploy ? lastHfDeploy.hfUrl : '');
        if (spaceUrl) {
            if ($('customSpaceUrl')) $('customSpaceUrl').value = spaceUrl;
            loadSpacePreview(spaceUrl);
        } else {
            if (statusDiv) statusDiv.innerHTML = 'No HF Space URL. Paste one above to preview.';
            if (iframeContainer) iframeContainer.innerHTML = '<div style="padding:20px; text-align:center;">Preview not available.</div>';
        }
    }
}

function togglePreview() {
    previewMode = !previewMode;
    const editorDiv = $('editor-container');
    const previewDiv = $('preview-container');
    const toggleBtn = $('previewToggleBtn');
    if (previewMode) {
        if (editorDiv) editorDiv.style.display = 'none';
        if (previewDiv) previewDiv.style.display = 'flex';
        if (toggleBtn) toggleBtn.innerHTML = '<i class="fas fa-code"></i> Code';
        refreshPreview();
    } else {
        if (editorDiv) editorDiv.style.display = 'flex';
        if (previewDiv) previewDiv.style.display = 'none';
        if (toggleBtn) toggleBtn.innerHTML = '<i class="fas fa-eye"></i> Preview';
    }
}

// ========== Load Repos from Backend ==========
async function loadRepos(platform) {
    const repoSelect = $('repoSelect');
    if (!repoSelect) return;
    repoSelect.innerHTML = '<option value="">-- Loading... --</option>';
    const token = platform === 'github' ? githubToken : null;
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    try {
        const res = await fetch(`${API_BASE}/api/list-repos?platform=${platform}`, { headers });
        const data = await res.json();
        repoSelect.innerHTML = '<option value="">-- Create new --</option>';
        if (data.repos && data.repos.length) {
            data.repos.forEach(repo => {
                const opt = document.createElement('option');
                opt.value = repo.full_name;
                opt.textContent = `${repo.name} (${platform === 'github' ? 'GitHub' : 'HF Space'})`;
                repoSelect.appendChild(opt);
            });
        } else {
            repoSelect.innerHTML = '<option value="">-- No existing repos found --</option>';
        }
    } catch(e) {
        console.error(e);
        repoSelect.innerHTML = '<option value="">-- Error loading --</option>';
        appendToConsole(`⚠️ Failed to load ${platform} repos: ${e.message}`, 'warning');
    }
}

// ========== Generate App ==========
async function generateApp() {
    const appName = $('appName')?.value.trim();
    const prompt = $('prompt')?.value.trim();
    const mode = $('aiMode')?.value;
    const projectType = $('projectType')?.value;
    const selectedRepo = $('repoSelect')?.value;
    if (!appName || !prompt) return appendToConsole("❌ App name and prompt required", 'error');
    const genBtn = $('generateBtn');
    if (genBtn) {
        genBtn.disabled = true;
        genBtn.innerHTML = '<i class="fas fa-spinner fa-pulse"></i> Generating...';
    }
    appendToConsole(`🤖 Generating ${mode} for "${appName}"...`, 'info');
    try {
        const res = await fetch(`${API_BASE}/api/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt, prompt_type: mode, platform: projectType === 'python' ? 'huggingface' : 'github', repo: selectedRepo || null, app_name: appName })
        });
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        generatedFiles = data.files;
        currentFile = Object.keys(generatedFiles)[0];
        renderFileTabs();
        if (currentFile) openFile(currentFile);
        appendToConsole(`✅ Generated ${Object.keys(generatedFiles).length} files`, 'success');
        const deployActions = $('deployActions');
        if (deployActions) deployActions.style.display = 'block';
    } catch(e) { appendToConsole(`❌ ${e.message}`, 'error'); }
    finally {
        if (genBtn) {
            genBtn.disabled = false;
            genBtn.innerHTML = '<i class="fas fa-magic"></i> Generate App';
        }
    }
}

// ========== Diagnose & Fix ==========
async function diagnoseFix() {
    const consoleDiv = $('console');
    const errorLog = consoleDiv ? consoleDiv.innerText : '';
    if (!errorLog || errorLog === 'Ready.' || errorLog.includes('Console cleared')) {
        appendToConsole("❌ No error logs to diagnose. Deploy an app first to see logs.", 'error');
        return;
    }
    if (Object.keys(generatedFiles).length === 0) {
        appendToConsole("❌ No generated code to fix. Generate an app first.", 'error');
        return;
    }
    const diagBtn = $('diagnoseBtn');
    if (diagBtn) {
        diagBtn.disabled = true;
        diagBtn.innerHTML = '<i class="fas fa-spinner fa-pulse"></i> Diagnosing...';
    }
    appendToConsole("🩺 Sending error logs to AI for diagnosis...", 'info');
    try {
        const res = await fetch(`${API_BASE}/api/diagnose`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ error_log: errorLog, files: generatedFiles })
        });
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        if (data.files && Object.keys(data.files).length > 0) {
            Object.assign(generatedFiles, data.files);
            appendToConsole("✅ Diagnosis complete. Fixed code merged. Review changes and redeploy.", 'success');
            renderFileTabs();
            if (Object.keys(generatedFiles).length) openFile(Object.keys(generatedFiles)[0]);
        } else {
            appendToConsole("⚠️ AI could not generate fixes. Check your error logs.", 'warning');
        }
    } catch(e) { appendToConsole(`❌ Diagnosis failed: ${e.message}`, 'error'); }
    finally {
        if (diagBtn) {
            diagBtn.disabled = false;
            diagBtn.innerHTML = '<i class="fas fa-stethoscope"></i> Diagnose & Fix';
        }
    }
}

// ========== Deploy to GitHub ==========
async function deployToGitHub() {
    if (!githubToken) return appendToConsole("❌ Connect GitHub first", 'error');
    if (Object.keys(generatedFiles).length === 0) return appendToConsole("❌ No files to deploy", 'error');
    const appName = $('appName').value.trim();
    const repoName = `GrishteSync-${appName}`;
    const btn = $('deployGithubBtn');
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-pulse"></i> Deploying...';
    }
    appendToConsole(`📤 Deploying to GitHub: ${repoName}...`, 'info');
    try {
        const res = await fetch(`${API_BASE}/api/deploy`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${githubToken}` },
            body: JSON.stringify({ repo_name: repoName, files: generatedFiles, version: '1.0.0', app_name: appName, prompt: $('prompt').value.trim() })
        });
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        appendToConsole(`✅ GitHub repo: ${data.repo_url}`, 'success');
        if (data.pr_url) appendToConsole(`🔀 Pull Request: ${data.pr_url}`, 'info');
        if (data.pages_url) appendToConsole(`🌐 Pages: ${data.pages_url}`, 'success');
        const deployment = { appName, timestamp: Date.now(), githubUrl: data.repo_url, prUrl: data.pr_url, pagesUrl: data.pages_url };
        deployments.unshift(deployment);
        localStorage.setItem('deployments', JSON.stringify(deployments.slice(0,10)));
        renderDeployments();
    } catch(e) { appendToConsole(`❌ ${e.message}`, 'error'); }
    finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<i class="fab fa-github"></i> Deploy GitHub';
        }
    }
}

// ========== Deploy to HF ==========
async function deployToHF() {
    if (Object.keys(generatedFiles).length === 0) return appendToConsole("❌ No files to deploy", 'error');
    const appName = $('appName').value.trim();
    const spaceName = `GrishteSync-${appName}`.toLowerCase().replace(/[^a-z0-9-]/g, '-');
    const btn = $('deployHfBtn');
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-pulse"></i> Deploying...';
    }
    appendToConsole(`🤗 Deploying to Hugging Face: ${spaceName}...`, 'info');
    try {
        const headers = { 'Content-Type': 'application/json' };
        if (githubToken) headers['Authorization'] = `Bearer ${githubToken}`;
        const res = await fetch(`${API_BASE}/api/deploy-hf`, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify({ repo_full_name: spaceName, files: generatedFiles, platform: 'huggingface', app_name: appName, prompt: $('prompt').value.trim() })
        });
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        appendToConsole(`✅ HF Space: ${data.space_url}`, 'success');
        if (data.embed_url) appendToConsole(`🌐 Embedded: ${data.embed_url}`, 'success');
        const deployment = { appName, timestamp: Date.now(), hfUrl: data.space_url, embedUrl: data.embed_url };
        deployments.unshift(deployment);
        localStorage.setItem('deployments', JSON.stringify(deployments.slice(0,10)));
        renderDeployments();
        localStorage.setItem('previewSpaceUrl', data.space_url);
        if (previewMode && currentPlatform === 'python') refreshPreview();
    } catch(e) { appendToConsole(`❌ ${e.message}`, 'error'); }
    finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<i class="fab fa-huggingface"></i> Deploy HF';
        }
    }
}

// ========== PR Actions ==========
async function approveAndMergePR(prUrl) {
    if (!githubToken) return appendToConsole("❌ Not logged in", 'error');
    appendToConsole(`🔄 Approving and merging PR: ${prUrl}...`, 'info');
    try {
        const match = prUrl.match(/github\.com\/(.+?)\/(.+?)\/pull\/(\d+)/);
        if (!match) throw new Error("Invalid PR URL");
        const [, owner, repo, pull_number] = match;
        const url = `https://api.github.com/repos/${owner}/${repo}/pulls/${pull_number}/merge`;
        const resp = await fetch(url, {
            method: 'PUT',
            headers: { 'Authorization': `Bearer ${githubToken}`, 'Accept': 'application/vnd.github.v3+json' },
            body: JSON.stringify({ merge_method: 'merge' })
        });
        if (resp.status === 200) {
            appendToConsole(`✅ PR merged successfully!`, 'success');
            deployments = deployments.map(d => d.prUrl === prUrl ? { ...d, merged: true } : d);
            localStorage.setItem('deployments', JSON.stringify(deployments));
            renderDeployments();
        } else {
            const text = await resp.text();
            appendToConsole(`❌ Merge failed: ${text}`, 'error');
        }
    } catch(e) { appendToConsole(`❌ ${e.message}`, 'error'); }
}

async function cancelPR(prUrl) {
    if (!githubToken) return appendToConsole("❌ Not logged in", 'error');
    appendToConsole(`🔄 Closing PR: ${prUrl}...`, 'info');
    try {
        const match = prUrl.match(/github\.com\/(.+?)\/(.+?)\/pull\/(\d+)/);
        if (!match) throw new Error("Invalid PR URL");
        const [, owner, repo, pull_number] = match;
        const url = `https://api.github.com/repos/${owner}/${repo}/pulls/${pull_number}`;
        const resp = await fetch(url, {
            method: 'PATCH',
            headers: { 'Authorization': `Bearer ${githubToken}`, 'Accept': 'application/vnd.github.v3+json' },
            body: JSON.stringify({ state: 'closed' })
        });
        if (resp.status === 200) {
            appendToConsole(`✅ PR closed successfully`, 'success');
            deployments = deployments.filter(d => d.prUrl !== prUrl);
            localStorage.setItem('deployments', JSON.stringify(deployments));
            renderDeployments();
        } else {
            const text = await resp.text();
            appendToConsole(`❌ Failed to close: ${text}`, 'error');
        }
    } catch(e) { appendToConsole(`❌ ${e.message}`, 'error'); }
}

function renderDeployments() {
    const container = $('deploymentsList');
    if (!container) return;
    if (!deployments.length) { container.innerHTML = '<div style="color:#8b92b0;text-align:center;">No deployments yet</div>'; return; }
    container.innerHTML = deployments.map(d => `
        <div class="deployment-item">
            <div><strong>${d.appName}</strong> <span style="font-size:0.6rem;">${new Date(d.timestamp).toLocaleString()}</span></div>
            <div class="deployment-links">
                ${d.githubUrl ? `<a href="${d.githubUrl}" target="_blank"><i class="fab fa-github"></i> Repo</a>` : ''}
                ${d.prUrl ? `<a href="${d.prUrl}" target="_blank"><i class="fas fa-code-branch"></i> PR</a>` : ''}
                ${d.pagesUrl ? `<a href="${d.pagesUrl}" target="_blank"><i class="fas fa-globe"></i> Pages</a>` : ''}
                ${d.hfUrl ? `<a href="${d.hfUrl}" target="_blank"><i class="fab fa-huggingface"></i> Space</a>` : ''}
                ${d.embedUrl ? `<a href="${d.embedUrl}" target="_blank"><i class="fas fa-external-link-alt"></i> Embed</a>` : ''}
            </div>
            ${d.prUrl && !d.merged ? `
                <div class="deployment-actions">
                    <button class="btn-sm btn-primary approve-pr" data-url="${d.prUrl}"><i class="fas fa-check"></i> Approve & Merge</button>
                    <button class="btn-sm btn-danger cancel-pr" data-url="${d.prUrl}"><i class="fas fa-times"></i> Cancel</button>
                </div>
            ` : ''}
        </div>
    `).join('');
    document.querySelectorAll('.approve-pr').forEach(btn => btn.onclick = () => approveAndMergePR(btn.dataset.url));
    document.querySelectorAll('.cancel-pr').forEach(btn => btn.onclick = () => cancelPR(btn.dataset.url));
}

// ========== Auth UI ==========
function updateAuthUI() {
    if (githubToken) {
        const loginBtn = $('loginBtn');
        const userInfo = $('userInfo');
        if (loginBtn) loginBtn.style.display = 'none';
        if (userInfo) userInfo.style.display = 'flex';
        fetch(`https://api.github.com/user`, { headers: { Authorization: `Bearer ${githubToken}` } })
            .then(r => r.json()).then(data => {
                const userNameSpan = $('userName');
                const userAvatarImg = $('userAvatar');
                if (userNameSpan) userNameSpan.innerText = data.login;
                if (userAvatarImg) userAvatarImg.src = data.avatar_url;
            }).catch(() => {});
        const platform = $('projectType')?.value === 'python' ? 'huggingface' : 'github';
        loadRepos(platform);
    } else {
        const loginBtn = $('loginBtn');
        const userInfo = $('userInfo');
        if (loginBtn) loginBtn.style.display = 'inline-block';
        if (userInfo) userInfo.style.display = 'none';
    }
}

// ========== Event Listeners ==========
function bindEvents() {
    const previewToggle = $('previewToggleBtn');
    if (previewToggle) previewToggle.onclick = togglePreview;
    const saveBtn = $('saveFileBtn');
    if (saveBtn) saveBtn.onclick = saveCurrentFile;
    const downloadBtn = $('downloadZipBtn');
    if (downloadBtn) downloadBtn.onclick = downloadZip;
    const clearConsoleBtn = $('clearConsoleBtn');
    if (clearConsoleBtn) clearConsoleBtn.onclick = clearConsole;
    const generateBtn = $('generateBtn');
    if (generateBtn) generateBtn.onclick = generateApp;
    const diagnoseBtn = $('diagnoseBtn');
    if (diagnoseBtn) diagnoseBtn.onclick = diagnoseFix;
    const deployGithub = $('deployGithubBtn');
    if (deployGithub) deployGithub.onclick = deployToGitHub;
    const deployHf = $('deployHfBtn');
    if (deployHf) deployHf.onclick = deployToHF;
    const shareBtn = $('shareBtn');
    if (shareBtn) shareBtn.onclick = shareLatestUrl;
    const exportGistBtn = $('exportGistBtn');
    if (exportGistBtn) exportGistBtn.onclick = exportToGist;
    const previewSpaceBtn = $('previewSpaceBtn');
    if (previewSpaceBtn) previewSpaceBtn.onclick = () => {
        const url = $('customSpaceUrl')?.value.trim();
        if (url) loadSpacePreview(url);
    };
    const loginBtn = $('loginBtn');
    if (loginBtn) loginBtn.onclick = () => window.location.href = `${API_BASE}/auth/login`;
    const logoutBtn = $('logoutBtn');
    if (logoutBtn) logoutBtn.onclick = () => { localStorage.clear(); location.reload(); };
    const projectTypeSelect = $('projectType');
    if (projectTypeSelect) {
        projectTypeSelect.addEventListener('change', (e) => {
            currentPlatform = e.target.value;
            if (githubToken) {
                const platform = currentPlatform === 'python' ? 'huggingface' : 'github';
                loadRepos(platform);
            }
        });
    }
    // Undo delete button (create if not present)
    let undoBtn = $('undoDeleteBtn');
    if (!undoBtn) {
        const toolbar = document.querySelector('.editor-toolbar');
        if (toolbar) {
            undoBtn = document.createElement('button');
            undoBtn.id = 'undoDeleteBtn';
            undoBtn.className = 'btn-outline';
            undoBtn.innerHTML = '<i class="fas fa-undo-alt"></i> Undo Delete';
            undoBtn.style.padding = '4px 8px';
            undoBtn.onclick = undoDelete;
            toolbar.appendChild(undoBtn);
        }
    }
    // Draft buttons
    const saveDraftBtn = $('saveDraftBtn');
    if (!saveDraftBtn) {
        const builderPanel = document.querySelector('.builder-panel');
        if (builderPanel) {
            const draftBtnContainer = document.createElement('div');
            draftBtnContainer.style.display = 'flex';
            draftBtnContainer.style.gap = '8px';
            draftBtnContainer.style.marginTop = '16px';
            draftBtnContainer.innerHTML = `
                <button id="saveDraftBtn" class="btn-secondary" style="flex:1;"><i class="fas fa-save"></i> Save Draft</button>
                <button id="loadDraftsBtn" class="btn-secondary" style="flex:1;"><i class="fas fa-folder-open"></i> Load Draft</button>
            `;
            builderPanel.appendChild(draftBtnContainer);
            const newSaveDraft = $('saveDraftBtn');
            if (newSaveDraft) newSaveDraft.onclick = () => saveAsDraft();
            const newLoadDrafts = $('loadDraftsBtn');
            if (newLoadDrafts) newLoadDrafts.onclick = () => loadDraftsList();
        }
    }
}

// ========== Initialization ==========
function init() {
    initTheme();
    updateAuthUI();
    renderDeployments();
    setupConsoleFilters();
    bindEvents();
    appendToConsole("✨ GrishteSync ready. Connect GitHub to start.", 'success');
    // OAuth redirect handling
    const urlParams = new URLSearchParams(window.location.search);
    const token = urlParams.get('token');
    if (token) {
        localStorage.setItem('github_token', token);
        localStorage.setItem('github_user', urlParams.get('github_user') || '');
        window.history.replaceState({}, '', window.location.pathname);
        location.reload();
    }
}

// ======================== EXTRA FUNCTIONS ========================
// Append these to your script.js (after all existing functions, before init).

// ---------- Rename File ----------
function showRenameModal(filename) {
    const newName = prompt(`Rename "${filename}" to:`, filename);
    if (!newName || newName === filename) return;
    if (generatedFiles[newName]) {
        appendToConsole(`❌ File "${newName}" already exists.`, 'error');
        return;
    }
    const content = generatedFiles[filename];
    delete generatedFiles[filename];
    generatedFiles[newName] = content;
    if (currentFile === filename) currentFile = newName;
    renderFileTabs();
    openFile(newName);
    appendToConsole(`✏️ Renamed "${filename}" → "${newName}"`, 'success');
}

// Add rename button to each file tab (call this after renderFileTabs)
function addRenameButtonsToTabs() {
    document.querySelectorAll('.file-tab').forEach(tab => {
        const filename = tab.querySelector('span')?.innerText;
        if (filename && !tab.querySelector('.rename-file-btn')) {
            const renameBtn = document.createElement('button');
            renameBtn.className = 'rename-file-btn';
            renameBtn.innerHTML = '<i class="fas fa-edit"></i>';
            renameBtn.style.background = 'none';
            renameBtn.style.border = 'none';
            renameBtn.style.color = 'inherit';
            renameBtn.style.cursor = 'pointer';
            renameBtn.style.marginLeft = '4px';
            renameBtn.title = 'Rename file';
            renameBtn.onclick = (e) => {
                e.stopPropagation();
                showRenameModal(filename);
            };
            tab.querySelector('span')?.after(renameBtn);
        }
    });
}

// Override renderFileTabs to include rename buttons
const originalRenderFileTabs = renderFileTabs;
renderFileTabs = function() {
    originalRenderFileTabs();
    addRenameButtonsToTabs();
};

// ---------- File Statistics ----------
function showFileStats() {
    let totalLines = 0;
    let totalChars = 0;
    const stats = [];
    for (const [name, content] of Object.entries(generatedFiles)) {
        const lines = content.split('\n').length;
        const chars = content.length;
        totalLines += lines;
        totalChars += chars;
        stats.push({ name, lines, chars });
    }
    const statsHtml = `
        <div style="padding: 16px;">
            <h3>File Statistics</h3>
            <table style="width:100%; border-collapse: collapse; margin-top: 12px;">
                <thead><tr><th>File</th><th>Lines</th><th>Characters</th></tr></thead>
                <tbody>
                    ${stats.map(s => `<tr><td>${escapeHtml(s.name)}</td><td>${s.lines}</td><td>${s.chars}</td></tr>`).join('')}
                </tbody>
                <tfoot><tr><td><strong>Total</strong></td><td><strong>${totalLines}</strong></td><td><strong>${totalChars}</strong></td></tr></tfoot>
            </table>
        </div>
    `;
    showModal("File Statistics", statsHtml);
}

function showModal(title, contentHtml) {
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    Object.assign(modal.style, {
        position: 'fixed', top: '0', left: '0', width: '100%', height: '100%',
        backgroundColor: 'rgba(0,0,0,0.7)', zIndex: '1001',
        display: 'flex', alignItems: 'center', justifyContent: 'center'
    });
    const modalContent = document.createElement('div');
    Object.assign(modalContent.style, {
        backgroundColor: '#1e1e2e', borderRadius: '12px', maxWidth: '600px',
        width: '90%', maxHeight: '80%', overflow: 'auto', padding: '20px', color: '#e2e8f0'
    });
    modalContent.innerHTML = `<h2>${title}</h2>${contentHtml}<div style="margin-top:16px; text-align:right;"><button class="close-modal" style="padding:8px 16px; background:#2a2a3a; color:white; border:none; border-radius:4px; cursor:pointer;">Close</button></div>`;
    modal.appendChild(modalContent);
    document.body.appendChild(modal);
    modalContent.querySelector('.close-modal').onclick = () => modal.remove();
}

// ---------- Search Across Files ----------
let searchModal = null;
function searchInFiles() {
    const searchTerm = prompt("Search for text in all files:", "");
    if (!searchTerm) return;
    const results = [];
    for (const [filename, content] of Object.entries(generatedFiles)) {
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
            if (lines[i].toLowerCase().includes(searchTerm.toLowerCase())) {
                results.push({ filename, lineNumber: i + 1, lineText: lines[i].trim().substring(0, 100) });
            }
        }
    }
    if (results.length === 0) {
        appendToConsole(`🔍 No matches found for "${searchTerm}".`, 'warning');
        return;
    }
    const resultsHtml = `
        <div style="max-height: 400px; overflow-y: auto;">
            ${results.map(r => `
                <div class="search-result" data-filename="${r.filename}" data-line="${r.lineNumber}" style="padding: 8px; border-bottom: 1px solid #2a2a3a; cursor: pointer;">
                    <strong>${escapeHtml(r.filename)}</strong> line ${r.lineNumber}:<br>
                    <code style="font-size: 0.8rem;">${escapeHtml(r.lineText)}</code>
                </div>
            `).join('')}
        </div>
    `;
    showModal(`Search Results for "${searchTerm}"`, resultsHtml);
    document.querySelectorAll('.search-result').forEach(el => {
        el.addEventListener('click', () => {
            const filename = el.dataset.filename;
            openFile(filename);
            // Optionally highlight the line in editor? Monaco doesn't support easily without complex API.
            appendToConsole(`🔍 Opened "${filename}" (line ${el.dataset.line})`, 'info');
            document.querySelector('.modal-overlay')?.remove();
        });
    });
}

// ---------- AI Code Review ----------
async function aiCodeReview() {
    if (Object.keys(generatedFiles).length === 0) {
        appendToConsole("No code to review. Generate an app first.", 'error');
        return;
    }
    if (!githubToken) {
        appendToConsole("Connect GitHub to use code review (for authentication).", 'error');
        return;
    }
    const reviewBtn = document.createElement('button');
    reviewBtn.innerText = 'Reviewing...';
    reviewBtn.disabled = true;
    appendToConsole("🤖 Requesting AI code review...", 'info');
    try {
        const res = await fetch(`${API_BASE}/api/review`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${githubToken}` },
            body: JSON.stringify({ files: generatedFiles, prompt: $('prompt').value.trim() })
        });
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        showModal("AI Code Review", `<pre style="white-space: pre-wrap; font-family: monospace;">${escapeHtml(data.review)}</pre>`);
        appendToConsole("✅ Code review completed.", 'success');
    } catch(e) {
        appendToConsole(`❌ Review failed: ${e.message}`, 'error');
    }
}

// Note: You need to add a /api/review endpoint on your backend that sends code to LLM with a "code review" prompt.
// If you don't have it, you can omit this function or implement a simpler version using /api/diagnose with a special prompt.

// ---------- Keyboard Shortcuts ----------
function setupKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
        // Ctrl+S (or Cmd+S) – save current file
        if ((e.ctrlKey || e.metaKey) && e.key === 's') {
            e.preventDefault();
            saveCurrentFile();
        }
        // Ctrl+D – download ZIP
        if ((e.ctrlKey || e.metaKey) && e.key === 'd') {
            e.preventDefault();
            downloadZip();
        }
        // Ctrl+F – search across files
        if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
            e.preventDefault();
            searchInFiles();
        }
        // Ctrl+Shift+R – AI code review
        if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'R') {
            e.preventDefault();
            aiCodeReview();
        }
        // Ctrl+Shift+S – save as draft
        if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'S') {
            e.preventDefault();
            saveAsDraft();
        }
    });
    appendToConsole("⌨️ Keyboard shortcuts: Ctrl+S (save), Ctrl+D (download ZIP), Ctrl+F (search), Ctrl+Shift+R (AI review), Ctrl+Shift+S (save draft)", 'info');
}

// ---------- Add Extra UI Buttons ----------
function addExtraButtons() {
    const builderPanel = document.querySelector('.builder-panel');
    if (builderPanel && !document.querySelector('#extraButtons')) {
        const extraDiv = document.createElement('div');
        extraDiv.id = 'extraButtons';
        extraDiv.style.display = 'flex';
        extraDiv.style.gap = '8px';
        extraDiv.style.marginTop = '16px';
        extraDiv.innerHTML = `
            <button id="statsBtn" class="btn-secondary" style="flex:1;"><i class="fas fa-chart-bar"></i> Stats</button>
            <button id="searchBtn" class="btn-secondary" style="flex:1;"><i class="fas fa-search"></i> Search Files</button>
            <button id="reviewBtn" class="btn-secondary" style="flex:1;"><i class="fas fa-code-branch"></i> AI Review</button>
        `;
        builderPanel.appendChild(extraDiv);
        $('statsBtn')?.addEventListener('click', showFileStats);
        $('searchBtn')?.addEventListener('click', searchInFiles);
        $('reviewBtn')?.addEventListener('click', aiCodeReview);
    }
}

// Override bindEvents to include extra buttons and shortcuts
const originalBindEvents = bindEvents;
bindEvents = function() {
    originalBindEvents();
    addExtraButtons();
    setupKeyboardShortcuts();
};

// Settings
let apiBase = localStorage.getItem("api_base") || "https://grishtesync-backend.onrender.com";
let autoSaveInterval = null;
let autoSaveSeconds = parseInt(localStorage.getItem("auto_save_seconds") || "30");
let consoleTimestamps = localStorage.getItem("console_timestamps") !== "false";
let settingsModal = null;

// Toast helper
function showToast(message, type = 'info') {
  let container = document.querySelector('.toast-container');
  if (!container) {
    container = document.createElement('div');
    container.className = 'toast-container';
    document.body.appendChild(container);
  }
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

// Override appendToConsole to respect timestamp setting
const originalAppend = appendToConsole;
appendToConsole = function(msg, type = 'info') {
  if (consoleTimestamps) {
    originalAppend(msg, type);
  } else {
    const line = document.createElement('div');
    line.className = `console-line ${type}`;
    line.textContent = msg;
    consoleDiv.appendChild(line);
    line.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    consoleLines.push({ text: msg, type, timestamp: null, element: line });
    applyConsoleFilters();
  }
};

// Auto-save setup
function startAutoSave() {
  if (autoSaveInterval) clearInterval(autoSaveInterval);
  if (autoSaveSeconds > 0) {
    autoSaveInterval = setInterval(() => {
      if (currentFile && editor) {
        saveCurrentFile();
        showToast(`Auto-saved ${currentFile}`, 'info');
      }
    }, autoSaveSeconds * 1000);
  }
}

// Settings modal
function showSettings() {
  if (settingsModal) settingsModal.remove();
  settingsModal = document.createElement('div');
  settingsModal.className = 'settings-modal';
  settingsModal.innerHTML = `
    <h3>Settings</h3>
    <div class="form-group">
      <label>API Base URL</label>
      <input type="text" id="settingsApiBase" value="${apiBase}" placeholder="https://...">
    </div>
    <div class="form-group">
      <label>Auto-save interval (seconds, 0 to disable)</label>
      <input type="number" id="settingsAutoSave" value="${autoSaveSeconds}" min="0" step="5">
    </div>
    <div class="form-group">
      <label>
        <input type="checkbox" id="settingsConsoleTimestamps" ${consoleTimestamps ? 'checked' : ''}>
        Show console timestamps
      </label>
    </div>
    <div class="modal-actions">
      <button id="settingsCancelBtn" class="btn-secondary">Cancel</button>
      <button id="settingsSaveBtn" class="btn-primary">Save</button>
    </div>
  `;
  document.body.appendChild(settingsModal);
  document.getElementById('settingsCancelBtn').onclick = () => settingsModal.remove();
  document.getElementById('settingsSaveBtn').onclick = () => {
    const newApiBase = document.getElementById('settingsApiBase').value.trim();
    const newAutoSave = parseInt(document.getElementById('settingsAutoSave').value);
    const newTimestamps = document.getElementById('settingsConsoleTimestamps').checked;
    if (newApiBase) {
      apiBase = newApiBase;
      localStorage.setItem('api_base', apiBase);
      window.API_BASE = apiBase; // update global if needed
    }
    autoSaveSeconds = newAutoSave;
    localStorage.setItem('auto_save_seconds', autoSaveSeconds);
    startAutoSave();
    consoleTimestamps = newTimestamps;
    localStorage.setItem('console_timestamps', consoleTimestamps);
    // Re-render console lines to hide/show timestamps
    const oldLines = [...consoleLines];
    clearConsole();
    oldLines.forEach(line => appendToConsole(line.text, line.type));
    settingsModal.remove();
    showToast('Settings saved', 'success');
  };
}

// Drag & drop file upload
function setupDragAndDrop() {
  const editorPanel = document.querySelector('.editor-panel');
  if (!editorPanel) return;
  let dragOverlay = null;
  editorPanel.addEventListener('dragover', (e) => {
    e.preventDefault();
    if (!dragOverlay) {
      dragOverlay = document.createElement('div');
      dragOverlay.className = 'drag-overlay';
      dragOverlay.innerHTML = '<i class="fas fa-cloud-upload-alt"></i> Drop files to add to project';
      editorPanel.style.position = 'relative';
      editorPanel.appendChild(dragOverlay);
      setTimeout(() => dragOverlay.classList.add('active'), 10);
    }
  });
  editorPanel.addEventListener('dragleave', (e) => {
    if (dragOverlay) {
      dragOverlay.remove();
      dragOverlay = null;
    }
  });
  editorPanel.addEventListener('drop', async (e) => {
    e.preventDefault();
    if (dragOverlay) {
      dragOverlay.remove();
      dragOverlay = null;
    }
    const files = Array.from(e.dataTransfer.files);
    for (const file of files) {
      if (file.type === 'text/plain' || file.name.match(/\.(py|js|html|css|json|md|txt)$/i)) {
        const content = await file.text();
        const filename = file.name;
        if (!generatedFiles[filename]) {
          generatedFiles[filename] = content;
          appendToConsole(`📁 Added file: ${filename}`, 'success');
        } else {
          if (confirm(`File "${filename}" already exists. Overwrite?`)) {
            generatedFiles[filename] = content;
            appendToConsole(`📁 Overwrote file: ${filename}`, 'warning');
          }
        }
      } else {
        appendToConsole(`⚠️ Skipped unsupported file type: ${file.name}`, 'warning');
      }
    }
    renderFileTabs();
    if (files.length > 0 && !currentFile) openFile(Object.keys(generatedFiles)[0]);
  });
}

// Format code action
function formatCode() {
  if (editor) {
    editor.getAction('editor.action.formatDocument').run();
    appendToConsole(`✨ Formatted ${currentFile}`, 'success');
  }
}

// Add settings button to header (call in bindEvents)
function addSettingsButton() {
  const headerRight = document.querySelector('.header > div:last-child');
  if (headerRight && !document.getElementById('settingsBtn')) {
    const settingsBtn = document.createElement('button');
    settingsBtn.id = 'settingsBtn';
    settingsBtn.className = 'btn-outline';
    settingsBtn.innerHTML = '<i class="fas fa-cog"></i>';
    settingsBtn.onclick = showSettings;
    headerRight.insertBefore(settingsBtn, headerRight.firstChild);
  }
}

// Override bindEvents to include new UI elements
const originalBindEvents = bindEvents;
bindEvents = function() {
  originalBindEvents();
  addSettingsButton();
  setupDragAndDrop();
  const formatBtn = document.createElement('button');
  formatBtn.id = 'formatCodeBtn';
  formatBtn.className = 'btn-outline';
  formatBtn.innerHTML = '<i class="fas fa-code"></i> Format';
  formatBtn.style.padding = '4px 8px';
  formatBtn.onclick = formatCode;
  const editorToolbar = document.querySelector('.editor-toolbar');
  if (editorToolbar) {
    const rightDiv = editorToolbar.querySelector('div:last-child');
    if (rightDiv) rightDiv.appendChild(formatBtn);
    else editorToolbar.appendChild(formatBtn);
  }
};

// Replace global API_BASE reference if any
window.API_BASE = apiBase;
// Wait for DOM to load
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}