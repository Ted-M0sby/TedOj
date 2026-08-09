const problemList = document.querySelector("#problemList");
const problemCount = document.querySelector("#problemCount");
const refreshBtn = document.querySelector("#refreshBtn");
const topicTags = document.querySelector("#topicTags");
const topSearch = document.querySelector("#topSearch");
const problemSearch = document.querySelector("#problemSearch");
const difficultyFilter = document.querySelector("#difficultyFilter");

const ALL_TAG = "__all__";
const UNCATEGORIZED_TAG = "__uncategorized__";

let allProblems = [];
let currentTag = new URLSearchParams(window.location.search).get("tag") || ALL_TAG;
let currentKeyword = "";
let currentDifficulty = "";

function escapeHtml(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function normalizeText(value) {
    return String(value || "").trim().toLowerCase();
}

function getProblemTags(problem) {
    return Array.isArray(problem.tags) ? problem.tags.filter(Boolean) : [];
}

function difficultyClass(value) {
    const text = normalizeText(value);
    if (text.includes("easy") || text.includes("简单")) return "easy";
    if (text.includes("hard") || text.includes("困难")) return "hard";
    if (text.includes("medium") || text.includes("中等")) return "medium";
    return "";
}

function difficultyLabel(value) {
    const level = difficultyClass(value);
    if (level === "easy") return "简单";
    if (level === "medium") return "中等";
    if (level === "hard") return "困难";
    return value || "-";
}

function getTagStats(problems) {
    const stats = [{
        value: ALL_TAG,
        label: "全部题目",
        count: problems.length,
    }];
    let uncategorizedCount = 0;

    problems.forEach((problem) => {
        const tags = getProblemTags(problem);
        if (!tags.length) {
            uncategorizedCount += 1;
            return;
        }

        tags.forEach((tag) => {
            const item = stats.find((stat) => stat.value === tag);
            if (item) {
                item.count += 1;
            } else {
                stats.push({ value: tag, label: tag, count: 1 });
            }
        });
    });

    if (uncategorizedCount) {
        stats.push({
            value: UNCATEGORIZED_TAG,
            label: "未分类",
            count: uncategorizedCount,
        });
    }

    return stats;
}

function formatAcceptance(problem) {
    if (!problem.submission_count) return "暂无提交";
    const rate = Number(problem.acceptance_rate);
    return Number.isFinite(rate) ? `${rate.toFixed(1)}%` : "暂无提交";
}

function matchesCurrentTag(problem) {
    const tags = getProblemTags(problem);
    if (currentTag === ALL_TAG) return true;
    if (currentTag === UNCATEGORIZED_TAG) return !tags.length;
    return tags.includes(currentTag);
}

function matchesKeyword(problem) {
    if (!currentKeyword) return true;
    const content = [
        problem.id,
        problem.title,
        problem.difficulty,
        ...getProblemTags(problem),
    ].join(" ");
    return normalizeText(content).includes(currentKeyword);
}

function matchesDifficulty(problem) {
    if (!currentDifficulty) return true;
    return difficultyClass(problem.difficulty) === currentDifficulty;
}

function getFilteredProblems() {
    return allProblems.filter((problem) => (
        matchesCurrentTag(problem) &&
        matchesKeyword(problem) &&
        matchesDifficulty(problem)
    ));
}

function updateUrl() {
    const url = new URL(window.location.href);
    if (currentTag && currentTag !== ALL_TAG) {
        url.searchParams.set("tag", currentTag);
    } else {
        url.searchParams.delete("tag");
    }
    window.history.replaceState(null, "", url);
}

function setCurrentTag(tag) {
    currentTag = tag || ALL_TAG;
    updateUrl();
    render();
}

function renderTopicTags() {
    const stats = getTagStats(allProblems).slice(0, 12);
    topicTags.innerHTML = stats.map((item) => `
        <button class="topic-chip ${item.value === currentTag ? "active" : ""}" type="button" data-tag="${escapeHtml(item.value)}">
            ${escapeHtml(item.label)}
            <span>${item.count}</span>
        </button>
    `).join("");
}

function renderProblemRows() {
    const problems = getFilteredProblems();
    problemCount.textContent = `${problems.length}/${allProblems.length} 题`;

    if (!problems.length) {
        problemList.innerHTML = `
            <tr>
                <td colspan="5">
                    <div class="empty-state">没有匹配的题目。</div>
                </td>
            </tr>
        `;
        return;
    }

    problemList.innerHTML = problems.map((problem) => {
        const tags = getProblemTags(problem);
        return `
            <tr>
                <td>
                    <a class="problem-title-link" href="./problem.html?id=${problem.id}">
                        <span>${problem.id}.</span>
                        ${escapeHtml(problem.title)}
                    </a>
                </td>
                <td>
                    <div class="table-tags">
                        ${tags.length
                            ? tags.slice(0, 3).map((tag) => `<button type="button" data-tag="${escapeHtml(tag)}">${escapeHtml(tag)}</button>`).join("")
                            : `<button type="button" data-tag="${UNCATEGORIZED_TAG}">未分类</button>`}
                    </div>
                </td>
                <td class="acceptance">${escapeHtml(problem.submission_count || 0)}</td>
                <td class="acceptance">${formatAcceptance(problem)}</td>
                <td>
                    <span class="difficulty ${difficultyClass(problem.difficulty)}">${escapeHtml(difficultyLabel(problem.difficulty))}</span>
                </td>
            </tr>
        `;
    }).join("");
}

function render() {
    renderTopicTags();
    renderProblemRows();
}

async function loadProblems() {
    refreshBtn.disabled = true;

    try {
        await window.TedOJApi.health();
        allProblems = await window.TedOJApi.getProblems();
        render();
    } catch (error) {
        problemCount.textContent = "0 题";
        topicTags.innerHTML = "";
        problemList.innerHTML = `
            <tr>
                <td colspan="5">
                    <div class="empty-state">题目加载失败：${escapeHtml(error.message)}</div>
                </td>
            </tr>
        `;
    } finally {
        refreshBtn.disabled = false;
    }
}

function updateKeyword(value) {
    currentKeyword = normalizeText(value);
    if (topSearch.value !== value) topSearch.value = value;
    if (problemSearch.value !== value) problemSearch.value = value;
    renderProblemRows();
}

topSearch.addEventListener("input", (event) => updateKeyword(event.target.value));
problemSearch.addEventListener("input", (event) => updateKeyword(event.target.value));

difficultyFilter.addEventListener("change", (event) => {
    currentDifficulty = event.target.value;
    renderProblemRows();
});

refreshBtn.addEventListener("click", loadProblems);

topicTags.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-tag]");
    if (button) setCurrentTag(button.dataset.tag);
});

problemList.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-tag]");
    if (button) {
        event.preventDefault();
        setCurrentTag(button.dataset.tag);
    }
});

window.TedOJAuth.init({ promptOnEntry: true });
loadProblems();
