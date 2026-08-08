const problemTitle = document.querySelector("#problemTitle");
const problemMeta = document.querySelector("#problemMeta");
const problemDescription = document.querySelector("#problemDescription");
const difficultyBadge = document.querySelector("#difficultyBadge");
const functionNameLabel = document.querySelector("#functionNameLabel");
const functionName = document.querySelector("#functionName");
const visibleCases = document.querySelector("#visibleCases");
const codeEditor = document.querySelector("#codeEditor");
const resetCodeBtn = document.querySelector("#resetCodeBtn");
const submitBtn = document.querySelector("#submitBtn");
const submitStatus = document.querySelector("#submitStatus");
const judgeResult = document.querySelector("#judgeResult");
const resultResizeHandle = document.querySelector("#resultResizeHandle");
const problemSubmissionsLink = document.querySelector("#problemSubmissionsLink");
const problemTags = document.querySelector("#problemTags");
const RESTORE_CODE_KEY = "tedoj_restore_submission_code";

const problemId = new URLSearchParams(window.location.search).get("id");
let starterCode = "";
let currentFunctionName = "solution";
let currentJudgeMode = "function";
let latestSubmissionId = null;
let resultPanelHeight = 260;

const aiAnalysisOptions = {
    mistake_analysis: {
        label: "错题分析",
        question: "请分析这次提交为什么错误",
    },
    algorithm_optimization: {
        label: "算法优化",
        question: "请分析这份代码如何优化",
    },
    algorithm_explanation: {
        label: "算法讲解",
        question: "请讲解这道题的算法思路",
    },
};

