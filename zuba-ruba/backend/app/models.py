import uuid
from datetime import date, datetime

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


def _now():
    return mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=False)
    first_name: Mapped[str] = mapped_column(String(256), default="")
    last_name: Mapped[str | None] = mapped_column(String(256))
    username: Mapped[str | None] = mapped_column(String(64), index=True)
    language_code: Mapped[str | None] = mapped_column(String(16))
    photo_url: Mapped[str | None] = mapped_column(Text)
    is_premium: Mapped[bool] = mapped_column(Boolean, default=False)
    ref_code: Mapped[str] = mapped_column(String(16), unique=True)
    referrer_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("users.id"), index=True)
    registered_at: Mapped[datetime] = _now()
    last_seen_at: Mapped[datetime] = _now()
    onboarded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    bot_started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    bot_blocked: Mapped[bool] = mapped_column(Boolean, default=False)
    is_blocked: Mapped[bool] = mapped_column(Boolean, default=False)
    block_reason: Mapped[str | None] = mapped_column(Text)
    is_suspicious: Mapped[bool] = mapped_column(Boolean, default=False)
    balance_available: Mapped[int] = mapped_column(BigInteger, default=0)
    balance_pending: Mapped[int] = mapped_column(BigInteger, default=0)
    balance_withdrawing: Mapped[int] = mapped_column(BigInteger, default=0)

    __table_args__ = (
        CheckConstraint("balance_pending >= 0", name="ck_users_pending_nonneg"),
        CheckConstraint("balance_withdrawing >= 0", name="ck_users_withdrawing_nonneg"),
        CheckConstraint("referrer_id IS NULL OR referrer_id <> id", name="ck_users_no_self_referral"),
    )


class FlyerTask(Base):
    __tablename__ = "flyer_tasks"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    user_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.id"), index=True)
    signature: Mapped[str] = mapped_column(String(512), unique=True)
    flyer_type: Mapped[str] = mapped_column(String(64))
    task_type: Mapped[str] = mapped_column(String(16))
    title: Mapped[str] = mapped_column(Text, default="")
    links: Mapped[list] = mapped_column(JSONB, default=list)
    photo: Mapped[str | None] = mapped_column(Text)
    resource_id: Mapped[int | None] = mapped_column(BigInteger)
    flyer_price_kopecks: Mapped[int] = mapped_column(BigInteger, default=0)
    flyer_status: Mapped[str | None] = mapped_column(String(32))
    status: Mapped[str] = mapped_column(String(16), default="new")
    is_offered: Mapped[bool] = mapped_column(Boolean, default=True)
    first_seen_at: Mapped[datetime] = _now()
    last_seen_at: Mapped[datetime] = _now()
    last_check_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    checks_count: Mapped[int] = mapped_column(Integer, default=0)


class TaskCheck(Base):
    __tablename__ = "task_checks"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    task_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("flyer_tasks.id"), index=True)
    user_id: Mapped[int] = mapped_column(BigInteger, index=True)
    source: Mapped[str] = mapped_column(String(16))
    flyer_status: Mapped[str | None] = mapped_column(String(32))
    error: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = _now()


class FlyerError(Base):
    __tablename__ = "flyer_errors"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    method: Mapped[str] = mapped_column(String(64))
    user_id: Mapped[int | None] = mapped_column(BigInteger)
    error: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = _now()


class Completion(Base):
    __tablename__ = "completions"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    task_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("flyer_tasks.id"), unique=True)
    user_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.id"), index=True)
    signature: Mapped[str] = mapped_column(String(512), unique=True)
    task_type: Mapped[str] = mapped_column(String(16))
    title: Mapped[str] = mapped_column(Text, default="")
    reward_milli: Mapped[int] = mapped_column(BigInteger)
    income_kopecks: Mapped[int] = mapped_column(BigInteger, default=0)
    flyer_price_kopecks: Mapped[int] = mapped_column(BigInteger, default=0)
    status: Mapped[str] = mapped_column(String(24), index=True)
    flyer_status: Mapped[str | None] = mapped_column(String(32))
    completed_at: Mapped[datetime] = _now()
    hold_until: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    paid_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    confirmed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    next_check_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), index=True)
    check_attempts: Mapped[int] = mapped_column(Integer, default=0)
    note: Mapped[str | None] = mapped_column(Text)
    resolved_by: Mapped[int | None] = mapped_column(BigInteger)


