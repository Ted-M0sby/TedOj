const filterForm = document.querySelector("#filterForm");
const problemIdFilter = document.querySelector("#problemIdFilter");
const clearFilterBtn = document.querySelector("#clearFilterBtn");
const refreshBtn = document.querySelector("#refreshBtn");
const apiStatus = document.querySelector("#apiStatus");
const submissionRows = document.querySelector("#submissionRows");
const submissionCount = document.querySelector("#submissionCount");
const submissionDetail = document.querySelector("#submissionDetail");
const detailStatus = document.querySelector("#detailStatus");
const RESTORE_CODE_KEY = "tedoj_restore_submission_code";

function escapeHtml(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function formatDate(value) {
    if (!value) return "-";
    return new Date(value).toLocaleString("zh-CN", { hour12: false });
}

function statusClass(status) {
    if (status === "Accepted") return "accepted";
    if (status === "Running" || status === "Pending") return "running";
    return "failed";
}

function getFilterProblemId() {
    const value = problemIdFilter.value.trim();
    return value ? Number(value) : "";
}

function setApiStatus(message, type) {
    apiStatus.textContent = message;
    apiStatus.className = `status-line ${type || ""}`;
}

function renderRows(items) {
    submissionCount.textContent = `${items.length} 条`;

    if (!items.length) {
        submissionRows.innerHTML = `
            <tr>
                <td colspan="7">暂无提交记录。</td>
            </tr>
        `;
        return;
    }

    submissionRows.innerHTML = items.map((item) => `
        <tr>
            <td>#${item.id}</td>
            <td><a class="problem-title-link submission-problem-link" href="./problem.html?id=${item.problem_id}">#${item.problem_id}</a></td>
            <td><span class="status-badge ${statusClass(item.status)}">${escapeHtml(item.status)}</span></td>
            <td>${escapeHtml(item.passed_cases)}/${escapeHtml(item.total_cases)}</td>
            <td>${escapeHtml(item.runtime_ms)} ms</td>
            <td>${escapeHtml(formatDate(item.created_at))}</td>
            <td><button class="button secondary submission-detail-button" type="button" data-id="${item.id}">详情</button></td>
        </tr>
    `).join("");
}

function renderLoginRequired() {
    submissionCount.textContent = "0 条";
    setApiStatus("登录后查看自己的提交记录。", "");
    detailStatus.textContent = "未登录";
    submissionDetail.className = "detail-empty";
    submissionDetail.textContent = "登录后可以查看提交详情，并从记录恢复代码。";
    submissionRows.innerHTML = `
        <tr>
            <td colspan="7">
                <div class="empty-state auth-required-state">
                    登录后查看自己的提交记录。
                    <div>
                        <button class="button primary" type="button" data-auth-action="login">登录</button>
                        <button class="button secondary" type="button" data-auth-action="register">注册</button>
                    </div>
                </div>
            </td>
        </tr>
    `;
}

function openSubmissionInProblem(item) {
    sessionStorage.setItem(RESTORE_CODE_KEY, JSON.stringify({
        problemId: String(item.problem_id),
        id: item.id,
        code: item.code || "",
        status: item.status,
        passed_cases: item.passed_cases,
        total_cases: item.total_cases,
        runtime_ms: item.runtime_ms,
        error_message: item.error_message,
        case_results: item.case_results || [],
    }));
    window.location.href = `./problem.html?id=${encodeURIComponent(item.problem_id)}`;
}

async function loadSubmissions() {
    if (!window.TedOJAuth.isAuthenticated()) {
        renderLoginRequired();
        return;
    }

    refreshBtn.disabled = true;
    setApiStatus("正在加载提交记录...", "");

    try {
        const items = await window.TedOJApi.getSubmissions(getFilterProblemId());
        renderRows(items);
        setApiStatus("已同步", "ok");
    } catch (error) {
        submissionCount.textContent = "0 条";
        submissionRows.innerHTML = `
            <tr>
                <td colspan="7">提交记录加载失败：${escapeHtml(error.message)}</td>
            </tr>
        `;
        setApiStatus(error.message, "error");
    } finally {
        refreshBtn.disabled = false;
    }
}

filterForm.addEventListener("submit", (event) => {
    event.preventDefault();
    loadSubmissions();
});

clearFilterBtn.addEventListener("click", () => {
    problemIdFilter.value = "";
    loadSubmissions();
});

refreshBtn.addEventListener("click", loadSubmissions);

submissionRows.addEventListener("click", async (event) => {
    const authButton = event.target.closest("[data-auth-action]");
    if (authButton) {
        window.TedOJAuth.showAuthModal(authButton.dataset.authAction);
        return;
    }

    const button = event.target.closest("button[data-id]");
    if (!button) return;

    button.disabled = true;
    detailStatus.textContent = "正在加载...";

    try {
        const detail = await window.TedOJApi.getSubmissionDetail(button.dataset.id);
        openSubmissionInProblem(detail);
    } catch (error) {
        detailStatus.textContent = "加载失败";
        submissionDetail.className = "detail-empty";
        submissionDetail.textContent = error.message;
    } finally {
        button.disabled = false;
    }
});

const queryProblemId = new URLSearchParams(window.location.search).get("problem_id");
if (queryProblemId) {
    problemIdFilter.value = queryProblemId;
}

window.TedOJAuth.init();
window.addEventListener("tedoj:auth-changed", loadSubmissions);
loadSubmissions();
