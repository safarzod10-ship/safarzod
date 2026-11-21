from datetime import datetime, timezone

from decimal import Decimal

from sqlalchemy import (JSON, BigInteger, Boolean, DateTime, ForeignKey, Index, Integer, Numeric, String, Text,
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
    role: Mapped[str] = mapped_column(String(8), default="client")
    is_admin: Mapped[bool] = mapped_column(Boolean, default=False)
    strikes: Mapped[int] = mapped_column(Integer, default=0)
    ban_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    ban_permanent: Mapped[bool] = mapped_column(Boolean, default=False)
    bot_started: Mapped[bool] = mapped_column(Boolean, default=False)
    onboarded: Mapped[bool] = mapped_column(Boolean, default=False)
    pro_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    alerts: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    @property
    def name(self) -> str:
        return " ".join(x for x in (self.first_name, self.last_name) if x) or (self.username or f"id{self.id}")

    def pro(self, now: datetime | None = None) -> bool:
        until = self.pro_until
        if until is not None and until.tzinfo is None:
            until = until.replace(tzinfo=timezone.utc)
        return until is not None and until > (now or utcnow())

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
    rate: Mapped[int] = mapped_column(Integer, default=0)
    status: Mapped[str] = mapped_column(String(8), default="free")
    busy_until: Mapped[str | None] = mapped_column(String(32))
    about: Mapped[str] = mapped_column(Text, default="")
    github: Mapped[str | None] = mapped_column(String(64))
    links: Mapped[list] = mapped_column(JSON, default=list)
    portfolio: Mapped[list] = mapped_column(JSON, default=list)
    moderation: Mapped[str] = mapped_column(String(10), default="review")
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
    status: Mapped[str] = mapped_column(String(10), default="open")
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
    status: Mapped[str] = mapped_column(String(18), default="awaiting_payment")
    result: Mapped[str | None] = mapped_column(String(14))
    due_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    fee: Mapped[Decimal | None] = mapped_column(Numeric(12, 2))
    invoice_id: Mapped[int | None] = mapped_column(BigInteger)
    invoice_url: Mapped[str | None] = mapped_column(String(512))
    paid_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    review_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    work_note: Mapped[str | None] = mapped_column(Text)
    dispute_by: Mapped[int | None] = mapped_column(BigInteger)
    dispute_reason: Mapped[str | None] = mapped_column(Text)
    dev_share: Mapped[int | None] = mapped_column(Integer)
    resolution: Mapped[str | None] = mapped_column(Text)

    @property
    def total(self) -> Decimal:
        return Decimal(self.amount) + (self.fee or Decimal(0))


class Payment(Base):
    __tablename__ = "payments"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    deal_id: Mapped[int] = mapped_column(Integer, ForeignKey("deals.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(10))
    user_id: Mapped[int] = mapped_column(BigInteger)
    amount: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    asset: Mapped[str] = mapped_column(String(10), default="USDT")
    status: Mapped[str] = mapped_column(String(10))
    spend_id: Mapped[str | None] = mapped_column(String(64), unique=True)
    external_id: Mapped[int | None] = mapped_column(BigInteger)
    url: Mapped[str | None] = mapped_column(String(512))
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    error: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


class Review(Base):
    __tablename__ = "reviews"
    __table_args__ = (UniqueConstraint("deal_id", "author_id", name="uq_reviews_deal_author"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    deal_id: Mapped[int] = mapped_column(Integer, ForeignKey("deals.id", ondelete="CASCADE"), index=True)
    author_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.id"))
    target_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.id"), index=True)
    rating: Mapped[int] = mapped_column(Integer)
    text: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Chat(Base):
    __tablename__ = "chats"
    __table_args__ = (UniqueConstraint("a_id", "b_id"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    a_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.id"), index=True)
    b_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.id"), index=True)
    deal_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("deals.id", ondelete="SET NULL"))
    a_read: Mapped[int] = mapped_column(Integer, default=0)
    b_read: Mapped[int] = mapped_column(Integer, default=0)
    a_notified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    b_notified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    a_hidden: Mapped[int | None] = mapped_column(Integer)
    b_hidden: Mapped[int | None] = mapped_column(Integer)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)


class Message(Base):
    __tablename__ = "messages"
    __table_args__ = (Index("ix_messages_chat_id_id", "chat_id", "id"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    chat_id: Mapped[int] = mapped_column(Integer, ForeignKey("chats.id", ondelete="CASCADE"))
    sender_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("users.id"))
    text: Mapped[str] = mapped_column(Text)
    flagged: Mapped[bool] = mapped_column(Boolean, default=False)
    offer_id: Mapped[int | None] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Offer(Base):
    __tablename__ = "offers"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    chat_id: Mapped[int] = mapped_column(Integer, ForeignKey("chats.id", ondelete="CASCADE"), index=True)
    from_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.id"))
    to_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.id"), index=True)
    client_id: Mapped[int] = mapped_column(BigInteger)
    dev_id: Mapped[int] = mapped_column(BigInteger)
    project_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("projects.id", ondelete="SET NULL"))
    parent_id: Mapped[int | None] = mapped_column(Integer)
    title: Mapped[str] = mapped_column(String(120))
    amount: Mapped[int] = mapped_column(Integer)
    days: Mapped[int] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(String(10), default="pending", index=True)
    deal_id: Mapped[int | None] = mapped_column(Integer)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Attachment(Base):
    __tablename__ = "attachments"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    message_id: Mapped[int] = mapped_column(Integer, ForeignKey("messages.id", ondelete="CASCADE"), index=True)
    chat_id: Mapped[int] = mapped_column(Integer, ForeignKey("chats.id", ondelete="CASCADE"), index=True)
    path: Mapped[str] = mapped_column(String(255))
    name: Mapped[str] = mapped_column(String(160))
    mime: Mapped[str] = mapped_column(String(80))
    size: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Invite(Base):
    __tablename__ = "invites"
    __table_args__ = (UniqueConstraint("project_id", "dev_id"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    project_id: Mapped[int] = mapped_column(Integer, ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    dev_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.id", ondelete="CASCADE"), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Subscription(Base):
    __tablename__ = "subscriptions"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.id"), index=True)
    method: Mapped[str] = mapped_column(String(8))
    amount: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    currency: Mapped[str] = mapped_column(String(8))
    days: Mapped[int] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(String(10), default="pending")
    external_id: Mapped[str | None] = mapped_column(String(128))
    url: Mapped[str | None] = mapped_column(String(512))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    paid_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Complaint(Base):
    __tablename__ = "complaints"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    from_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.id"), index=True)
    against_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.id"), index=True)
    deal_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("deals.id", ondelete="SET NULL"))
    reason: Mapped[str] = mapped_column(String(20))
    text: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(10), default="new")
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