class Case(Base):
    __tablename__ = "cases"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    user_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.id"), index=True)
    source: Mapped[str] = mapped_column(String(16))
    label: Mapped[str] = mapped_column(Text, default="")
    completion_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("completions.id"), unique=True)
    referral_key: Mapped[str | None] = mapped_column(String(128), unique=True)
    amount_milli: Mapped[int] = mapped_column(BigInteger)
    state: Mapped[str] = mapped_column(String(16), default="ready")
    operation_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    created_at: Mapped[datetime] = _now()
    opened_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Operation(Base):
    __tablename__ = "operations"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.id"))
    kind: Mapped[str] = mapped_column(String(24))
    amount_milli: Mapped[int] = mapped_column(BigInteger)
    status: Mapped[str] = mapped_column(String(16))
    reason: Mapped[str] = mapped_column(Text, default="")
    idempotency_key: Mapped[str] = mapped_column(String(200), unique=True)
    case_id: Mapped[int | None] = mapped_column(BigInteger)
    completion_id: Mapped[int | None] = mapped_column(BigInteger, index=True)
    boost_id: Mapped[int | None] = mapped_column(BigInteger)
    withdrawal_id: Mapped[int | None] = mapped_column(BigInteger)
    admin_id: Mapped[int | None] = mapped_column(BigInteger)
    created_at: Mapped[datetime] = _now()
    updated_at: Mapped[datetime] = _now()

    __table_args__ = (Index("ix_operations_user_created", "user_id", "created_at"),)


class Boost(Base):
    __tablename__ = "boosts"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    user_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.id"), index=True)
    task_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("flyer_tasks.id"), unique=True)
    signature: Mapped[str] = mapped_column(String(512), unique=True)
    channel: Mapped[str] = mapped_column(Text, default="")
    link: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(16), default="active", index=True)
    assigned_at: Mapped[datetime] = _now()
    last_check_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    next_check_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), index=True)
    periods_paid: Mapped[int] = mapped_column(Integer, default=0)
    rewarded_milli: Mapped[int] = mapped_column(BigInteger, default=0)
    income_kopecks: Mapped[int] = mapped_column(BigInteger, default=0)
    check_failures: Mapped[int] = mapped_column(Integer, default=0)
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    end_reason: Mapped[str | None] = mapped_column(Text)


class BoostPeriod(Base):
    __tablename__ = "boost_periods"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    boost_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("boosts.id"), index=True)
    period_index: Mapped[int] = mapped_column(Integer)
    flyer_status: Mapped[str | None] = mapped_column(String(32))
    reward_milli: Mapped[int] = mapped_column(BigInteger)
    income_kopecks: Mapped[int] = mapped_column(BigInteger)
    operation_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    checked_at: Mapped[datetime] = _now()

    __table_args__ = (UniqueConstraint("boost_id", "period_index", name="uq_boost_period"),)


class ReferralReward(Base):
    __tablename__ = "referral_rewards"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    inviter_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.id"), index=True)
    invitee_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.id"))
    group_index: Mapped[int] = mapped_column(Integer)
    case_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("cases.id"))
    created_at: Mapped[datetime] = _now()

    __table_args__ = (UniqueConstraint("invitee_id", "group_index", name="uq_referral_group"),)


