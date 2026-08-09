import base64
import hashlib
import hmac
import json
import os
import secrets
import time
from typing import List, Optional
from sqlalchemy import case, func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
import models
from database import get_db
from init_db import ensure_schema
import uvicorn
from fastapi import FastAPI, Depends, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from judge import judge_submission
import requests
from schemas import (
    AIAnalysisCreate,
    AIAnalysisResult,
    AIAutoProblemDraftCreate,
    AIProblemDraftCreate,
    ProblemCreate,
    ProblemCreated,
    ProblemDetail,
    ProblemListItem,
    SubmissionCreate,
    SubmissionListItem,
    SubmissionResult,
    AuthToken,
    UserAuthCreate,
    UserInfo,
)

api = FastAPI()
SUPPORTED_JUDGE_MODES = {"function", "stdio"}
SUPPORTED_KNOWLEDGE_CATEGORIES = {
    "mistake_analysis",
    "algorithm_optimization",
    "algorithm_explanation",
}
SUPPORTED_DIFFICULTIES = {"Easy", "Medium", "Hard"}
FORBIDDEN_TAGS = {"easy", "medium", "hard", "简单", "中等", "困难"}
PASSWORD_HASH_ITERATIONS = 120000
ACCESS_TOKEN_EXPIRE_SECONDS = 7 * 24 * 60 * 60

from fastapi.middleware.cors import CORSMiddleware

api.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@api.on_event("startup")
def handle_startup():
    ensure_schema()


def base64url_encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def base64url_decode(value: str) -> bytes:
    padding = "=" * (-len(value) % 4)
    return base64.urlsafe_b64decode(f"{value}{padding}".encode("ascii"))


def get_jwt_secret() -> str:
    secret = get_config_value("JWT_SECRET_KEY")
    if not secret:
        raise HTTPException(status_code=500, detail="请先配置 JWT_SECRET_KEY")
    return secret


def hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        salt.encode("utf-8"),
        PASSWORD_HASH_ITERATIONS,
    ).hex()
    return f"pbkdf2_sha256${PASSWORD_HASH_ITERATIONS}${salt}${digest}"


def verify_password(password: str, password_hash: str) -> bool:
    try:
        algorithm, iterations_text, salt, expected = password_hash.split("$", 3)
        iterations = int(iterations_text)
    except ValueError:
        return False

    if algorithm != "pbkdf2_sha256":
        return False

    actual = hashlib.pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        salt.encode("utf-8"),
        iterations,
    ).hex()
    return hmac.compare_digest(actual, expected)


def normalize_username(username: str) -> str:
    value = str(username or "").strip()
    if not value:
        raise HTTPException(status_code=400, detail="用户名不能为空")
    if len(value) > 64:
        raise HTTPException(status_code=400, detail="用户名最多 64 个字符")
    return value


def validate_password(password: str) -> str:
    value = str(password or "")
    if len(value) < 8:
        raise HTTPException(status_code=400, detail="密码至少 8 位，并且必须同时包含字母和数字")
    has_letter = any("a" <= char.lower() <= "z" for char in value)
    has_digit = any(char.isdigit() for char in value)
    if not has_letter or not has_digit:
        raise HTTPException(status_code=400, detail="密码至少 8 位，并且必须同时包含字母和数字")
    return value


def create_access_token(user: models.User) -> str:
    now = int(time.time())
    payload = {
        "sub": str(user.id),
        "username": user.username,
        "iat": now,
        "exp": now + ACCESS_TOKEN_EXPIRE_SECONDS,
    }
    header = {"alg": "HS256", "typ": "JWT"}
    signing_input = ".".join([
        base64url_encode(json.dumps(header, separators=(",", ":")).encode("utf-8")),
        base64url_encode(json.dumps(payload, separators=(",", ":")).encode("utf-8")),
    ])
    signature = hmac.new(
        get_jwt_secret().encode("utf-8"),
        signing_input.encode("ascii"),
        hashlib.sha256,
    ).digest()
    return f"{signing_input}.{base64url_encode(signature)}"


