"""star top-ups and broadcast audience

Revision ID: 0002
Revises: 0001
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "star_topups",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("admin_id", sa.BigInteger(), nullable=False),
        sa.Column("amount", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("payer_id", sa.BigInteger(), nullable=True),
        sa.Column("telegram_payment_charge_id", sa.String(length=256), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("paid_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("telegram_payment_charge_id"),
    )
    op.create_index(op.f("ix_star_topups_admin_id"), "star_topups", ["admin_id"], unique=False)
    op.add_column("broadcasts", sa.Column("audience", sa.String(length=16), nullable=True))


def downgrade() -> None:
    op.drop_column("broadcasts", "audience")
    op.drop_index(op.f("ix_star_topups_admin_id"), table_name="star_topups")
    op.drop_table("star_topups")
