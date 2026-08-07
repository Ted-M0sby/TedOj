# TedOJ README

TedOJ 是一个轻量级在线判题平台，支持函数题和标准输入输出题，并接入 Dify 工作流提供 AI 提交分析和 AI 出题能力。

## 功能

- 题目列表
- 题目详情
- Python 代码提交
- 判题结果展示
- 提交记录
- `function` 函数题判题
- `stdio` 标准输入输出判题
- Dify AI 分析提交
- Dify AI 生成题目草稿
- 管理员预览并确认保存题目

## 技术栈

- 后端：FastAPI
- 数据库：MySQL
- ORM：SQLAlchemy
- 前端：HTML、CSS、JavaScript
- AI 工作流：Dify

## 本地运行

安装依赖：

```powershell
pip install fastapi uvicorn sqlalchemy pymysql requests pydantic
```

创建 MySQL 数据库：

```sql
CREATE DATABASE tedoj CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

创建后端配置文件：

```text
backend/app/.env
```

示例：

```env
DATABASE_URL=mysql+pymysql://用户名:密码@127.0.0.1:3306/tedoj?charset=utf8mb4
DIFY_API_KEY=your_dify_analysis_key
DIFY_WORKFLOW_URL=https://api.dify.ai/v1/workflows/run
DIFY_PROBLEM_API_KEY=your_dify_problem_key
ADMIN_CREATE_PASSWORD=your_admin_password
```

启动后端：

```powershell
cd backend/app
python -m uvicorn main:api --host 127.0.0.1 --port 8010 --reload
```

打开前端：

```text
frontend/main.html
```

## 主要页面

```text
frontend/main.html                 题目列表
frontend/problem.html              题目详情与提交
frontend/submissions.html          提交记录
frontend/admin-create-problem.html AI 创建题目
```

## 主要接口

```text
GET  /api/problems
GET  /api/problems/{problem_id}
POST /api/problems/{problem_id}/submissions
GET  /api/submissions
GET  /api/submissions/{submission_id}
POST /api/submissions/{submission_id}/ai-analysis
POST /api/admin/problem-drafts/generate
POST /api/admin/problem-drafts/save
```

## Git 忽略内容

不要提交：

```text
backend/app/.env
.venv/
__pycache__/
*.pyc
.idea/
.codex-backup/
```



