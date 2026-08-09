from database import Base
from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.mysql import JSON
from sqlalchemy.orm import relationship
from datetime import datetime


class Problem(Base):
    __tablename__ = 'problems'

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String(100), nullable=False)
    description = Column(Text, nullable=False)
    difficulty = Column(String(20), nullable=False)
    tags = Column(Text, nullable=True)
    judge_mode = Column(String(20), nullable=False, default='function', server_default='function')
    function_name = Column(String(100), nullable=False)
    starter_code = Column(Text, nullable=False)
    is_active = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime, default=datetime.now)


class User(Base):
    __tablename__ = 'users'

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String(64), nullable=False, unique=True, index=True)
    password_hash = Column(String(255), nullable=False)
    created_at = Column(DateTime, default=datetime.now)


class TestCase(Base):
    __tablename__ = 'test_cases'

    id = Column(Integer, primary_key=True, index=True)
    problem_id = Column(Integer, ForeignKey('problems.id'), nullable=False)
    args = Column(JSON, nullable=False)
    kwargs = Column(JSON, nullable=False)
    expected = Column(JSON, nullable=False)
    hidden = Column(Boolean, nullable=False, default=False)
    created_at = Column(DateTime, default=datetime.now)


class Submission(Base):
    __tablename__ = 'submissions'

    id = Column(Integer, primary_key=True, index=True)
    problem_id = Column(Integer, ForeignKey('problems.id'), nullable=False)
    user_id = Column(Integer, ForeignKey('users.id'), nullable=True, index=True)
    language = Column(String(30), nullable=False)
    code = Column(Text, nullable=False)
    status = Column(String(20), nullable=False)
    passed_cases = Column(Integer, nullable=False, default=0)
    total_cases = Column(Integer, nullable=False, default=0)
    runtime_ms = Column(Integer, nullable=False, default=0)
    error_message = Column(Text, nullable=True)
    case_results = Column(JSON, nullable=False)
    created_at = Column(DateTime, default=datetime.now)