def decode_access_token(token: str) -> dict:
    try:
        header_text, payload_text, signature_text = token.split(".", 2)
        signing_input = f"{header_text}.{payload_text}"
        expected_signature = hmac.new(
            get_jwt_secret().encode("utf-8"),
            signing_input.encode("ascii"),
            hashlib.sha256,
        ).digest()
        actual_signature = base64url_decode(signature_text)
        if not hmac.compare_digest(actual_signature, expected_signature):
            raise ValueError("bad signature")

        payload = json.loads(base64url_decode(payload_text).decode("utf-8"))
        if not isinstance(payload, dict):
            raise ValueError("bad payload")
    except Exception as e:
        raise HTTPException(status_code=401, detail="登录状态无效，请重新登录") from e

    try:
        expires_at = int(payload.get("exp", 0))
    except (TypeError, ValueError) as e:
        raise HTTPException(status_code=401, detail="登录状态无效，请重新登录") from e

    if expires_at < int(time.time()):
        raise HTTPException(status_code=401, detail="登录已过期，请重新登录")

    return payload


def get_authorization_token(authorization: Optional[str]) -> Optional[str]:
    if not authorization:
        return None

    prefix = "Bearer "
    if not authorization.startswith(prefix):
        raise HTTPException(status_code=401, detail="登录状态无效，请重新登录")

    token = authorization[len(prefix):].strip()
    if not token:
        raise HTTPException(status_code=401, detail="登录状态无效，请重新登录")
    return token


def find_user_from_authorization(
    authorization: Optional[str],
    db: Session,
    required: bool,
) -> Optional[models.User]:
    token = get_authorization_token(authorization)
    if not token:
        if required:
            raise HTTPException(status_code=401, detail="请先登录")
        return None

    payload = decode_access_token(token)
    try:
        user_id = int(payload.get("sub"))
    except (TypeError, ValueError) as e:
        raise HTTPException(status_code=401, detail="登录状态无效，请重新登录") from e

    user = db.query(models.User).filter(models.User.id == user_id).first()
    if user is None:
        raise HTTPException(status_code=401, detail="登录状态无效，请重新登录")
    return user


def get_current_user(
    authorization: Optional[str] = Header(default=None, alias="Authorization"),
    db: Session = Depends(get_db),
) -> models.User:
    return find_user_from_authorization(authorization, db, required=True)


def build_user_info(user: models.User) -> dict:
    return {
        "id": user.id,
        "username": user.username,
        "created_at": user.created_at.isoformat(),
    }


def build_auth_response(user: models.User) -> dict:
    return {
        "access_token": create_access_token(user),
        "token_type": "bearer",
        "user": build_user_info(user),
    }


def normalize_judge_mode(value: Optional[str]) -> str:
    judge_mode = str(value or "function").strip().lower()
    if judge_mode not in SUPPORTED_JUDGE_MODES:
        raise HTTPException(status_code=400, detail="judge_mode 仅支持 function 或 stdio")
    return judge_mode


def normalize_knowledge_category(value: Optional[str]) -> str:
    category = str(value or "").strip()
    if category not in SUPPORTED_KNOWLEDGE_CATEGORIES:
        raise HTTPException(status_code=400, detail="知识库分类无效")
    return category


def normalize_difficulty(value: Optional[str]) -> str:
    difficulty = str(value or "").strip()
    if difficulty not in SUPPORTED_DIFFICULTIES:
        raise HTTPException(status_code=400, detail="difficulty 仅支持 Easy、Medium 或 Hard")
    return difficulty


def verify_admin_create_password(
    x_admin_password: Optional[str] = Header(default=None, alias="X-Admin-Password"),
):
    expected_password = get_config_value("ADMIN_CREATE_PASSWORD")
    if not expected_password:
        raise HTTPException(status_code=500, detail="请先配置 ADMIN_CREATE_PASSWORD")

    if not x_admin_password or x_admin_password != expected_password:
        raise HTTPException(status_code=401, detail="管理员密码错误")


