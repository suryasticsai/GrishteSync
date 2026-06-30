// ============================
// CONFIG & STATE
// ============================
const API_BASE_URL = 'http://localhost:5000';  // change to your deployed backend when ready

let editor = null;
let currentFile = null;
let projectFiles = {};        // in‑memory file map
let consoleMessages = [];      // for console log

// DOM elements
const generateBtn = document.getElementById('generate-btn');
const reviewBtn = document.getElementById('review-btn');
const deployGithubBtn = document.getElementById('deploy-github-btn');
const deployHfBtn = document.getElementById('deploy-hf-btn');
const descriptionInput = document.getElementById('description');
const projectTypeSelect = document.getElementById('project-type');
const statusDiv = document.getElementById('status');
const consoleOutput = document.getElementById('console-output');
const fileTabsContainer = document.getElementById('file-tabs');
const editorContainer = document.getElementById('editor-container');

// ============================
// CONSOLE LOG
// ============================
function logToConsole(message, type = 'info') {
    const prefix = type === 'error' ? '❌' : type === 'success' ? '✅' : 'ℹ️';
    const timestamp = new Date().toLocaleTimeString();
    consoleMessages.push(`[${timestamp}] ${prefix} ${message}`);
    consoleOutput.textContent = consoleMessages.join('\n');
    consoleOutput.scrollTop = consoleOutput.scrollHeight;
    // Also log to browser console for debugging
    console.log(message);
}

// ============================
// STATUS
// ============================
function setStatus(msg, isError = false) {
    statusDiv.textContent = msg;
    statusDiv.style.color = isError ? '#ff6b6b' : '#aaa';
    logToConsole(msg, isError ? 'error' : 'info');
}

