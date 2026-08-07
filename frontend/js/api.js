(function () {
    const DEFAULT_API_BASE_URL = "http://127.0.0.1:8010";
    const STORAGE_KEY = "tedoj_api_base_url";

    function normalizeBaseUrl(value) {
        return String(value || "").trim().replace(/\/+$/, "");
    }

    function getApiBaseUrl() {
        return normalizeBaseUrl(localStorage.getItem(STORAGE_KEY) || DEFAULT_API_BASE_URL);
    }

    function setApiBaseUrl(value) {
        const normalized = normalizeBaseUrl(value);
        if (!normalized) {
            localStorage.removeItem(STORAGE_KEY);
            return DEFAULT_API_BASE_URL;
        }
        localStorage.setItem(STORAGE_KEY, normalized);
        return normalized;
    }

    async function request(path, options = {}) {
        const response = await fetch(`${getApiBaseUrl()}${path}`, {
            ...options,
            headers: {
                "Content-Type": "application/json",
                ...(options.headers || {}),
            },
        });

        let data = null;
        const text = await response.text();
        if (text) {
            try {
                data = JSON.parse(text);
            } catch {
                data = text;
            }
        }

        if (!response.ok) {
            const detail = data && typeof data === "object" ? data.detail : data;
            throw new Error(detail || `请求失败：${response.status}`);
        }

        return data;
    }

    function toQuery(params) {
        const query = new URLSearchParams();
        Object.entries(params || {}).forEach(([key, value]) => {
            if (value !== undefined && value !== null && value !== "") {
                query.set(key, value);
            }
        });
        const text = query.toString();
        return text ? `?${text}` : "";
    }

    window.TedOJApi = {
        getApiBaseUrl,
        setApiBaseUrl,
        health: () => request("/api/health"),
        getProblems: () => request("/api/problems"),
        getProblem: (problemId) => request(`/api/problems/${problemId}`),
        createSubmission: (problemId, code) => request(`/api/problems/${problemId}/submissions`, {
            method: "POST",
            body: JSON.stringify({
                language: "python",
                code,
            }),
        }),
        getSubmissions: (problemId) => request(`/api/submissions${toQuery({ problem_id: problemId })}`),
        getSubmissionDetail: (submissionId) => request(`/api/submissions/${submissionId}`),
        generateProblemDraft: (payload, adminPassword) => request("/api/admin/problem-drafts/generate", {
            method: "POST",
            headers: {
                "X-Admin-Password": adminPassword,
            },
            body: JSON.stringify(payload),
        }),
        saveProblemDraft: (payload, adminPassword) => request("/api/admin/problem-drafts/save", {
            method: "POST",
            headers: {
                "X-Admin-Password": adminPassword,
            },
            body: JSON.stringify(payload),
        }),
    };
})();