def get_config_value(name: str) -> str:
    value = os.getenv(name, "").strip()
    if value:
        return value

    env_path = os.path.join(os.path.dirname(__file__), ".env")
    try:
        with open(env_path, "r", encoding="utf-8") as env_file:
            for line in env_file:
                text = line.strip()
                if not text or text.startswith("#") or "=" not in text:
                    continue

                key, raw_value = text.split("=", 1)
                if key.strip() == name:
                    return raw_value.strip().strip('"').strip("'")
    except FileNotFoundError:
        return ""

    return ""


def get_dify_workflow_url() -> str:
    workflow_url = get_config_value("DIFY_WORKFLOW_URL")
    if workflow_url:
        return workflow_url

    base_url = get_config_value("DIFY_BASE_URL").rstrip("/")
    if base_url:
        return f"{base_url}/v1/workflows/run"

    return ""


def get_dify_problem_workflow_url() -> str:
    workflow_url = get_config_value("DIFY_PROBLEM_WORKFLOW_URL")
    if workflow_url:
        return workflow_url

    return get_dify_workflow_url()


def get_dify_auto_problem_workflow_url() -> str:
    workflow_url = get_config_value("DIFY_AUTO_PROBLEM_WORKFLOW_URL")
    if workflow_url:
        return workflow_url

    return get_dify_workflow_url()


def extract_dify_answer(data: object) -> str:
    if not isinstance(data, dict):
        return str(data or "")

    outputs = data.get("outputs")
    if not isinstance(outputs, dict):
        workflow_data = data.get("data")
        outputs = workflow_data.get("outputs") if isinstance(workflow_data, dict) else None

    if isinstance(outputs, dict):
        for key in ["answer", "text", "text1", "text2", "text3"]:
            value = outputs.get(key)
            if value:
                return str(value)

        for value in outputs.values():
            if isinstance(value, str) and value:
                return value

    for key in ["answer", "text"]:
        value = data.get(key)
        if value:
            return str(value)

    return json.dumps(data, ensure_ascii=False)


def call_dify_workflow_raw(
    inputs: dict,
    api_key: Optional[str] = None,
    workflow_url: Optional[str] = None,
) -> dict:
    api_key = (api_key or get_config_value("DIFY_API_KEY")).strip()
    workflow_url = (workflow_url or get_dify_workflow_url()).strip()

    if not api_key or not workflow_url:
        raise HTTPException(status_code=500, detail="请先配置 DIFY_API_KEY 和 DIFY_WORKFLOW_URL")

    try:
        response = requests.post(
            workflow_url,
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            json={
                "inputs": inputs,
                "response_mode": "blocking",
                "user": "tedoj",
            },
            timeout=90,
        )
    except requests.RequestException as e:
        raise HTTPException(status_code=502, detail=f"Dify 请求失败：{e}") from e

    if response.status_code >= 400:
        raise HTTPException(status_code=502, detail=f"Dify 返回错误：{response.text}")

    try:
        data = response.json()
    except ValueError as e:
        raise HTTPException(status_code=502, detail="Dify 返回内容不是 JSON") from e

    return data


def call_dify_workflow(inputs: dict) -> str:
    data = call_dify_workflow_raw(inputs)
    answer = extract_dify_answer(data).strip()
    if not answer:
        raise HTTPException(status_code=502, detail="Dify 没有返回可展示内容")

    return answer


def parse_json_candidate(value: object) -> Optional[dict]:
    if isinstance(value, dict):
        if "title" in value and "test_cases" in value:
            return value

        for key in ["structured_output", "problem", "output", "result"]:
            nested = value.get(key)
            if nested is None:
                continue

            parsed = parse_json_candidate(nested)
            if isinstance(parsed, dict) and "title" in parsed and "test_cases" in parsed:
                return parsed

        return value

    if isinstance(value, str):
        text = value.strip()
        if not text:
            return None
        try:
            parsed = json.loads(text)
        except json.JSONDecodeError:
            return None
        return parse_json_candidate(parsed)

    return None


