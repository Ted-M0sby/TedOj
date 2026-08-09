const draftForm = document.querySelector("#draftForm");
const adminPassword = document.querySelector("#adminPassword");
const problemName = document.querySelector("#problemName");
const judgeMode = document.querySelector("#judgeMode");
const problemRequirement = document.querySelector("#problemRequirement");
const difficulty = document.querySelector("#difficulty");
const tags = document.querySelector("#tags");
const visibleCaseCount = document.querySelector("#visibleCaseCount");
const generateBtn = document.querySelector("#generateBtn");
const autoGenerateBtn = document.querySelector("#autoGenerateBtn");
const clearBtn = document.querySelector("#clearBtn");
const saveBtn = document.querySelector("#saveBtn");
const draftStatus = document.querySelector("#draftStatus");
const draftPreview = document.querySelector("#draftPreview");

const PASSWORD_STORAGE_KEY = "tedoj_admin_create_password";

let currentDraft = null;

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

function difficultyClass(value) {
    const text = String(value || "").toLowerCase();
    if (text.includes("easy")) return "easy";
    if (text.includes("hard")) return "hard";
    if (text.includes("medium")) return "medium";
    return "";
}

function setStatus(message, type) {
    draftStatus.textContent = message;
    draftStatus.className = `status-line ${type || ""}`;
}

function setBusy(isBusy, mode) {
    generateBtn.disabled = isBusy;
    autoGenerateBtn.disabled = isBusy;
    saveBtn.disabled = isBusy || !currentDraft;
    generateBtn.textContent = isBusy && mode === "manual" ? "生成中..." : "生成草稿";
    autoGenerateBtn.textContent = isBusy && mode === "auto" ? "自动创建中..." : "自动创建";
}

function getAdminPassword() {
    return adminPassword.value.trim();
}

function getDraftPayload() {
    return {
        problem_name: problemName.value.trim(),
        judge_mode: judgeMode.value,
        problem_requirement: problemRequirement.value.trim(),
        difficulty: difficulty.value,
        tags: tags.value.trim(),
        visible_case_count: Number(visibleCaseCount.value || 3),
    };
}

function getAutoDraftPayload() {
    return {
        visible_case_count: Number(visibleCaseCount.value || 3),
    };
}

function renderTags(tagList) {
    const items = Array.isArray(tagList) ? tagList.filter(Boolean) : [];
    if (!items.length) return `<span class="muted">未填写标签</span>`;
    return items.map((tag) => `<span class="tag-pill">${escapeHtml(tag)}</span>`).join("");
}

function renderCase(problem, item, index) {
    const isStdio = problem.judge_mode === "stdio";
    const input = isStdio ? item.args : formatJson(item.args);
    const output = isStdio ? item.expected : formatJson(item.expected);

    return `
        <article class="admin-case-item">
            <h3>用例 ${index + 1}</h3>
            <div class="admin-case-grid">
                <div>
                    <strong>${isStdio ? "标准输入" : "参数"}</strong>
                    <pre>${escapeHtml(input)}</pre>
                </div>
                <div>
                    <strong>${isStdio ? "标准输出" : "期望返回"}</strong>
                    <pre>${escapeHtml(output)}</pre>
                </div>
            </div>
        </article>
    `;
}

function renderDraft(problem) {
    const cases = Array.isArray(problem.test_cases) ? problem.test_cases : [];

    draftPreview.className = "admin-preview";
    draftPreview.innerHTML = `
        <div class="admin-preview-head">
            <div>
                <h1>${escapeHtml(problem.title)}</h1>
                <div class="statement-badges">
                    <span class="problem-difficulty ${difficultyClass(problem.difficulty)}">${escapeHtml(problem.difficulty)}</span>
                    <span class="problem-difficulty">${escapeHtml(problem.judge_mode)}</span>
                    ${renderTags(problem.tags)}
                </div>
            </div>
        </div>

        <section class="admin-preview-section">
            <h2>题面</h2>
            <p class="statement-description">${escapeHtml(problem.description)}</p>
        </section>

        <section class="admin-preview-section">
            <h2>初始代码</h2>
            <pre class="admin-code-preview">${escapeHtml(problem.starter_code)}</pre>
        </section>

        <section class="admin-preview-section">
            <h2>测试用例</h2>
            <div class="admin-case-list">
                ${cases.map((item, index) => renderCase(problem, item, index)).join("")}
            </div>
        </section>

        <details class="admin-json-details">
            <summary>查看原始 JSON</summary>
            <pre>${escapeHtml(formatJson(problem))}</pre>
        </details>
    `;
}

function resetDraft() {
    currentDraft = null;
    saveBtn.disabled = true;
    draftPreview.className = "admin-preview-empty";
    draftPreview.textContent = "尚未生成题目草稿。";
}

draftForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const password = getAdminPassword();
    if (!password) {
        setStatus("请输入管理员密码。", "error");
        return;
    }

    sessionStorage.setItem(PASSWORD_STORAGE_KEY, password);
    resetDraft();
    setBusy(true, "manual");
    setStatus("正在调用 Dify 生成题目...", "");

    try {
        currentDraft = await window.TedOJApi.generateProblemDraft(getDraftPayload(), password);
        renderDraft(currentDraft);
        setStatus("草稿已生成，请检查后保存。", "ok");
    } catch (error) {
        setStatus(`生成失败：${error.message}`, "error");
    } finally {
        setBusy(false);
    }
});

autoGenerateBtn.addEventListener("click", async () => {
    const password = getAdminPassword();
    if (!password) {
        setStatus("请输入管理员密码。", "error");
        return;
    }

    sessionStorage.setItem(PASSWORD_STORAGE_KEY, password);
    resetDraft();
    setBusy(true, "auto");
    setStatus("正在调用 Dify 自动创建题目...", "");

    try {
        currentDraft = await window.TedOJApi.autoGenerateProblemDraft(getAutoDraftPayload(), password);
        renderDraft(currentDraft);
        setStatus("自动草稿已生成，请检查后保存。", "ok");
    } catch (error) {
        setStatus(`自动创建失败：${error.message}`, "error");
    } finally {
        setBusy(false);
    }
});

saveBtn.addEventListener("click", async () => {
    if (!currentDraft) {
        setStatus("请先生成题目草稿。", "error");
        return;
    }

    const password = getAdminPassword();
    if (!password) {
        setStatus("请输入管理员密码。", "error");
        return;
    }

    saveBtn.disabled = true;
    setStatus("正在保存到题库...", "");

    try {
        const created = await window.TedOJApi.saveProblemDraft(currentDraft, password);
        setStatus(`已保存题目 #${created.id}`, "ok");
        draftPreview.insertAdjacentHTML("afterbegin", `
            <div class="admin-saved-banner">
                已保存到题库：
                <a href="./problem.html?id=${created.id}">查看 #${created.id} ${escapeHtml(created.title)}</a>
            </div>
        `);
    } catch (error) {
        setStatus(`保存失败：${error.message}`, "error");
        saveBtn.disabled = false;
    }
});

clearBtn.addEventListener("click", () => {
    problemName.value = "";
    judgeMode.value = "stdio";
    problemRequirement.value = "";
    difficulty.value = "";
    tags.value = "";
    visibleCaseCount.value = "3";
    resetDraft();
    setStatus("已清空。", "");
});

adminPassword.value = sessionStorage.getItem(PASSWORD_STORAGE_KEY) || "";
window.TedOJAuth.init();
resetDraft();
