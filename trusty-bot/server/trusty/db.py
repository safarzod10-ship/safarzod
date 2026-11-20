from sqlalchemy import inspect
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from .config import settings
from .models import Base

engine = create_async_engine(settings.db_url, pool_pre_ping=True,
                             **({} if settings.db_url.startswith("sqlite") else {"pool_size": 5, "max_overflow": 5}))
Session = async_sessionmaker(engine, expire_on_commit=False)


# Columns added after the first release: (table, column, SQL type with default). create_all only creates missing
# tables, so new columns of existing tables are added here.
TS = "TIMESTAMP WITH TIME ZONE"
MIGRATIONS = [
    ("users", "onboarded", "BOOLEAN NOT NULL DEFAULT FALSE"),
    ("deals", "fee", "NUMERIC(12, 2)"),
    ("deals", "invoice_id", "BIGINT"),
    ("deals", "invoice_url", "VARCHAR(512)"),
    ("deals", "paid_at", TS),
    ("deals", "submitted_at", TS),
    ("deals", "review_until", TS),
    ("deals", "work_note", "TEXT"),
    ("deals", "dispute_by", "BIGINT"),
    ("deals", "dispute_reason", "TEXT"),
    ("deals", "dev_share", "INTEGER"),
    ("deals", "resolution", "TEXT"),
]


def _add_missing_columns(sync_conn) -> None:
    insp = inspect(sync_conn)
    for table, column, ddl in MIGRATIONS:
        if column not in {c["name"] for c in insp.get_columns(table)}:
            sync_conn.exec_driver_sql(f"ALTER TABLE {table} ADD COLUMN {column} {ddl}")


async def init_db() -> None:
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        await conn.run_sync(_add_missing_columns)


async def get_session():
    async with Session() as s:
        yield s


__all__ = ["engine", "Session", "AsyncSession", "init_db", "get_session"]
