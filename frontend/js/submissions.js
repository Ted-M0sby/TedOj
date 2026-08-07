const filterForm = document.querySelector("#filterForm");
const problemIdFilter = document.querySelector("#problemIdFilter");
const clearFilterBtn = document.querySelector("#clearFilterBtn");
const refreshBtn = document.querySelector("#refreshBtn");
const apiStatus = document.querySelector("#apiStatus");
const submissionRows = document.querySelector("#submissionRows");
const submissionCount = document.querySelector("#submissionCount");
const submissionDetail = document.querySelector("#submissionDetail");
const detailStatus = document.querySelector("#detailStatus");

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

function formatJson(value) {
    return JSON.stringify(value, null, 2);
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

function renderDetail(item) {
    const cases = item.case_results || [];
    detailStatus.textContent = `#${item.id}`;
    submissionDetail.className = "detail-list";
    submissionDetail.innerHTML = `
        <div class="detail-row"><span>题目 ID</span><strong>#${escapeHtml(item.problem_id)}</strong></div>
        <div class="detail-row"><span>状态</span><strong><span class="status-badge ${statusClass(item.status)}">${escapeHtml(item.status)}</span></strong></div>
        <div class="detail-row"><span>通过</span><strong>${escapeHtml(item.passed_cases)}/${escapeHtml(item.total_cases)}</strong></div>
        <div class="detail-row"><span>耗时</span><strong>${escapeHtml(item.runtime_ms)} ms</strong></div>
        <div class="detail-row"><span>语言</span><strong>${escapeHtml(item.language)}</strong></div>
        <div class="detail-row"><span>时间</span><strong>${escapeHtml(formatDate(item.created_at))}</strong></div>
        ${item.error_message ? `<p class="status-line error">${escapeHtml(item.error_message)}</p>` : ""}
        <h2 class="subsection-title">用例结果</h2>
        <div class="case-list">
            ${cases.map((caseResult) => `
                <article class="case-item">
                    <strong>用例 ${caseResult.case_index + 1}：${escapeHtml(caseResult.status)}</strong>
                    <pre>${escapeHtml(formatJson(caseResult))}</pre>
                </article>
            `).join("")}
        </div>
    `;
}

async function loadSubmissions() {
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
        setApiStatus("加载失败，请确认后端服务已启动。", "error");
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
    const button = event.target.closest("button[data-id]");
    if (!button) return;

    button.disabled = true;
    detailStatus.textContent = "正在加载...";

    try {
        const detail = await window.TedOJApi.getSubmissionDetail(button.dataset.id);
        renderDetail(detail);
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

loadSubmissions();
