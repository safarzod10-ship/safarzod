"""Database schema. Users are keyed by their Telegram id."""
from datetime import datetime, timezone

from sqlalchemy import (JSON, BigInteger, Boolean, DateTime, ForeignKey, Index, Integer, String, Text,
                        UniqueConstraint)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=False)
    username: Mapped[str | None] = mapped_column(String(64))
    first_name: Mapped[str] = mapped_column(String(128), default="")
    last_name: Mapped[str | None] = mapped_column(String(128))
    role: Mapped[str] = mapped_column(String(8), default="client")  # client | dev
    is_admin: Mapped[bool] = mapped_column(Boolean, default=False)
    strikes: Mapped[int] = mapped_column(Integer, default=0)
    ban_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    ban_permanent: Mapped[bool] = mapped_column(Boolean, default=False)
    bot_started: Mapped[bool] = mapped_column(Boolean, default=False)  # pressed /start, can get notifications
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    @property
    def name(self) -> str:
        return " ".join(x for x in (self.first_name, self.last_name) if x) or (self.username or f"id{self.id}")

    def banned(self, now: datetime | None = None) -> bool:
        now = now or utcnow()
        until = self.ban_until
        if until is not None and until.tzinfo is None:
            until = until.replace(tzinfo=timezone.utc)
        return self.ban_permanent or (until is not None and until > now)


class DevProfile(Base):
    __tablename__ = "dev_profiles"
    user_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    title: Mapped[str] = mapped_column(String(120), default="")
    categories: Mapped[list] = mapped_column(JSON, default=list)
    stack: Mapped[list] = mapped_column(JSON, default=list)
    years: Mapped[int] = mapped_column(Integer, default=0)
    rate: Mapped[int] = mapped_column(Integer, default=0)  # USDT per hour
    status: Mapped[str] = mapped_column(String(8), default="free")  # free | busy | away
    busy_until: Mapped[str | None] = mapped_column(String(32))
    about: Mapped[str] = mapped_column(Text, default="")
    github: Mapped[str | None] = mapped_column(String(64))
    links: Mapped[list] = mapped_column(JSON, default=list)
    portfolio: Mapped[list] = mapped_column(JSON, default=list)  # [{title, text}]
    moderation: Mapped[str] = mapped_column(String(10), default="review")  # review | published | rejected
    moderation_note: Mapped[str | None] = mapped_column(Text)
    deposit: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


class Project(Base):
    __tablename__ = "projects"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    client_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(120))
    category: Mapped[str] = mapped_column(String(16))
    text: Mapped[str] = mapped_column(Text)
    budget_min: Mapped[int] = mapped_column(Integer)
    budget_max: Mapped[int] = mapped_column(Integer)
    days: Mapped[int] = mapped_column(Integer)
    stack: Mapped[list] = mapped_column(JSON, default=list)
    files: Mapped[list] = mapped_column(JSON, default=list)
    status: Mapped[str] = mapped_column(String(10), default="open")  # open | in_work | closed
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)


class Bid(Base):
    __tablename__ = "bids"
    __table_args__ = (UniqueConstraint("project_id", "dev_id"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    project_id: Mapped[int] = mapped_column(Integer, ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    dev_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.id", ondelete="CASCADE"), index=True)
    price: Mapped[int] = mapped_column(Integer)
    days: Mapped[int] = mapped_column(Integer)
    text: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Deal(Base):
    __tablename__ = "deals"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    project_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("projects.id", ondelete="SET NULL"))
    client_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.id"), index=True)
    dev_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.id"), index=True)
    title: Mapped[str] = mapped_column(String(120))
    category: Mapped[str] = mapped_column(String(16), default="")
    amount: Mapped[int] = mapped_column(Integer)
    days: Mapped[int] = mapped_column(Integer)
    # awaiting_payment | in_work | review | done | dispute | cancelled
    status: Mapped[str] = mapped_column(String(18), default="awaiting_payment")
    result: Mapped[str | None] = mapped_column(String(14))  # ontime | late | dispute_won | dispute_lost
    due_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Review(Base):
    __tablename__ = "reviews"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    deal_id: Mapped[int] = mapped_column(Integer, ForeignKey("deals.id", ondelete="CASCADE"), unique=True)
    author_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.id"))
    target_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.id"), index=True)
    rating: Mapped[int] = mapped_column(Integer)
    text: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Chat(Base):
    """A conversation between two users (a_id < b_id); the latest deal between them is attached."""
    __tablename__ = "chats"
    __table_args__ = (UniqueConstraint("a_id", "b_id"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    a_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.id"), index=True)
    b_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.id"), index=True)
    deal_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("deals.id", ondelete="SET NULL"))
    a_read: Mapped[int] = mapped_column(Integer, default=0)  # last message id read by a
    b_read: Mapped[int] = mapped_column(Integer, default=0)
    a_notified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    b_notified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)


class Message(Base):
    __tablename__ = "messages"
    __table_args__ = (Index("ix_messages_chat_id_id", "chat_id", "id"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    chat_id: Mapped[int] = mapped_column(Integer, ForeignKey("chats.id", ondelete="CASCADE"))
    sender_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("users.id"))  # None = system message
    text: Mapped[str] = mapped_column(Text)
    flagged: Mapped[bool] = mapped_column(Boolean, default=False)  # looked like an attempt to go off-platform
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Complaint(Base):
    __tablename__ = "complaints"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    from_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.id"), index=True)
    against_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.id"), index=True)
    deal_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("deals.id", ondelete="SET NULL"))
    reason: Mapped[str] = mapped_column(String(20))
    text: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(10), default="new")  # new | review | resolved | rejected
    decision: Mapped[str | None] = mapped_column(Text)
    handled_by: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)


class Evidence(Base):
    __tablename__ = "evidence"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    complaint_id: Mapped[int] = mapped_column(Integer, ForeignKey("complaints.id", ondelete="CASCADE"), index=True)
    path: Mapped[str] = mapped_column(String(255))
    mime: Mapped[str] = mapped_column(String(40))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