def extract_problem_draft_payload(data: object) -> dict:
    candidates = []

    if isinstance(data, dict):
        workflow_data = data.get("data")
        outputs = data.get("outputs")
        if not isinstance(outputs, dict) and isinstance(workflow_data, dict):
            outputs = workflow_data.get("outputs")

        if isinstance(outputs, dict):
            for key in ["output", "structured_output", "problem", "result", "answer", "text"]:
                if key in outputs:
                    candidates.append(outputs[key])
            candidates.extend(outputs.values())

        for key in ["structured_output", "output", "problem", "result", "answer", "text"]:
            if key in data:
                candidates.append(data[key])

    candidates.append(data)

    for candidate in candidates:
        payload = parse_json_candidate(candidate)
        if isinstance(payload, dict) and "title" in payload and "test_cases" in payload:
            return payload

    raise HTTPException(status_code=502, detail="Dify 没有返回可识别的题目 JSON")


def normalize_tags(tags: List[str]) -> List[str]:
    result = []
    for tag in tags:
        tag_name = tag.strip()
        if tag_name and tag_name not in result:
            result.append(tag_name)
    return result


def parse_tags(tags: Optional[object]) -> List[str]:
    if not tags:
        return []

    if isinstance(tags, list):
        raw_tags = tags
    else:
        text = str(tags)
        try:
            raw_tags = json.loads(text)
        except json.JSONDecodeError:
            raw_tags = text.split(',')

    if not isinstance(raw_tags, list):
        return []

    return normalize_tags([str(tag) for tag in raw_tags])


def dump_tags(tags: List[str]) -> str:
    return json.dumps(normalize_tags(tags), ensure_ascii=False)


def ensure_text(value: object, field_name: str) -> str:
    text = str(value or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail=f"{field_name} 不能为空")
    return text


def normalize_visible_case_count(value: int) -> int:
    if value < 2 or value > 8:
        raise HTTPException(status_code=400, detail="visible_case_count 必须在 2 到 8 之间")

    return value


def ensure_trailing_newline(value: str) -> str:
    return value if value.endswith("\n") else f"{value}\n"


def ensure_starter_code_can_compile(starter_code: str):
    try:
        compile(starter_code, "<starter_code>", "exec")
    except SyntaxError as e:
        raise HTTPException(status_code=400, detail=f"starter_code 不是合法 Python：{e}") from e


def normalize_ai_problem_tags(tags: List[str]) -> List[str]:
    result = normalize_tags([str(tag) for tag in tags])
    if not result:
        raise HTTPException(status_code=400, detail="tags 不能为空")

    invalid_tags = [tag for tag in result if tag.strip().lower() in FORBIDDEN_TAGS]
    if invalid_tags:
        raise HTTPException(status_code=400, detail="tags 必须是知识点标签，不能包含难度")

    return result


def validate_ai_problem_draft(problem: ProblemCreate) -> ProblemCreate:
    title = ensure_text(problem.title, "title")
    description = ensure_text(problem.description, "description")
    difficulty = normalize_difficulty(problem.difficulty)
    judge_mode = normalize_judge_mode(problem.judge_mode)
    tags = normalize_ai_problem_tags(problem.tags)
    starter_code = ensure_text(problem.starter_code, "starter_code")
    ensure_starter_code_can_compile(starter_code)

    if len(problem.test_cases) < 2:
        raise HTTPException(status_code=400, detail="test_cases 至少需要 2 个")

    normalized_cases = []
    for index, test_case in enumerate(problem.test_cases, start=1):
        if test_case.hidden:
            raise HTTPException(status_code=400, detail="当前 AI 创建页面暂不支持隐藏用例")

        if test_case.kwargs:
            raise HTTPException(status_code=400, detail=f"第 {index} 个用例的 kwargs 必须为 {{}}")

        if judge_mode == "stdio":
            if not isinstance(test_case.args, str):
                raise HTTPException(status_code=400, detail=f"第 {index} 个 stdio 用例的 args 必须是字符串")
            if not isinstance(test_case.expected, str):
                raise HTTPException(status_code=400, detail=f"第 {index} 个 stdio 用例的 expected 必须是字符串")

            normalized_cases.append(test_case.copy(update={
                "args": ensure_trailing_newline(test_case.args),
                "kwargs": {},
                "expected": ensure_trailing_newline(test_case.expected),
                "hidden": False,
            }))
        else:
            if not isinstance(test_case.args, list):
                raise HTTPException(status_code=400, detail=f"第 {index} 个 function 用例的 args 必须是数组")

            normalized_cases.append(test_case.copy(update={
                "kwargs": {},
                "hidden": False,
            }))

    function_name = str(problem.function_name or "").strip()
    if judge_mode == "stdio":
        function_name = "main"
    elif not function_name.isidentifier():
        raise HTTPException(status_code=400, detail="function_name 必须是合法 Python 函数名")

    return problem.copy(update={
        "title": title,
        "description": description,
        "difficulty": difficulty,
        "tags": tags,
        "judge_mode": judge_mode,
        "function_name": function_name,
        "starter_code": starter_code,
        "test_cases": normalized_cases,
    })