// ============================
// MONACO EDITOR INIT
// ============================
require.config({ paths: { vs: 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.34.1/min/vs' } });
require(['vs/editor/editor.main'], function () {
    editor = monaco.editor.create(document.getElementById('editor-container'), {
        value: '// Generate a project to get started.',
        language: 'javascript',
        theme: 'vs-dark',
        automaticLayout: true,
        fontSize: 14,
        minimap: { enabled: false }
    });
    window.editor = editor;

    // Setup balloon on selection
    setupBalloon();

    logToConsole('Editor ready.');
});

// ============================
// FILE TABS & NAVIGATION
// ============================
function populateTabs(files) {
    fileTabsContainer.innerHTML = '';
    const filenames = Object.keys(files);
    if (filenames.length === 0) {
        fileTabsContainer.innerHTML = '<span style="color:#666;padding:6px 12px;font-size:13px;">No files</span>';
        return;
    }
    filenames.forEach(name => {
        const tab = document.createElement('button');
        tab.className = 'file-tab';
        tab.textContent = name;
        tab.dataset.filename = name;
        tab.addEventListener('click', () => openFile(name));
        fileTabsContainer.appendChild(tab);
    });
    openFile(filenames[0]);
}

function openFile(filename) {
    if (!editor) return;
    const content = projectFiles[filename] || '';
    const ext = filename.split('.').pop();
    let language = 'plaintext';
    if (['js', 'mjs'].includes(ext)) language = 'javascript';
    else if (['py'].includes(ext)) language = 'python';
    else if (['html', 'htm'].includes(ext)) language = 'html';
    else if (['css'].includes(ext)) language = 'css';
    else if (['json'].includes(ext)) language = 'json';
    else if (['yaml', 'yml'].includes(ext)) language = 'yaml';
    else if (['md'].includes(ext)) language = 'markdown';

    monaco.editor.setModelLanguage(editor.getModel(), language);
    editor.setValue(content);
    currentFile = filename;

    // Update active tab
    document.querySelectorAll('.file-tab').forEach(tab => {
        tab.classList.toggle('active', tab.dataset.filename === filename);
    });
}

// ============================
// GENERATE CODE
// ============================
generateBtn.addEventListener('click', async () => {
    const description = descriptionInput.value.trim();
    const projectType = projectTypeSelect.value;
    if (!description) {
        setStatus('Please enter a description.', true);
        return;
    }

    setStatus('⏳ Generating...');
    try {
        const resp = await fetch(`${API_BASE_URL}/api/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ description, project_type: projectType })
        });
        const data = await resp.json();
        if (data.error) {
            setStatus(`❌ ${data.error}`, true);
            return;
        }
        if (data.files) {
            projectFiles = data.files;
            window.projectFiles = projectFiles; // for balloon
            populateTabs(projectFiles);
            setStatus(`✅ Generated ${Object.keys(projectFiles).length} files.`);
            logToConsole(`Project type: ${projectType}, files: ${Object.keys(projectFiles).join(', ')}`, 'success');
        } else {
            setStatus('❌ No files received.', true);
        }
    } catch (err) {
        setStatus(`❌ ${err.message}`, true);
        logToConsole(`Generate error: ${err.message}`, 'error');
    }
});

// ============================
// REVIEW CODE
// ============================
reviewBtn.addEventListener('click', async () => {
    if (!projectFiles || Object.keys(projectFiles).length === 0) {
        setStatus('No code to review. Generate first.', true);
        return;
    }
    setStatus('🔍 Reviewing...');
    try {
        const resp = await fetch(`${API_BASE_URL}/api/review`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ files: projectFiles })
        });
        const data = await resp.json();
        if (data.error) {
            setStatus(`❌ ${data.error}`, true);
        } else if (data.issues && data.issues.length) {
            setStatus(`⚠️ Issues found: ${data.issues.join('; ')}`);
            logToConsole(`Review issues: ${data.issues.join(', ')}`, 'error');
        } else {
            setStatus('✅ No issues found.');
            logToConsole('Review passed.', 'success');
        }
    } catch (err) {
        setStatus(`❌ ${err.message}`, true);
        logToConsole(`Review error: ${err.message}`, 'error');
    }
});

// ============================
// DEPLOY TO GITHUB – MODAL FLOW
// ============================
const githubModal = document.getElementById('github-modal');
const githubTokenInput = document.getElementById('github-token');
const githubRepoInput = document.getElementById('github-repo');
const githubDeployStatus = document.getElementById('github-deploy-status');

deployGithubBtn.addEventListener('click', () => {
    if (!projectFiles || Object.keys(projectFiles).length === 0) {
        setStatus('No files to deploy. Generate first.', true);
        return;
    }
    githubModal.style.display = 'flex';
    githubTokenInput.value = '';
    githubRepoInput.value = '';
    githubDeployStatus.textContent = '';
    githubTokenInput.focus();
});

document.querySelector('.close-modal[data-modal="github-modal"]').addEventListener('click', () => {
    githubModal.style.display = 'none';
});

document.getElementById('github-deploy-confirm').addEventListener('click', async () => {
    const token = githubTokenInput.value.trim();
    const repo = githubRepoInput.value.trim();
    if (!token || !repo) {
        githubDeployStatus.textContent = 'Please fill both fields.';
        githubDeployStatus.style.color = '#ff6b6b';
        return;
    }
    githubDeployStatus.textContent = 'Deploying...';
    githubDeployStatus.style.color = '#aaa';
    try {
        const resp = await fetch(`${API_BASE_URL}/api/deploy-github`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token, repo })
        });
        const data = await resp.json();
        if (data.error) {
            githubDeployStatus.textContent = `❌ ${data.error}`;
            githubDeployStatus.style.color = '#ff6b6b';
            logToConsole(`GitHub deploy error: ${data.error}`, 'error');
        } else {
            githubDeployStatus.textContent = '✅ Deployed!';
            githubDeployStatus.style.color = '#8f8';
            logToConsole('Deployed to GitHub successfully.', 'success');
            setTimeout(() => githubModal.style.display = 'none', 2000);
        }
    } catch (err) {
        githubDeployStatus.textContent = `❌ ${err.message}`;
        githubDeployStatus.style.color = '#ff6b6b';
        logToConsole(`GitHub deploy error: ${err.message}`, 'error');
    }
});

// ============================
// DEPLOY TO HUGGING FACE – MODAL
// ============================
const hfModal = document.getElementById('hf-modal');
const hfTokenInput = document.getElementById('hf-token');
const hfSpaceInput = document.getElementById('hf-space');
const hfDeployStatus = document.getElementById('hf-deploy-status');

deployHfBtn.addEventListener('click', () => {
    if (!projectFiles || Object.keys(projectFiles).length === 0) {
        setStatus('No files to deploy. Generate first.', true);
        return;
    }
    hfModal.style.display = 'flex';
    hfTokenInput.value = '';
    hfSpaceInput.value = '';
    hfDeployStatus.textContent = '';
    hfTokenInput.focus();
});

document.querySelector('.close-modal[data-modal="hf-modal"]').addEventListener('click', () => {
    hfModal.style.display = 'none';
});

document.getElementById('hf-deploy-confirm').addEventListener('click', async () => {
    const token = hfTokenInput.value.trim();
    const space = hfSpaceInput.value.trim();
    if (!token || !space) {
        hfDeployStatus.textContent = 'Please fill both fields.';
        hfDeployStatus.style.color = '#ff6b6b';
        return;
    }
    hfDeployStatus.textContent = 'Deploying...';
    hfDeployStatus.style.color = '#aaa';
    try {
        const resp = await fetch(`${API_BASE_URL}/api/deploy-hf`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token, space })
        });
        const data = await resp.json();
        if (data.error) {
            hfDeployStatus.textContent = `❌ ${data.error}`;
            hfDeployStatus.style.color = '#ff6b6b';
            logToConsole(`HF deploy error: ${data.error}`, 'error');
        } else {
            hfDeployStatus.textContent = '✅ Deployed!';
            hfDeployStatus.style.color = '#8f8';
            logToConsole('Deployed to Hugging Face successfully.', 'success');
            setTimeout(() => hfModal.style.display = 'none', 2000);
        }
    } catch (err) {
        hfDeployStatus.textContent = `❌ ${err.message}`;
        hfDeployStatus.style.color = '#ff6b6b';
        logToConsole(`HF deploy error: ${err.message}`, 'error');
    }
});

// ============================
// INLINE EDIT BALLOON
// ============================
function setupBalloon() {
    if (!editor) return;

    let balloonVisible = false;
    let currentSelection = null;
    const balloonElement = document.getElementById('edit-balloon');
    const balloonInput = document.getElementById('balloon-input');
    const balloonSubmit = document.getElementById('balloon-submit');
    const balloonCancel = document.getElementById('balloon-cancel');
    const balloonLoading = document.getElementById('balloon-loading');

    function showBalloon(selection) {
        const position = editor.getScrolledVisiblePosition(selection.getStartPosition());
        const editorDom = editor.getDomNode();
        const editorRect = editorDom.getBoundingClientRect();
        const lineHeight = editor.getOption(monaco.editor.EditorOption.lineHeight);
        const top = editorRect.top + position.top + lineHeight + 6;
        const left = editorRect.left + position.left;

        balloonElement.style.top = top + 'px';
        balloonElement.style.left = left + 'px';
        balloonElement.style.display = 'block';
        balloonInput.value = '';
        balloonInput.focus();
        balloonVisible = true;
        currentSelection = {
            startLineNumber: selection.startLineNumber,
            startColumn: selection.startColumn,
            endLineNumber: selection.endLineNumber,
            endColumn: selection.endColumn,
            selectedText: editor.getModel().getValueInRange(selection)
        };
    }

    function hideBalloon() {
        balloonElement.style.display = 'none';
        balloonVisible = false;
        balloonLoading.style.display = 'none';
        balloonSubmit.disabled = false;
        currentSelection = null;
    }

    // Listen to selection changes
    editor.onDidChangeCursorSelection((e) => {
        const selection = e.selection;
        if (selection && !selection.isEmpty()) {
            const selectedText = editor.getModel().getValueInRange(selection);
            if (selectedText.length < 2000) {
                showBalloon(selection);
            } else {
                hideBalloon();
            }
        } else {
            hideBalloon();
        }
    });

    // Submit
    balloonSubmit.addEventListener('click', async () => {
        const instruction = balloonInput.value.trim();
        if (!instruction) {
            alert('Please enter an instruction.');
            return;
        }
        if (!currentSelection) return;

        const allFiles = window.projectFiles || {};
        const filename = currentFile || 'index.html';

        balloonLoading.style.display = 'block';
        balloonSubmit.disabled = true;

        try {
            const response = await fetch(`${API_BASE_URL}/api/edit-selection`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    instruction: instruction,
                    selected_code: currentSelection.selectedText,
                    filename: filename,
                    all_files: allFiles
                })
            });
            const data = await response.json();
            if (data.replacement) {
                const range = new monaco.Range(
                    currentSelection.startLineNumber,
                    currentSelection.startColumn,
                    currentSelection.endLineNumber,
                    currentSelection.endColumn
                );
                editor.executeEdits('inline-edit', [{
                    range: range,
                    text: data.replacement,
                    forceMoveMarkers: true
                }]);
                // Update in-memory file content
                if (window.projectFiles) {
                    window.projectFiles[filename] = editor.getModel().getValue();
                }
                setStatus('✅ Code updated successfully.');
                logToConsole(`Applied edit on ${filename}`, 'success');
            } else {
                alert('Error: ' + (data.error || 'No replacement received.'));
                logToConsole(`Edit failed: ${data.error || 'No replacement'}`, 'error');
            }
        } catch (err) {
            alert('Request failed: ' + err.message);
            logToConsole(`Edit error: ${err.message}`, 'error');
        } finally {
            hideBalloon();
        }
    });

    balloonCancel.addEventListener('click', hideBalloon);
}