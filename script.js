// Configuration
const API_BASE = "https://grishtesync-backend.onrender.com";
const API_GENERATE = `${API_BASE}/api/generate`;
const API_DEPLOY = `${API_BASE}/api/deploy`;
const API_DEPLOY_HF = `${API_BASE}/api/deploy-hf`;
const API_REPO_FILES = `${API_BASE}/api/repo-files`;
const API_HF_LOGS = `${API_BASE}/api/hf-logs`;
const API_DIAGNOSE = `${API_BASE}/api/diagnose`;
const API_MERGE_PR = `${API_BASE}/api/merge-pr`;
const AUTH_GITHUB = `${API_BASE}/auth/login`;

// State variables
let currentVersion = "0.0.0";
let repoName = "";
let generatedFiles = {};
let currentPrompt = "";
let githubToken = localStorage.getItem("github_token") || null;
let githubUsername = localStorage.getItem("github_user") || null;
let liveSpaceUrl = null;
let currentSpaceFullName = null;
let consoleInterval = null;
let lastLogCount = 0;
let cachedLogs = "";
let lastDeployType = null;
let lastDeployParams = null;
let currentPRUrl = null;

// DOM elements
const $ = id => document.getElementById(id);

// Helper functions
const showToast = (msg) => { alert(msg); };
const showError = (msg) => {
    const e = $('errorBox');
    if (e) {
        e.style.display = 'block';
        e.innerHTML = `<i class="fas fa-exclamation-circle"></i> ${msg}`;
        e.style.color = '#b91c1c';
    }
};
const hideError = () => {
    const e = $('errorBox');
    if (e) e.style.display = 'none';
};

async function safeFetch(url, options = {}) {
    const res = await fetch(url, options);
    const text = await res.text();
    try {
        return JSON.parse(text);
    } catch (e) {
        throw new Error(`Server error (${res.status}): ${text.slice(0, 200)}`);
    }
}

// Button disable helpers
function setButtonsEnabled(enabled) {
    const btns = ['generateBtn', 'approveBtn', 'hfDeployBtn', 'redoBtn', 'downloadBtn', 'refreshReposBtn', 'resetBtn'];
    btns.forEach(id => {
        const btn = $(id);
        if (btn) btn.disabled = !enabled;
    });
    // Also disable merge PR button if exists
    const mergeBtn = $('mergePrBtn');
    if (mergeBtn) mergeBtn.disabled = !enabled;
}

function setButtonLoading(btnId, isLoading, originalText = null) {
    const btn = $(btnId);
    if (!btn) return;
    if (isLoading) {
        btn.disabled = true;
        btn.dataset.originalText = btn.innerHTML;
        btn.innerHTML = '<i class="fas fa-spinner fa-pulse"></i> Loading...';
    } else {
        btn.disabled = false;
        if (btn.dataset.originalText) {
            btn.innerHTML = btn.dataset.originalText;
        } else if (originalText) {
            btn.innerHTML = originalText;
        }
    }
}

// Auth UI
function updateAuthUI() {
    const loginBtn = $('loginBtn');
    const gitBadge = $('gitBadge');
    const gitUser = $('gitUser');
    const approveBtn = $('approveBtn');
    if (githubToken) {
        if (loginBtn) loginBtn.style.display = 'none';
        if (gitBadge) gitBadge.style.display = 'inline-flex';
        if (gitUser) gitUser.textContent = githubUsername || 'user';
        if (approveBtn) approveBtn.style.display = 'block';
        fetchUserRepos();
    } else {
        if (loginBtn) loginBtn.style.display = 'inline-flex';
        if (gitBadge) gitBadge.style.display = 'none';
        if (approveBtn) approveBtn.style.display = 'none';
    }
    const hfToggle = $('hfToggle');
    const hfDeployBtn = $('hfDeployBtn');
    if (hfDeployBtn && hfToggle) hfDeployBtn.style.display = hfToggle.checked ? 'block' : 'none';
}