def build_problem_stats(db: Session, problem_ids: List[int]) -> dict:
    if not problem_ids:
        return {}

    rows = db.query(
        models.Submission.problem_id,
        func.count(models.Submission.id),
        func.sum(case((models.Submission.status == "Accepted", 1), else_=0)),
    ).filter(
        models.Submission.problem_id.in_(problem_ids)
    ).group_by(
        models.Submission.problem_id
    ).all()

    stats = {}
    for problem_id, total, accepted in rows:
        submission_count = int(total or 0)
        accepted_count = int(accepted or 0)
        stats[problem_id] = {
            "submission_count": submission_count,
            "accepted_count": accepted_count,
            "acceptance_rate": round(accepted_count * 100 / submission_count, 1) if submission_count else None,
        }

    return stats


def get_problem_stat(stats: dict, problem_id: int) -> dict:
    return stats.get(problem_id, {
        "submission_count": 0,
        "accepted_count": 0,
        "acceptance_rate": None,
    })


def build_problem_created_response(db_problem, test_case_count: int) -> dict:
    return {
        'id': db_problem.id,
        'title': db_problem.title,
        'difficulty': db_problem.difficulty,
        'tags': parse_tags(db_problem.tags),
        'judge_mode': normalize_judge_mode(getattr(db_problem, "judge_mode", None)),
        'function_name': db_problem.function_name,
        'test_case_count': test_case_count,
        'created_at': db_problem.created_at.isoformat(),
    }


def create_problem_record(problem: ProblemCreate, db: Session) -> dict:
    judge_mode = normalize_judge_mode(problem.judge_mode)

    db_problem = models.Problem(
        title=problem.title,
        description=problem.description,
        difficulty=problem.difficulty,
        tags=dump_tags(problem.tags),
        judge_mode=judge_mode,
        function_name=problem.function_name,
        starter_code=problem.starter_code,
    )

    db.add(db_problem)
    db.flush()

    for test_case in problem.test_cases:
        db_test_case = models.TestCase(
            problem_id=db_problem.id,
            args=test_case.args,
            kwargs=test_case.kwargs,
            expected=test_case.expected,
            hidden=test_case.hidden,
        )
        db.add(db_test_case)

    db.commit()
    db.refresh(db_problem)

    return build_problem_created_response(db_problem, len(problem.test_cases))


@api.get('/api/health')  # 健康测试
async def handle_test():
    return {'status': 'ok'}


@api.post('/api/auth/register', response_model=AuthToken)
def handle_register(payload: UserAuthCreate, db: Session = Depends(get_db)):
    get_jwt_secret()
    username = normalize_username(payload.username)
    password = validate_password(payload.password)

    if db.query(models.User).filter(models.User.username == username).first() is not None:
        raise HTTPException(status_code=400, detail="用户名已存在")

    user = models.User(
        username=username,
        password_hash=hash_password(password),
    )
    db.add(user)

    try:
        db.commit()
    except IntegrityError as e:
        db.rollback()
        raise HTTPException(status_code=400, detail="用户名已存在") from e

    db.refresh(user)
    return build_auth_response(user)


