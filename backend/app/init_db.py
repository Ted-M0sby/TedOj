from sqlalchemy import inspect, text

from database import Base, engine
import models


def ensure_schema():
    Base.metadata.create_all(bind=engine)

    inspector = inspect(engine)
    columns = [column["name"] for column in inspector.get_columns("problems")]

    if "judge_mode" not in columns:
        with engine.begin() as connection:
            connection.execute(text(
                "ALTER TABLE problems "
                "ADD COLUMN judge_mode VARCHAR(20) NOT NULL DEFAULT 'function'"
            ))


if __name__ == "__main__":
    ensure_schema()