function escapeHtml(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function formatJson(value) {
    return JSON.stringify(value, null, 2);
}

function formatPythonValue(value) {
    if (value === null) return "None";
    if (typeof value === "string") return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
    if (typeof value === "boolean") return value ? "True" : "False";
    if (typeof value === "number") return String(value);
    if (Array.isArray(value)) return `[${value.map(formatPythonValue).join(", ")}]`;
    if (typeof value === "object") {
        return `{${Object.entries(value)
            .map(([key, item]) => `${formatPythonValue(key)}: ${formatPythonValue(item)}`)
            .join(", ")}}`;
    }
    return String(value);
}

function formatFunctionCall(item) {
    const args = Array.isArray(item.args) ? item.args.map(formatPythonValue) : [];
    const kwargs = item.kwargs && typeof item.kwargs === "object"
        ? Object.entries(item.kwargs).map(([key, value]) => `${key}=${formatPythonValue(value)}`)
        : [];

    return `${currentFunctionName}(${args.concat(kwargs).join(", ")})`;
}

function normalizeJudgeMode(value) {
    return String(value || "function").trim().toLowerCase() === "stdio" ? "stdio" : "function";
}

function formatStdioInput(value) {
    if (value === null || value === undefined) return "";
    if (typeof value === "string") return value;
    if (Array.isArray(value)) {
        if (!value.length) return "";
        if (value.length === 1) return String(value[0] ?? "");
        return value.map((item) => String(item ?? "")).join("\n");
    }
    if (typeof value === "object") return formatJson(value);
    return String(value);
}

function formatStdioExpected(value) {
    if (value === null || value === undefined) return "";
    if (typeof value === "string") return value;
    return formatJson(value);
}

function formatDate(value) {
    if (!value) return "-";
    return new Date(value).toLocaleString("zh-CN", { hour12: false });
}

function difficultyClass(value) {
    const text = String(value || "").toLowerCase();
    if (text.includes("easy") || text.includes("简单")) return "easy";
    if (text.includes("hard") || text.includes("困难")) return "hard";
    if (text.includes("medium") || text.includes("中等")) return "medium";
    return "";
}

function statusClass(status) {
    if (status === "Accepted") return "accepted";
    if (status === "Running" || status === "Pending") return "running";
    return "failed";
}

function renderCases(cases) {
    if (!cases.length) {
        visibleCases.innerHTML = `<div class="empty-state">暂无公开测试用例。</div>`;
        return;
    }

    visibleCases.innerHTML = cases.map((item, index) => `
        <article class="leetcode-example">
            <h3>示例 ${index + 1}：</h3>
            ${currentJudgeMode === "stdio"
                ? `<pre><strong>输入：</strong>
${escapeHtml(formatStdioInput(item.args))}
<strong>输出：</strong>
${escapeHtml(formatStdioExpected(item.expected))}</pre>`
                : `<pre><strong>输入：</strong>${escapeHtml(formatFunctionCall(item))}
<strong>输出：</strong>${escapeHtml(formatPythonValue(item.expected))}</pre>`}
        </article>
    `).join("");
}

function renderTags(tags) {
    const tagList = Array.isArray(tags) ? tags.filter(Boolean) : [];
    if (!tagList.length) {
        problemTags.innerHTML = "";
        return;
    }

    problemTags.innerHTML = tagList
        .map((tag) => `<a class="tag-pill" href="./main.html?tag=${encodeURIComponent(tag)}">${escapeHtml(tag)}</a>`)
        .join("");
}

function formatCaseIndex(item, fallbackIndex) {
    const index = Number(item.case_index);
    return Number.isFinite(index) && index > 0 ? index : fallbackIndex + 1;
}

function formatCaseInput(item) {
    if (currentJudgeMode === "stdio") return formatStdioInput(item.args);
    return formatFunctionCall({ args: item.args, kwargs: item.kwargs });
}

function formatCaseExpected(item) {
    if (currentJudgeMode === "stdio") return formatStdioExpected(item.expected);
    return formatPythonValue(item.expected);
}

function formatCaseActual(item) {
    if (item.actual === null || item.actual === undefined) return "无输出";
    if (currentJudgeMode === "stdio") return String(item.actual);
    return formatPythonValue(item.actual);
}

function renderCaseResult(item, index) {
    const caseIndex = formatCaseIndex(item, index);
    const errorRow = item.error_message
        ? `<strong>错误信息：</strong>${escapeHtml(item.error_message)}`
        : "";

    return `
        <article class="leetcode-case-result">
            <h3>用例 ${caseIndex}：${escapeHtml(item.status)}</h3>
            <pre><strong>输入：</strong>${escapeHtml(formatCaseInput(item))}
<strong>预期输出：</strong>${escapeHtml(formatCaseExpected(item))}
<strong>实际输出：</strong>${escapeHtml(formatCaseActual(item))}${errorRow ? `\n${errorRow}` : ""}</pre>
        </article>
    `;
}

function renderJudgeResult(result) {
    const cases = result.case_results || [];
    latestSubmissionId = result.id;
    judgeResult.classList.remove("hidden");
    resultResizeHandle.classList.remove("hidden");
    judgeResult.style.height = `${resultPanelHeight}px`;
    judgeResult.innerHTML = `
        <div class="leetcode-result-head">
            <span class="status-badge ${statusClass(result.status)}">${escapeHtml(result.status)}</span>
            <strong>${result.passed_cases}/${result.total_cases} 通过</strong>
            <span>${result.runtime_ms} ms</span>
        </div>
        ${result.error_message ? `<p class="status-line error">${escapeHtml(result.error_message)}</p>` : ""}
        <div class="leetcode-case-list">
            ${cases.map(renderCaseResult).join("")}
        </div>
        <div class="ai-analysis-tools">
            ${Object.entries(aiAnalysisOptions).map(([category, item]) => `
                <button class="ai-analysis-button" type="button" data-category="${category}">
                    ${escapeHtml(item.label)}
                </button>
            `).join("")}
        </div>
        <div id="aiAnalysisResult" class="ai-analysis-result hidden" aria-live="polite"></div>
    `;
}

function getRestoredSubmission() {
    const raw = sessionStorage.getItem(RESTORE_CODE_KEY);
    if (!raw) return null;

    try {
        const payload = JSON.parse(raw);
        if (String(payload.problemId) !== String(problemId)) return null;
        return payload;
    } catch {
        return null;
    } finally {
        sessionStorage.removeItem(RESTORE_CODE_KEY);
    }
}

function setAiAnalysisLoading(button, isLoading) {
    document.querySelectorAll(".ai-analysis-button").forEach((item) => {
        item.disabled = isLoading;
    });

    if (button) {
        button.textContent = isLoading ? "分析中..." : aiAnalysisOptions[button.dataset.category].label;
    }
}

function renderAiAnalysis(message, type) {
    const panel = document.querySelector("#aiAnalysisResult");
    if (!panel) return;

    panel.classList.remove("hidden", "error");
    if (type === "error") panel.classList.add("error");
    panel.innerHTML = `<pre>${escapeHtml(message)}</pre>`;
    panel.scrollIntoView({ behavior: "smooth", block: "start" });
}

function requestAiAnalysis(category, button) {
    const option = aiAnalysisOptions[category];

    if (!latestSubmissionId || !option) {
        renderAiAnalysis("请先完成一次提交。", "error");
        return;
    }

    if (typeof $ === "undefined") {
        renderAiAnalysis("页面没有加载 jQuery，无法发起 AI 分析请求。", "error");
        return;
    }

    setAiAnalysisLoading(button, true);
    renderAiAnalysis("正在请求 AI 分析...", "");

    $.ajax({
        url: `${window.TedOJApi.getApiBaseUrl()}/api/submissions/${latestSubmissionId}/ai-analysis`,
        method: "POST",
        contentType: "application/json",
        dataType: "json",
        data: JSON.stringify({
            knowledge_category: category,
            question: option.question,
        }),
    })
        .done((data) => {
            renderAiAnalysis(data.answer || "AI 没有返回内容。", "");
        })
        .fail((xhr) => {
            const detail = xhr.responseJSON && xhr.responseJSON.detail
                ? xhr.responseJSON.detail
                : (xhr.responseText || "AI 分析请求失败。");
            renderAiAnalysis(detail, "error");
        })
        .always(() => {
            setAiAnalysisLoading(button, false);
        });
}

async function loadProblem() {
    if (!problemId) {
        problemTitle.textContent = "缺少题目 ID";
        problemDescription.textContent = "请从题目列表进入详情页。";
        submitBtn.disabled = true;
        return;
    }

    problemSubmissionsLink.href = `./submissions.html?problem_id=${problemId}`;

    try {
        const problem = await window.TedOJApi.getProblem(problemId);
        document.title = `TedOJ - ${problem.title}`;
        problemTitle.textContent = `#${problem.id} ${problem.title}`;
        problemMeta.textContent = formatDate(problem.created_at);
        problemDescription.textContent = problem.description;
        difficultyBadge.textContent = problem.difficulty;
        difficultyBadge.className = `problem-difficulty ${difficultyClass(problem.difficulty)}`;
        currentJudgeMode = normalizeJudgeMode(problem.judge_mode);
        functionNameLabel.textContent = currentJudgeMode === "stdio" ? "判题模式" : "函数名";
        functionName.textContent = currentJudgeMode === "stdio" ? "标准输入输出" : problem.function_name;
        renderTags(problem.tags);
        currentFunctionName = problem.function_name || "solution";
        starterCode = problem.starter_code || "";
        const restoredSubmission = getRestoredSubmission();
        codeEditor.value = restoredSubmission && restoredSubmission.code
            ? restoredSubmission.code
            : starterCode;
        if (restoredSubmission && restoredSubmission.id) {
            submitStatus.textContent = `已载入提交 #${restoredSubmission.id} 的代码`;
            renderJudgeResult(restoredSubmission);
        }
        renderCases(problem.visible_test_cases || []);
    } catch (error) {
        problemTitle.textContent = "题目加载失败";
        problemDescription.textContent = error.message;
        submitBtn.disabled = true;
    }
}

resetCodeBtn.addEventListener("click", () => {
    codeEditor.value = starterCode;
});

submitBtn.addEventListener("click", async () => {
    const code = codeEditor.value.trim();
    if (!code) {
        submitStatus.textContent = "请先输入代码。";
        return;
    }

    submitBtn.disabled = true;
    submitStatus.textContent = "正在判题...";
    judgeResult.classList.add("hidden");
    resultResizeHandle.classList.add("hidden");

    try {
        const result = await window.TedOJApi.createSubmission(problemId, code);
        renderJudgeResult(result);
        submitStatus.textContent = `提交完成 #${result.id}`;
    } catch (error) {
        submitStatus.textContent = `提交失败：${error.message}`;
    } finally {
        submitBtn.disabled = false;
    }
});

judgeResult.addEventListener("click", (event) => {
    const button = event.target.closest(".ai-analysis-button");
    if (!button) return;

    requestAiAnalysis(button.dataset.category, button);
});

resultResizeHandle.addEventListener("pointerdown", (event) => {
    if (judgeResult.classList.contains("hidden")) return;

    const startY = event.clientY;
    const startHeight = judgeResult.getBoundingClientRect().height;
    const editorHeight = document.querySelector(".editor-pane").getBoundingClientRect().height;
    const minHeight = 96;
    const maxHeight = Math.max(180, editorHeight - 180);

    resultResizeHandle.setPointerCapture(event.pointerId);
    document.body.classList.add("resizing-result-panel");

    function handlePointerMove(moveEvent) {
        const nextHeight = Math.min(
            maxHeight,
            Math.max(minHeight, startHeight - (moveEvent.clientY - startY)),
        );
        resultPanelHeight = Math.round(nextHeight);
        judgeResult.style.height = `${resultPanelHeight}px`;
    }

    function handlePointerUp() {
        document.body.classList.remove("resizing-result-panel");
        resultResizeHandle.removeEventListener("pointermove", handlePointerMove);
        resultResizeHandle.removeEventListener("pointerup", handlePointerUp);
        resultResizeHandle.removeEventListener("pointercancel", handlePointerUp);
    }

    resultResizeHandle.addEventListener("pointermove", handlePointerMove);
    resultResizeHandle.addEventListener("pointerup", handlePointerUp);
    resultResizeHandle.addEventListener("pointercancel", handlePointerUp);
});

loadProblem();
