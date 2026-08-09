(function () {
    const DEFAULT_API_BASE_URL = "http://127.0.0.1:8010";
    const STORAGE_KEY = "tedoj_api_base_url";
    const AUTH_TOKEN_KEY = "tedoj_auth_token";
    const AUTH_USER_KEY = "tedoj_auth_user";
    const AUTH_SKIP_KEY = "tedoj_auth_skip_session";

    let authUiReady = false;
    let authMode = "login";

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

    function escapeHtml(value) {
        return String(value ?? "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    function getAuthToken() {
        return localStorage.getItem(AUTH_TOKEN_KEY) || "";
    }

    function getStoredUser() {
        const raw = localStorage.getItem(AUTH_USER_KEY);
        if (!raw) return null;

        try {
            return JSON.parse(raw);
        } catch {
            return null;
        }
    }

    function saveAuth(auth) {
        localStorage.setItem(AUTH_TOKEN_KEY, auth.access_token);
        localStorage.setItem(AUTH_USER_KEY, JSON.stringify(auth.user));
        sessionStorage.removeItem(AUTH_SKIP_KEY);
        renderAuthStatus();
        window.dispatchEvent(new CustomEvent("tedoj:auth-changed", { detail: auth.user }));
    }

    function clearAuth() {
        localStorage.removeItem(AUTH_TOKEN_KEY);
        localStorage.removeItem(AUTH_USER_KEY);
        renderAuthStatus();
        window.dispatchEvent(new CustomEvent("tedoj:auth-changed"));
    }

    function isAuthenticated() {
        return Boolean(getAuthToken());
    }

    function withAuthHeaders(headers) {
        const result = { ...(headers || {}) };
        const hasAuthorization = Object.keys(result).some((key) => key.toLowerCase() === "authorization");
        const token = getAuthToken();
        if (token && !hasAuthorization) {
            result.Authorization = `Bearer ${token}`;
        }
        return result;
    }

    async function request(path, options = {}) {
        const response = await fetch(`${getApiBaseUrl()}${path}`, {
            ...options,
            headers: {
                "Content-Type": "application/json",
                ...withAuthHeaders(options.headers),
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
            if (response.status === 401 && path !== "/api/auth/login" && path !== "/api/auth/register") {
                clearAuth();
            }
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

    function findAuthArea(container) {
        return Array.from(container.children).find((item) => item.classList.contains("auth-area"));
    }

    function getAuthContainers() {
        return [
            document.querySelector(".lc-actions"),
            document.querySelector(".work-right"),
        ].filter(Boolean);
    }

    function bindAuthArea(area) {
        if (area.dataset.authBound) return;
        area.dataset.authBound = "1";
        area.addEventListener("click", (event) => {
            const button = event.target.closest("[data-auth-action]");
            if (!button) return;

            if (button.dataset.authAction === "logout") {
                clearAuth();
                return;
            }

            showAuthModal(button.dataset.authAction);
        });
    }

    function renderAuthStatus() {
        if (!document.body) return;

        getAuthContainers().forEach((container) => {
            let area = findAuthArea(container);
            if (!area) {
                area = document.createElement("div");
                area.className = "auth-area";
                container.appendChild(area);
                bindAuthArea(area);
            }

            const user = getStoredUser();
            if (user) {
                area.innerHTML = `
                    <span class="auth-user">${escapeHtml(user.username)}</span>
                    <button class="auth-button" type="button" data-auth-action="logout">退出</button>
                `;
            } else {
                area.innerHTML = `
                    <button class="auth-button" type="button" data-auth-action="login">登录</button>
                    <button class="auth-button primary" type="button" data-auth-action="register">注册</button>
                `;
            }
        });
    }

    function ensureAuthModal() {
        let modal = document.querySelector("#authModal");
        if (modal) return modal;

        modal = document.createElement("div");
        modal.id = "authModal";
        modal.className = "auth-modal hidden";
        modal.innerHTML = `
            <div class="auth-dialog" role="dialog" aria-modal="true" aria-labelledby="authTitle">
                <div class="auth-head">
                    <div>
                        <strong id="authTitle">登录 TedOJ</strong>
                        <span id="authSubtitle">登录后可保存提交记录并使用 AI 分析。</span>
                    </div>
                    <button class="auth-close" type="button" data-auth-close aria-label="关闭">&times;</button>
                </div>
                <div class="auth-tabs" role="tablist">
                    <button class="active" type="button" data-auth-mode="login">登录</button>
                    <button type="button" data-auth-mode="register">注册</button>
                </div>
                <p id="authMessage" class="auth-message"></p>
                <form id="authForm" class="auth-form">
                    <label>
                        <span>用户名</span>
                        <input id="authUsername" type="text" autocomplete="username" maxlength="64" required>
                    </label>
                    <label>
                        <span>密码</span>
                        <input id="authPassword" type="password" autocomplete="current-password" required>
                    </label>
                    <p id="authStatus" class="status-line"></p>
                    <div class="auth-actions">
                        <button id="authSubmit" class="button primary" type="submit">登录</button>
                        <button id="authSkip" class="button ghost" type="button" data-auth-skip>暂时跳过</button>
                    </div>
                </form>
            </div>
        `;
        document.body.appendChild(modal);

        modal.addEventListener("click", (event) => {
            if (event.target === modal || event.target.closest("[data-auth-close]")) {
                hideAuthModal();
                return;
            }

            const modeButton = event.target.closest("[data-auth-mode]");
            if (modeButton) {
                setAuthMode(modeButton.dataset.authMode);
                return;
            }

            if (event.target.closest("[data-auth-skip]")) {
                sessionStorage.setItem(AUTH_SKIP_KEY, "1");
                hideAuthModal();
            }
        });

        modal.querySelector("#authForm").addEventListener("submit", submitAuthForm);
        return modal;
    }

    function setAuthMode(mode) {
        authMode = mode === "register" ? "register" : "login";
        const modal = ensureAuthModal();
        const title = modal.querySelector("#authTitle");
        const subtitle = modal.querySelector("#authSubtitle");
        const submit = modal.querySelector("#authSubmit");
        const password = modal.querySelector("#authPassword");
        const status = modal.querySelector("#authStatus");

        title.textContent = authMode === "register" ? "注册 TedOJ" : "登录 TedOJ";
        subtitle.textContent = authMode === "register"
            ? "用户名只要求不重复，密码至少 8 位且包含字母和数字。"
            : "登录后可保存提交记录并使用 AI 分析。";
        submit.textContent = authMode === "register" ? "注册并登录" : "登录";
        password.autocomplete = authMode === "register" ? "new-password" : "current-password";
        status.textContent = "";
        status.className = "status-line";

        modal.querySelectorAll("[data-auth-mode]").forEach((button) => {
            button.classList.toggle("active", button.dataset.authMode === authMode);
        });
    }

    function showAuthModal(mode = "login", options = {}) {
        const modal = ensureAuthModal();
        setAuthMode(mode);
        modal.querySelector("#authMessage").textContent = options.message || "";
        modal.querySelector("#authSkip").classList.toggle("hidden", !options.skippable);
        modal.classList.remove("hidden");
        setTimeout(() => modal.querySelector("#authUsername").focus(), 0);
    }

    function hideAuthModal() {
        const modal = document.querySelector("#authModal");
        if (modal) modal.classList.add("hidden");
    }

    async function submitAuthForm(event) {
        event.preventDefault();
        const modal = ensureAuthModal();
        const username = modal.querySelector("#authUsername").value.trim();
        const password = modal.querySelector("#authPassword").value;
        const submit = modal.querySelector("#authSubmit");
        const status = modal.querySelector("#authStatus");

        if (!username) {
            status.textContent = "用户名不能为空";
            status.className = "status-line error";
            return;
        }

        if (authMode === "register" && (password.length < 8 || !/[A-Za-z]/.test(password) || !/\d/.test(password))) {
            status.textContent = "密码至少 8 位，并且必须同时包含字母和数字";
            status.className = "status-line error";
            return;
        }

        submit.disabled = true;
        status.textContent = authMode === "register" ? "正在注册..." : "正在登录...";
        status.className = "status-line";

        try {
            const payload = { username, password };
            const auth = authMode === "register"
                ? await request("/api/auth/register", { method: "POST", body: JSON.stringify(payload) })
                : await request("/api/auth/login", { method: "POST", body: JSON.stringify(payload) });
            saveAuth(auth);
            hideAuthModal();
        } catch (error) {
            status.textContent = error.message;
            status.className = "status-line error";
        } finally {
            submit.disabled = false;
        }
    }

    function initAuth(options = {}) {
        if (!authUiReady) {
            authUiReady = true;
            renderAuthStatus();
        } else {
            renderAuthStatus();
        }

        if (isAuthenticated()) {
            request("/api/auth/me")
                .then((user) => {
                    localStorage.setItem(AUTH_USER_KEY, JSON.stringify(user));
                    renderAuthStatus();
                })
                .catch(() => {});
            return;
        }

        if (options.promptOnEntry && !sessionStorage.getItem(AUTH_SKIP_KEY)) {
            showAuthModal("login", {
                skippable: true,
                message: "可以暂时跳过，未登录提交不会进入我的提交记录，也不能使用 AI 分析。",
            });
        }
    }

    window.TedOJApi = {
        getApiBaseUrl,
        setApiBaseUrl,
        health: () => request("/api/health"),
        register: (payload) => request("/api/auth/register", {
            method: "POST",
            body: JSON.stringify(payload),
        }),
        login: (payload) => request("/api/auth/login", {
            method: "POST",
            body: JSON.stringify(payload),
        }),
        getMe: () => request("/api/auth/me"),
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
        createAiAnalysis: (submissionId, payload) => request(`/api/submissions/${submissionId}/ai-analysis`, {
            method: "POST",
            body: JSON.stringify(payload),
        }),
        generateProblemDraft: (payload, adminPassword) => request("/api/admin/problem-drafts/generate", {
            method: "POST",
            headers: {
                "X-Admin-Password": adminPassword,
            },
            body: JSON.stringify(payload),
        }),
        autoGenerateProblemDraft: (payload, adminPassword) => request("/api/admin/problem-drafts/auto-generate", {
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

    window.TedOJAuth = {
        init: initAuth,
        showAuthModal,
        isAuthenticated,
        getCurrentUser: getStoredUser,
        getToken: getAuthToken,
        logout: clearAuth,
    };
})();