@api.post('/api/auth/login', response_model=AuthToken)
def handle_login(payload: UserAuthCreate, db: Session = Depends(get_db)):
    get_jwt_secret()
    username = normalize_username(payload.username)
    user = db.query(models.User).filter(models.User.username == username).first()

    if user is None or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=401, detail="用户名或密码错误")

    return build_auth_response(user)


@api.get('/api/auth/me', response_model=UserInfo)
def handle_get_current_user(current_user: models.User = Depends(get_current_user)):
    return build_user_info(current_user)


@api.get('/api/problems', response_model=List[ProblemListItem])  # 获取题目列表
def handle_get_problems(db: Session = Depends(get_db)):
    problems = db.query(models.Problem).filter(models.Problem.is_active == True).all()
    stats = build_problem_stats(db, [problem.id for problem in problems])

    result = []
    for problem in problems:
        problem_stats = get_problem_stat(stats, problem.id)
        result.append({
            'id': problem.id,
            'title': problem.title,
            'difficulty': problem.difficulty,
            'tags': parse_tags(problem.tags),
            'judge_mode': normalize_judge_mode(getattr(problem, "judge_mode", None)),
            'submission_count': problem_stats["submission_count"],
            'accepted_count': problem_stats["accepted_count"],
            'acceptance_rate': problem_stats["acceptance_rate"],
            'is_active': problem.is_active,
            'created_at': problem.created_at.isoformat(),
        })

    return result


@api.get('/api/problems/{problem_id}', response_model=ProblemDetail)  # 获取题目详情
def handle_get_problems_list(problem_id: int, db: Session = Depends(get_db)):
    problem = db.query(models.Problem).filter(models.Problem.id == problem_id).first()

    if problem is None:
        raise HTTPException(status_code=404, detail='题目不存在')

    test_cases = db.query(models.TestCase).filter(
        models.TestCase.problem_id == problem_id,
        models.TestCase.hidden == False
    ).all()

    visible_test_cases = []
    for test_case in test_cases:
        visible_test_cases.append({
            'id': test_case.id,
            'args': test_case.args,
            'kwargs': test_case.kwargs,
            'expected': test_case.expected,
        })

    problem_stats = get_problem_stat(build_problem_stats(db, [problem.id]), problem.id)

    return {
        'id': problem.id,
        'title': problem.title,
        'description': problem.description,
        'difficulty': problem.difficulty,
        'tags': parse_tags(problem.tags),
        'judge_mode': normalize_judge_mode(getattr(problem, "judge_mode", None)),
        'function_name': problem.function_name,
        'starter_code': problem.starter_code,
        'submission_count': problem_stats["submission_count"],
        'accepted_count': problem_stats["accepted_count"],
        'acceptance_rate': problem_stats["acceptance_rate"],
        'visible_test_cases': visible_test_cases,
        'created_at': problem.created_at.isoformat(),
    }


@api.post('/api/admin/problem-drafts/generate', response_model=ProblemCreate)
def handle_generate_ai_problem_draft(
    draft_request: AIProblemDraftCreate,
    _admin: None = Depends(verify_admin_create_password),
):
    problem_requirement = ensure_text(draft_request.problem_requirement, "problem_requirement")
    judge_mode = normalize_judge_mode(draft_request.judge_mode)
    difficulty = normalize_difficulty(draft_request.difficulty)
    visible_case_count = normalize_visible_case_count(draft_request.visible_case_count)

    raw_data = call_dify_workflow_raw(
        {
            "problem_name": str(draft_request.problem_name or "").strip(),
            "judge_mode": judge_mode,
            "problem_requirement": problem_requirement,
            "difficulty": difficulty,
            "difficulty_": difficulty,
            "tags": str(draft_request.tags or "").strip(),
            "visible_case_count": visible_case_count,
        },
        api_key=get_config_value("DIFY_PROBLEM_API_KEY"),
        workflow_url=get_dify_problem_workflow_url(),
    )
    payload = extract_problem_draft_payload(raw_data)

    try:
        problem = ProblemCreate(**payload)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Dify 返回题目结构无效：{e}") from e

    return validate_ai_problem_draft(problem)