async function fetchUserRepos() {
    if (!githubToken) return;
    const repoSelect = $('repoSelect');
    try {
        repoSelect.innerHTML = '<option>Loading...</option>';
        const repos = await safeFetch('https://api.github.com/user/repos?per_page=100', {
            headers: { Authorization: `token ${githubToken}` }
        });
        const grishteRepos = repos.filter(r => r.name.toLowerCase().startsWith('grishtesync-'));
        repoSelect.innerHTML = '<option value="">-- Update existing repo --</option>';
        grishteRepos.forEach(repo => {
            const opt = document.createElement('option');
            opt.value = repo.full_name;
            opt.textContent = repo.full_name;
            repoSelect.appendChild(opt);
        });
    } catch (e) {
        repoSelect.innerHTML = '<option>Error loading repos</option>';
    }
}

// File browser & editor
async function loadRepoFiles() {
    const repoFull = $('repoSelect').value;
    if (!repoFull || !githubToken) return;
    try {
        const data = await safeFetch(API_REPO_FILES, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ repo: repoFull, token: githubToken })
        });
        if (data.error) throw new Error(data.error);
        const fileTree = $('fileTree');
        fileTree.innerHTML = '';
        data.files.forEach(file => {
            const btn = document.createElement('button');
            btn.className = 'btn-secondary';
            btn.style.margin = '4px 0';
            btn.style.width = '100%';
            btn.style.textAlign = 'left';
            btn.style.padding = '10px 12px';
            btn.innerHTML = `<i class="far fa-file-code"></i> ${file.path}`;
            btn.onclick = () => loadAndEditFile(file);
            fileTree.appendChild(btn);
        });
        $('repoFileBrowser').style.display = 'block';
    } catch (e) {
        showError(e.message);
    }
}

async function loadAndEditFile(file) {
    const contentResp = await fetch(file.download_url);
    const content = await contentResp.text();
    $('editFileName').innerText = file.path;
    $('fileEditArea').value = content;
    $('fileEditorPanel').style.display = 'block';
    $('commitFileChanges').onclick = async () => {
        await commitFileChange(file.path, $('fileEditArea').value, file.sha);
    };
}

async function commitFileChange(filePath, newContent, sha) {
    const repoFull = $('repoSelect').value;
    setButtonLoading('commitFileChanges', true);
    try {
        const resp = await safeFetch(API_DEPLOY, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `token ${githubToken}` },
            body: JSON.stringify({
                repo_name: repoFull.split('/')[1],
                files: { [filePath]: newContent },
                version: currentVersion,
                pr_description: `Manual edit of ${filePath} via GrishteSync`
            })
        });
        if (resp.error) throw new Error(resp.error);
        showToast(`Committed, PR: ${resp.pr_url}`);
        currentPRUrl = resp.pr_url;
        $('githubResultPanel').style.display = 'block';
        $('githubRepoLink').innerHTML = `<i class="fab fa-github"></i> <a href="${resp.repo_url}" target="_blank">${resp.repo_url}</a>`;
        $('githubPRLink').innerHTML = `<i class="fas fa-code-branch"></i> <a href="${resp.pr_url}" target="_blank">Pull Request</a>`;
        $('mergePrBtn').style.display = 'inline-block';
    } catch (e) {
        showError(e.message);
    } finally {
        setButtonLoading('commitFileChanges', false);
    }
}

// Framework detection
function detectFramework(files) {
    for (let [name, content] of Object.entries(files)) {
        if (name.endsWith('.py')) {
            const lower = content.toLowerCase();
            if (lower.includes('flask')) return 'Flask (Docker)';
            if (lower.includes('gradio')) return 'Gradio';
            if (lower.includes('streamlit')) return 'Streamlit';
        }
    }
    return 'Unknown';
}

