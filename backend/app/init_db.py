from sqlalchemy import inspect, text

from database import Base, engine
import models


def ensure_schema():
    Base.metadata.create_all(bind=engine)

    inspector = inspect(engine)
    problem_columns = [column["name"] for column in inspector.get_columns("problems")]

    if "judge_mode" not in problem_columns:
        with engine.begin() as connection:
            connection.execute(text(
                "ALTER TABLE problems "
                "ADD COLUMN judge_mode VARCHAR(20) NOT NULL DEFAULT 'function'"
            ))

    submission_columns = [column["name"] for column in inspector.get_columns("submissions")]

    if "user_id" not in submission_columns:
        with engine.begin() as connection:
            connection.execute(text(
                "ALTER TABLE submissions "
                "ADD COLUMN user_id INT NULL"
            ))
            connection.execute(text(
                "CREATE INDEX ix_submissions_user_id ON submissions (user_id)"
            ))


if __name__ == "__main__":
    ensure_schema()