@api.post('/api/admin/problem-drafts/auto-generate', response_model=ProblemCreate)
def handle_auto_generate_ai_problem_draft(
    draft_request: AIAutoProblemDraftCreate,
    db: Session = Depends(get_db),
    _admin: None = Depends(verify_admin_create_password),
):
    visible_case_count = normalize_visible_case_count(draft_request.visible_case_count)
    api_key = get_config_value("DIFY_AUTO_PROBLEM_API_KEY")
    workflow_url = get_dify_auto_problem_workflow_url()
    if not api_key or not workflow_url:
        raise HTTPException(
            status_code=500,
            detail="请先配置 DIFY_AUTO_PROBLEM_API_KEY，并配置 DIFY_AUTO_PROBLEM_WORKFLOW_URL 或 DIFY_WORKFLOW_URL",
        )

    recent_problems = db.query(models.Problem).filter(
        models.Problem.is_active == True
    ).order_by(models.Problem.id.desc()).limit(20).all()

    raw_data = call_dify_workflow_raw(
        {
            "generation_mode": "auto",
            "visible_case_count": visible_case_count,
            "supported_judge_modes": "stdio,function",
            "supported_difficulties": "Easy,Medium,Hard",
            "forbidden_tags": "Easy,Medium,Hard,简单,中等,困难",
            "existing_problems": json.dumps([
                {
                    "id": problem.id,
                    "title": problem.title,
                    "difficulty": problem.difficulty,
                    "tags": parse_tags(problem.tags),
                    "judge_mode": normalize_judge_mode(getattr(problem, "judge_mode", None)),
                }
                for problem in recent_problems
            ], ensure_ascii=False),
        },
        api_key=api_key,
        workflow_url=workflow_url,
    )
    payload = extract_problem_draft_payload(raw_data)

    try:
        problem = ProblemCreate(**payload)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Dify 返回题目结构无效：{e}") from e

    return validate_ai_problem_draft(problem)


@api.post('/api/admin/problem-drafts/save', response_model=ProblemCreated)
def handle_save_ai_problem_draft(
    problem: ProblemCreate,
    db: Session = Depends(get_db),
    _admin: None = Depends(verify_admin_create_password),
):
    return create_problem_record(validate_ai_problem_draft(problem), db)


@api.post('/api/problems', response_model=ProblemCreated)  # 创建题目
def handle_post_problems(problem: ProblemCreate, db: Session = Depends(get_db)):  # 用depends来实现fastapi自动管理dp
    return create_problem_record(problem, db)


@api.post('/api/problems/{problem_id}/submissions', response_model=SubmissionResult)  # 提交代码
def handle_post_submission(
    problem_id: int,
    submission: SubmissionCreate,
    authorization: Optional[str] = Header(default=None, alias="Authorization"),
    db: Session = Depends(get_db),
):
    current_user = find_user_from_authorization(authorization, db, required=False)
    problem = db.query(models.Problem).filter(models.Problem.id == problem_id).first()

    if problem is None:
        raise HTTPException(status_code=404, detail='题目不存在')

    language = submission.language.strip().lower()

    if language != "python":
        raise HTTPException(status_code=400, detail="当前仅支持 Python")

    test_cases = db.query(models.TestCase).filter(
        models.TestCase.problem_id == problem_id
    ).all()

    judge_result = judge_submission(
        submission.code,
        problem.function_name,
        test_cases,
        normalize_judge_mode(getattr(problem, "judge_mode", None)),
    )

    db_submission = models.Submission(
        problem_id=problem_id,
        user_id=current_user.id if current_user else None,
        language=language,
        code=submission.code,
        status=judge_result["status"],
        passed_cases=judge_result["passed_cases"],
        total_cases=judge_result["total_cases"],
        runtime_ms=judge_result["runtime_ms"],
        error_message=judge_result["error_message"],
        case_results=judge_result["case_results"],
    )

    db.add(db_submission)
    db.commit()
    db.refresh(db_submission)

    return {
        'id': db_submission.id,
        'problem_id': db_submission.problem_id,
        'user_id': db_submission.user_id,
        'language': db_submission.language,
        'code': db_submission.code,
        'status': db_submission.status,
        'passed_cases': db_submission.passed_cases,
        'total_cases': db_submission.total_cases,
        'runtime_ms': db_submission.runtime_ms,
        'error_message': db_submission.error_message,
        'case_results': db_submission.case_results,
        'created_at': db_submission.created_at.isoformat(),
    }