function renderFileViewer(files) {
    const container = $('fileViewer');
    if (!container) return;
    container.innerHTML = '';
    for (const [filename, content] of Object.entries(files)) {
        const safeId = filename.replace(/[^a-zA-Z0-9]/g, '_');
        const div = document.createElement('div');
        div.className = 'file-item';
        div.innerHTML = `
            <div class="file-header" onclick="window.toggleFile('${safeId}')">
                <span><i class="far fa-file-code"></i> ${filename}</span>
                <i class="fas fa-chevron-down"></i>
            </div>
            <div id="file-${safeId}" style="display:none;">
                <textarea id="textarea-${safeId}" rows="6" class="form-control">${escapeHtml(content)}</textarea>
                <button class="save-file-btn" data-filename="${filename}" data-id="${safeId}">💾 Save</button>
            </div>
        `;
        container.appendChild(div);
    }
    document.querySelectorAll('.save-file-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const filename = btn.dataset.filename;
            const id = btn.dataset.id;
            const textarea = document.getElementById(`textarea-${id}`);
            if (textarea && generatedFiles[filename]) {
                generatedFiles[filename] = textarea.value;
                showToast(`Saved ${filename}`);
            }
        });
    });
}

window.toggleFile = (id) => {
    const el = $(`file-${id}`);
    if (el) el.style.display = el.style.display === 'none' ? 'block' : 'none';
};

function escapeHtml(str) {
    return str.replace(/[&<>]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[m]));
}

function showProgress() {
    $('statusArea').style.display = 'block';
    $('resultCard').style.display = 'none';
}

function animateProgress(steps) {
    let progress = 0, idx = 0;
    const interval = setInterval(() => {
        progress += Math.random() * 10 + 2;
        if (progress > 90) progress = 90;
        $('progressBar').style.width = progress + '%';
        $('progressText').innerText = Math.floor(progress) + '%';
        if (idx < steps.length && progress > (idx + 1) * (90 / steps.length)) {
            $('progressStep').innerText = steps[idx++];
        }
    }, 400);
    return {
        complete: (t) => {
            clearInterval(interval);
            $('progressBar').style.width = '100%';
            $('progressText').innerText = '100%';
            $('progressStep').innerText = `Done in ${t}s`;
        },
        fail: (msg) => {
            clearInterval(interval);
            $('progressBar').style.width = '0%';
            $('progressText').innerText = 'Failed';
            $('progressStep').innerText = msg;
        }
    };
}

// Live console
function appendToConsole(message) {
    const consoleDiv = $('consoleOutput');
    if (consoleDiv) {
        consoleDiv.innerText += message + '\n';
        consoleDiv.scrollTop = consoleDiv.scrollHeight;
        cachedLogs += message + '\n';
    }
}

function stopLiveLogs() {
    if (consoleInterval) {
        clearInterval(consoleInterval);
        consoleInterval = null;
    }
}

async function startHFLiveLogs(spaceFullName) {
    if (consoleInterval) stopLiveLogs();
    $('liveConsole').style.display = 'block';
    $('consoleOutput').innerText = 'Connecting to Hugging Face build logs...\n';
    cachedLogs = '';
    lastLogCount = 0;
    const fetchLogs = async () => {
        try {
            const data = await safeFetch(API_HF_LOGS, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ space_name: spaceFullName })
            });
            if (data.logs && data.logs.length > lastLogCount) {
                const newLogs = data.logs.slice(lastLogCount);
                newLogs.forEach(entry => {
                    appendToConsole(entry.logs || JSON.stringify(entry));
                });
                lastLogCount = data.logs.length;
            }
        } catch (e) {
            appendToConsole('[Error fetching logs: ' + e.message + ']');
        }
    };
    fetchLogs();
    consoleInterval = setInterval(fetchLogs, 3000);
}

// Diagnose & Fix
async function diagnoseAndFix(errorLog, currentCode) {
    if (!errorLog) return showToast("No error log to diagnose");
    setButtonLoading('diagnoseFromLogsBtn', true);
    try {
        const data = await safeFetch(API_DIAGNOSE, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ error_log: errorLog, code: currentCode })
        });
        if (data.error) throw new Error(data.error);
        generatedFiles = data.files;
        renderFileViewer(generatedFiles);
        finalizeUI("Diagnosed & fixed");
        showToast("Fixed version generated. Review changes and deploy.");
    } catch (e) {
        showError("Diagnose failed: " + e.message);
    } finally {
        setButtonLoading('diagnoseFromLogsBtn', false);
    }
}

