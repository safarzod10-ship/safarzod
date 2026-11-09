from sqlalchemy.ext.asyncio import AsyncSession

from app.models import AuditLog


async def record(session: AsyncSession, admin_id: int, action: str, target: str = "", **details) -> None:
    session.add(AuditLog(admin_id=admin_id, action=action, target=str(target), details=details))
    await session.flush()