@api.get('/api/submissions', response_model=List[SubmissionListItem])  # 获取提交列表
def handle_get_problems_submissions(
    problem_id: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    query = db.query(models.Submission).filter(models.Submission.user_id == current_user.id)

    if problem_id is not None:
        query = query.filter(models.Submission.problem_id == problem_id)

    submissions = query.order_by(models.Submission.id.desc()).all()

    result = []
    for submission in submissions:
        result.append({
            'id': submission.id,
            'problem_id': submission.problem_id,
            'user_id': submission.user_id,
            'language': submission.language,
            'status': submission.status,
            'passed_cases': submission.passed_cases,
            'total_cases': submission.total_cases,
            'runtime_ms': submission.runtime_ms,
            'created_at': submission.created_at.isoformat(),
        })

    return result


@api.get('/api/submissions/{submission_id}', response_model=SubmissionResult)  # 获取提交详情
def handle_get_submission_detail(
    submission_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    submission = db.query(models.Submission).filter(
        models.Submission.id == submission_id
    ).first()

    if submission is None:
        raise HTTPException(status_code=404, detail='提交记录不存在')

    if submission.user_id != current_user.id:
        raise HTTPException(status_code=403, detail='不能查看别人的提交记录')

    return {
        'id': submission.id,
        'problem_id': submission.problem_id,
        'user_id': submission.user_id,
        'language': submission.language,
        'code': submission.code,
        'status': submission.status,
        'passed_cases': submission.passed_cases,
        'total_cases': submission.total_cases,
        'runtime_ms': submission.runtime_ms,
        'error_message': submission.error_message,
        'case_results': submission.case_results,
        'created_at': submission.created_at.isoformat(),
    }


@api.post('/api/submissions/{submission_id}/ai-analysis', response_model=AIAnalysisResult)
def handle_post_submission_ai_analysis(
    submission_id: int,
    analysis: AIAnalysisCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    submission = db.query(models.Submission).filter(
        models.Submission.id == submission_id
    ).first()

    if submission is None:
        raise HTTPException(status_code=404, detail='提交记录不存在')

    if submission.user_id != current_user.id:
        raise HTTPException(status_code=403, detail='只能分析自己的提交记录')

    problem = db.query(models.Problem).filter(
        models.Problem.id == submission.problem_id
    ).first()

    if problem is None:
        raise HTTPException(status_code=404, detail='题目不存在')

    judge_payload = {
        "status": submission.status,
        "passed_cases": submission.passed_cases,
        "total_cases": submission.total_cases,
        "runtime_ms": submission.runtime_ms,
        "error_message": submission.error_message,
        "case_results": submission.case_results,
    }

    inputs = {
        "knowledge_category": normalize_knowledge_category(analysis.knowledge_category),
        "question": analysis.question.strip() or "请分析这次提交结果",
        "code": submission.code,
        "judge_result": json.dumps(judge_payload, ensure_ascii=False, indent=2),
        "problem_title": problem.title,
        "judge_mode": normalize_judge_mode(getattr(problem, "judge_mode", None)),
        "judge_status": submission.status,
    }

    return {
        "answer": call_dify_workflow(inputs),
    }


if __name__ == '__main__':
    uvicorn.run(
        'main:api',
        host='127.0.0.1',
        port=8010,
        reload=True
    )