// Merge PR
async function mergePullRequest(prUrl) {
    if (!prUrl || !githubToken) return showToast("No PR URL or GitHub token");
    setButtonLoading('mergePrBtn', true);
    try {
        // Extract owner/repo/pull number from URL
        const match = prUrl.match(/github\.com\/(.+?)\/(.+?)\/pull\/(\d+)/);
        if (!match) throw new Error("Invalid PR URL");
        const [, owner, repo, pull_number] = match;
        const url = `https://api.github.com/repos/${owner}/${repo}/pulls/${pull_number}/merge`;
        const resp = await fetch(url, {
            method: 'PUT',
            headers: {
                'Authorization': `token ${githubToken}`,
                'Accept': 'application/vnd.github.v3+json'
            },
            body: JSON.stringify({ merge_method: 'merge' })
        });
        if (resp.status === 200) {
            showToast("✅ PR merged successfully!");
            $('mergePrBtn').style.display = 'none';
        } else {
            const text = await resp.text();
            throw new Error(`Merge failed (${resp.status}): ${text}`);
        }
    } catch (e) {
        showError("Merge error: " + e.message);
    } finally {
        setButtonLoading('mergePrBtn', false);
    }
}

// Generation & deployment
async function generatePR() {
    const prompt = $('promptInput')?.value.trim();
    if (!prompt) return showToast("Enter a prompt");
    currentPrompt = prompt;
    hideError();
    const selectedRepo = $('repoSelect')?.value;
    const newName = $('appNameInput')?.value.trim();
    repoName = selectedRepo || (newName ? `GrishteSync-${newName}` : `GrishteSync-${Date.now().toString(36)}`);
    const promptType = $('promptTypeSelect').value;

    setButtonLoading('generateBtn', true);
    showProgress();
    const anim = animateProgress(["Reading...", "Generating...", "Preparing..."]);
    const headers = { 'Content-Type': 'application/json' };
    if (selectedRepo && githubToken) headers['Authorization'] = `token ${githubToken}`;
    try {
        const data = await safeFetch(API_GENERATE, {
            method: 'POST',
            headers,
            body: JSON.stringify({ prompt, repo: selectedRepo, prompt_type: promptType })
        });
        if (data.error) throw new Error(data.error);
        anim.complete(data.generate_time || '?');
        generatedFiles = data.files;
        renderFileViewer(generatedFiles);
        setTimeout(() => {
            $('statusArea').style.display = 'none';
            $('resultCard').style.display = 'block';
            finalizeUI(prompt);
        }, 500);
    } catch (e) {
        anim.fail(e.message);
        showError(e.message);
    } finally {
        setButtonLoading('generateBtn', false);
    }
}

function finalizeUI(prompt) {
    let ver = currentVersion.split('.').map(Number);
    if (ver.length !== 3) ver = [0, 0, 0];
    ver[2]++;
    currentVersion = ver.join('.');
    $('versionBadge').innerText = `v${currentVersion}`;
    $('prDescription').innerHTML = `<strong>Generated</strong><br><em>"${prompt}"</em><br>Files: ${Object.keys(generatedFiles).join(', ')}`;
    $('prEditTextarea').value = `GrishteSync update v${currentVersion}\nFiles: ${Object.keys(generatedFiles).join(', ')}`;
    $('frameworkBadge').innerHTML = `Framework: ${detectFramework(generatedFiles)}`;
    $('githubResultPanel').style.display = 'none';
    $('hfResultPanel').style.display = 'none';
    $('deployErrorBox').style.display = 'none';
    stopLiveLogs();
    $('liveConsole').style.display = 'none';
    $('approveBtn').disabled = false;
    $('approveBtn').innerHTML = '<i class="fab fa-github"></i> Deploy to GitHub';
    $('hfDeployBtn').disabled = false;
    $('hfDeployBtn').innerHTML = '<i class="fab fa-huggingface"></i> Deploy to HF';
    $('mergePrBtn').style.display = 'none';
}

