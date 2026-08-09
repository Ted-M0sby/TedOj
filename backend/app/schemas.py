from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


class TestCaseCreate(BaseModel):
    args: Any = Field(default_factory=list)
    kwargs: Dict[str, Any] = Field(default_factory=dict)
    expected: Any
    hidden: bool = False


class TestCaseVisible(BaseModel):
    id: int
    args: Any
    kwargs: Dict[str, Any]
    expected: Any


class ProblemCreate(BaseModel):
    title: str
    description: str
    difficulty: str
    tags: List[str] = Field(default_factory=list)
    judge_mode: str = "function"
    function_name: str = "solution"
    starter_code: str
    test_cases: List[TestCaseCreate]


class AIProblemDraftCreate(BaseModel):
    problem_name: str = ""
    judge_mode: str = "stdio"
    problem_requirement: str
    difficulty: str
    tags: str = ""
    visible_case_count: int = 3


class AIAutoProblemDraftCreate(BaseModel):
    visible_case_count: int = 3


class ProblemListItem(BaseModel):
    id: int
    title: str
    difficulty: str
    tags: List[str]
    judge_mode: str
    is_active: bool
    created_at: str


class ProblemDetail(BaseModel):
    id: int
    title: str
    description: str
    difficulty: str
    tags: List[str]
    judge_mode: str
    function_name: str
    starter_code: str
    visible_test_cases: List[TestCaseVisible]
    created_at: str


class ProblemCreated(BaseModel):
    id: int
    title: str
    difficulty: str
    tags: List[str]
    judge_mode: str
    function_name: str
    test_case_count: int
    created_at: str


class SubmissionCreate(BaseModel):
    language: str
    code: str


class CaseResult(BaseModel):
    case_index: int
    status: str
    runtime_ms: int
    hidden: bool
    args: Optional[Any] = None
    kwargs: Optional[Dict[str, Any]] = None
    expected: Optional[Any] = None
    actual: Optional[Any] = None
    error_message: Optional[str] = None


class SubmissionResult(BaseModel):
    id: int
    problem_id: int
    language: str
    code: str
    status: str
    passed_cases: int
    total_cases: int
    runtime_ms: int
    error_message: Optional[str] = None
    case_results: List[CaseResult]
    created_at: str


class SubmissionListItem(BaseModel):
    id: int
    problem_id: int
    language: str
    status: str
    passed_cases: int
    total_cases: int
    runtime_ms: int
    created_at: str


class AIAnalysisCreate(BaseModel):
    knowledge_category: str
    question: str = "请分析这次提交结果"


class AIAnalysisResult(BaseModel):
    answer: str
