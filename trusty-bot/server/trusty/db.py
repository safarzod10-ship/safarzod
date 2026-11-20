from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from .config import settings
from .models import Base

engine = create_async_engine(settings.db_url, pool_pre_ping=True,
                             **({} if settings.db_url.startswith("sqlite") else {"pool_size": 5, "max_overflow": 5}))
Session = async_sessionmaker(engine, expire_on_commit=False)


async def init_db() -> None:
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


async def get_session():
    async with Session() as s:
        yield s


__all__ = ["engine", "Session", "AsyncSession", "init_db", "get_session"]