async function deployToGitHub() {
    if (!githubToken) return showToast("Connect GitHub first.");
    if (!Object.keys(generatedFiles).length) return showToast("Generate first.");
    setButtonLoading('approveBtn', true);
    showProgress();
    const anim = animateProgress(["Creating branch", "Pushing files", "Opening PR"]);
    try {
        const data = await safeFetch(API_DEPLOY, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `token ${githubToken}` },
            body: JSON.stringify({
                repo_name: repoName,
                files: generatedFiles,
                version: currentVersion,
                pr_description: $('prEditTextarea').value
            })
        });
        if (data.error) throw new Error(data.error);
        anim.complete(data.deploy_time);
        if (data.username && repoName) {
            repoName = `${data.username}/${repoName.replace(/.*\//, '')}`;
        }
        currentPRUrl = data.pr_url;
        setTimeout(() => {
            $('statusArea').style.display = 'none';
            $('githubResultPanel').style.display = 'block';
            $('githubRepoLink').innerHTML = `<i class="fab fa-github"></i> <a href="${data.repo_url}" target="_blank">${data.repo_url}</a>`;
            $('githubPRLink').innerHTML = `<i class="fas fa-code-branch"></i> <a href="${data.pr_url}" target="_blank">Pull Request</a>`;
            $('mergePrBtn').style.display = 'inline-block';
            $('prInstructions').style.display = 'block';
            $('approveBtn').innerHTML = '✅ Deployed';
            $('approveBtn').disabled = true;
            showToast("GitHub deploy successful");
            $('deployErrorBox').style.display = 'none';
        }, 500);
    } catch (e) {
        anim.fail(e.message);
        showError(e.message);
        lastDeployType = 'github';
        lastDeployParams = {
            repo_name: repoName,
            files: generatedFiles,
            version: currentVersion,
            pr_description: $('prEditTextarea').value
        };
        const errorBox = $('deployErrorBox');
        const errorMsg = $('deployErrorMessage');
        errorMsg.innerText = e.message;
        errorBox.style.display = 'block';
        $('retryDeployBtn').style.display = 'inline-block';
        $('approveBtn').disabled = false;
        $('approveBtn').innerHTML = '<i class="fab fa-github"></i> Deploy to GitHub';
    } finally {
        setButtonLoading('approveBtn', false);
    }
}

async function deployToHF() {
    if (!repoName) return showToast("Generate a repo first.");
    if (!Object.keys(generatedFiles).length) return showToast("Generate code first.");
    setButtonLoading('hfDeployBtn', true);
    showProgress();
    const anim = animateProgress(["Creating Space", "Uploading files", "Building"]);
    try {
        const data = await safeFetch(API_DEPLOY_HF, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': githubToken ? `token ${githubToken}` : '' },
            body: JSON.stringify({
                repo_full_name: repoName,
                space_name: repoName.split('/')[1] || 'grishte-app',
                files: generatedFiles,
                github_token: githubToken
            })
        });
        if (data.error) throw new Error(data.error);
        anim.complete(data.deploy_time);
        liveSpaceUrl = data.space_url;
        currentSpaceFullName = data.space_full_name;
        setTimeout(() => {
            $('statusArea').style.display = 'none';
            $('hfResultPanel').style.display = 'block';
            $('hfSpaceLink').innerHTML = `<i class="fab fa-huggingface"></i> <a href="${data.space_url}" target="_blank">${data.space_url}</a>`;
            $('copyUrlBtn').onclick = () => {
                navigator.clipboard.writeText(data.space_url);
                showToast("URL copied!");
            };
            $('liveBtn').onclick = () => window.open(data.space_url, '_blank');
            $('viewLogsBtn').onclick = () => startHFLiveLogs(currentSpaceFullName);
            $('hfDeployBtn').innerHTML = '✅ Live';
            $('hfDeployBtn').disabled = true;
            showToast("HF Space live!");
            $('deployErrorBox').style.display = 'none';
            startHFLiveLogs(currentSpaceFullName);
        }, 500);
    } catch (e) {
        anim.fail(e.message);
        showError(e.message);
        lastDeployType = 'hf';
        lastDeployParams = {
            repo_full_name: repoName,
            space_name: repoName.split('/')[1] || 'grishte-app',
            files: generatedFiles,
            github_token: githubToken
        };
        const errorBox = $('deployErrorBox');
        const errorMsg = $('deployErrorMessage');
        errorMsg.innerText = e.message;
        errorBox.style.display = 'block';
        $('retryDeployBtn').style.display = 'inline-block';
        $('hfDeployBtn').disabled = false;
        $('hfDeployBtn').innerHTML = '<i class="fab fa-huggingface"></i> Deploy to HF';
    } finally {
        setButtonLoading('hfDeployBtn', false);
    }
}