class Withdrawal(Base):
    __tablename__ = "withdrawals"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    user_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.id"), index=True)
    amount_milli: Mapped[int] = mapped_column(BigInteger)
    stars: Mapped[int] = mapped_column(Integer)
    method: Mapped[str] = mapped_column(String(32), default="telegram_gift")
    gift_id: Mapped[str | None] = mapped_column(String(128))
    status: Mapped[str] = mapped_column(String(16), index=True)
    idempotency_key: Mapped[str] = mapped_column(String(200), unique=True)
    operation_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    comment: Mapped[str | None] = mapped_column(Text)
    error: Mapped[str | None] = mapped_column(Text)
    admin_id: Mapped[int | None] = mapped_column(BigInteger)
    created_at: Mapped[datetime] = _now()
    updated_at: Mapped[datetime] = _now()
    processed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Notification(Base):
    __tablename__ = "notifications"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    user_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.id"), index=True)
    kind: Mapped[str] = mapped_column(String(32))
    dedup_key: Mapped[str] = mapped_column(String(200), unique=True)
    title: Mapped[str] = mapped_column(Text)
    text: Mapped[str] = mapped_column(Text)
    buttons: Mapped[list] = mapped_column(JSONB, default=list)
    status: Mapped[str] = mapped_column(String(16), default="queued", index=True)
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    next_attempt_at: Mapped[datetime] = _now()
    last_error: Mapped[str | None] = mapped_column(Text)
    telegram_message_id: Mapped[int | None] = mapped_column(BigInteger)
    created_at: Mapped[datetime] = _now()
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Broadcast(Base):
    __tablename__ = "broadcasts"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    admin_id: Mapped[int] = mapped_column(BigInteger)
    text: Mapped[str] = mapped_column(Text, default="")
    image_path: Mapped[str | None] = mapped_column(Text)
    buttons: Mapped[list] = mapped_column(JSONB, default=list)
    audience: Mapped[str | None] = mapped_column(String(16))
    status: Mapped[str] = mapped_column(String(16), default="draft", index=True)
    cursor_user_id: Mapped[int] = mapped_column(BigInteger, default=0)
    total: Mapped[int] = mapped_column(Integer, default=0)
    sent: Mapped[int] = mapped_column(Integer, default=0)
    failed: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = _now()
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Setting(Base):
    __tablename__ = "settings"

    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    value: Mapped[str] = mapped_column(Text)
    updated_at: Mapped[datetime] = _now()
    updated_by: Mapped[int | None] = mapped_column(BigInteger)


class AuditLog(Base):
    __tablename__ = "audit_log"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    admin_id: Mapped[int] = mapped_column(BigInteger, index=True)
    action: Mapped[str] = mapped_column(String(64))
    target: Mapped[str] = mapped_column(Text, default="")
    details: Mapped[dict] = mapped_column(JSONB, default=dict)
    created_at: Mapped[datetime] = _now()


class StarTopup(Base):
    __tablename__ = "star_topups"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    admin_id: Mapped[int] = mapped_column(BigInteger, index=True)
    amount: Mapped[int] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(String(16), default="created")
    payer_id: Mapped[int | None] = mapped_column(BigInteger)
    telegram_payment_charge_id: Mapped[str | None] = mapped_column(String(256), unique=True)
    created_at: Mapped[datetime] = _now()
    paid_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class DailySpin(Base):
    __tablename__ = "daily_spins"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    user_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.id"), index=True)
    day: Mapped[date] = mapped_column(Date)
    amount_milli: Mapped[int] = mapped_column(BigInteger)
    operation_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    created_at: Mapped[datetime] = _now()

    __table_args__ = (UniqueConstraint("user_id", "day", name="uq_daily_spin_user_day"),)


class Deposit(Base):
    __tablename__ = "deposits"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.id"), index=True)
    stars: Mapped[int] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(String(16), default="created")
    telegram_payment_charge_id: Mapped[str | None] = mapped_column(String(256), unique=True)
    operation_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    created_at: Mapped[datetime] = _now()
    paid_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class PaidCaseOpen(Base):
    __tablename__ = "paid_case_opens"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    user_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.id"), index=True)
    price: Mapped[int] = mapped_column(Integer)
    prize_milli: Mapped[int] = mapped_column(BigInteger)
    fund_before_milli: Mapped[int] = mapped_column(BigInteger)
    idempotency_key: Mapped[str] = mapped_column(String(200), unique=True)
    created_at: Mapped[datetime] = _now()


class PrizeFund(Base):
    __tablename__ = "prize_fund"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=False)
    fund_milli: Mapped[int] = mapped_column(BigInteger, default=0)
    paid_in_milli: Mapped[int] = mapped_column(BigInteger, default=0)
    paid_out_milli: Mapped[int] = mapped_column(BigInteger, default=0)
    updated_at: Mapped[datetime] = _now()

    __table_args__ = (CheckConstraint("fund_milli >= 0", name="ck_prize_fund_nonneg"),)