async function retryDeployment() {
    if (!lastDeployType || !lastDeployParams) return;
    $('deployErrorBox').style.display = 'none';
    if (lastDeployType === 'github') {
        generatedFiles = lastDeployParams.files;
        await deployToGitHub();
    } else if (lastDeployType === 'hf') {
        generatedFiles = lastDeployParams.files;
        await deployToHF();
    }
}

async function diagnoseFromLogs() {
    if (!cachedLogs || cachedLogs.length < 10) return showToast("No logs captured. Try deploying first.");
    let codeToFix = "";
    if (Object.keys(generatedFiles).length > 0) {
        codeToFix = generatedFiles[Object.keys(generatedFiles)[0]];
    } else {
        codeToFix = "No code available. Please generate an app first.";
    }
    await diagnoseAndFix(cachedLogs, codeToFix);
}

// Event listeners
function bindEvents() {
    $('generateBtn')?.addEventListener('click', generatePR);
    $('approveBtn')?.addEventListener('click', deployToGitHub);
    $('hfDeployBtn')?.addEventListener('click', deployToHF);
    $('redoBtn')?.addEventListener('click', () => {
        if (currentPrompt) {
            $('promptInput').value = currentPrompt;
            generatePR();
        }
    });
    $('downloadBtn')?.addEventListener('click', () => {
        if (!window.JSZip) return;
        const zip = new JSZip();
        for (let [n, c] of Object.entries(generatedFiles)) zip.file(n, c);
        zip.generateAsync({ type: 'blob' }).then(b => {
            const a = document.createElement('a');
            a.href = URL.createObjectURL(b);
            a.download = `${repoName.replace('/', '_')}.zip`;
            a.click();
        });
    });
    $('refreshReposBtn')?.addEventListener('click', fetchUserRepos);
    $('resetBtn')?.addEventListener('click', () => {
        localStorage.clear();
        location.reload();
    });
    $('loginBtn')?.addEventListener('click', () => window.location.href = AUTH_GITHUB);
    $('disconnectGit')?.addEventListener('click', () => {
        localStorage.removeItem('github_token');
        localStorage.removeItem('github_user');
        location.reload();
    });
    $('hfToggle')?.addEventListener('change', updateAuthUI);
    $('repoSelect')?.addEventListener('change', () => {
        if ($('repoSelect').value) loadRepoFiles();
    });
    $('refreshLogsBtn')?.addEventListener('click', () => {
        if (currentSpaceFullName) startHFLiveLogs(currentSpaceFullName);
    });
    $('retryDeployBtn')?.addEventListener('click', retryDeployment);
    $('diagnoseFromLogsBtn')?.addEventListener('click', diagnoseFromLogs);
    $('diagnoseFromConsoleBtn')?.addEventListener('click', diagnoseFromLogs);
    $('diagnoseFromErrorBtn')?.addEventListener('click', () => {
        const errorMsg = $('#deployErrorMessage')?.innerText || "Unknown error";
        let codeToFix = "";
        if (Object.keys(generatedFiles).length > 0) {
            codeToFix = generatedFiles[Object.keys(generatedFiles)[0]];
        } else {
            codeToFix = "No code available. Please generate an app first.";
        }
        diagnoseAndFix(errorMsg, codeToFix);
    });
    $('mergePrBtn')?.addEventListener('click', () => {
        if (currentPRUrl) mergePullRequest(currentPRUrl);
    });
}

function handleRedirectTokens() {
    const urlParams = new URLSearchParams(window.location.search);
    const token = urlParams.get('token');
    const user = urlParams.get('github_user');
    if (token) {
        localStorage.setItem('github_token', token);
        if (user) localStorage.setItem('github_user', user);
        window.history.replaceState({}, '', window.location.pathname);
    }
    updateAuthUI();
}

window.onload = () => {
    handleRedirectTokens();
    bindEvents();
    updateAuthUI();
};