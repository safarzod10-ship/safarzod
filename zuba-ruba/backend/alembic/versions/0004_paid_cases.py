"""paid cases

Revision ID: 0004
Revises: 0003
Create Date: 2026-11-10 10:39:15.946437
"""
from alembic import op
import sqlalchemy as sa


revision = '0004'
down_revision = '0003'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table('prize_fund',
    sa.Column('id', sa.Integer(), autoincrement=False, nullable=False),
    sa.Column('fund_milli', sa.BigInteger(), nullable=False),
    sa.Column('paid_in_milli', sa.BigInteger(), nullable=False),
    sa.Column('paid_out_milli', sa.BigInteger(), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.CheckConstraint('fund_milli >= 0', name='ck_prize_fund_nonneg'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_table('deposits',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('user_id', sa.BigInteger(), nullable=False),
    sa.Column('stars', sa.Integer(), nullable=False),
    sa.Column('status', sa.String(length=16), nullable=False),
    sa.Column('telegram_payment_charge_id', sa.String(length=256), nullable=True),
    sa.Column('operation_id', sa.UUID(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('paid_at', sa.DateTime(timezone=True), nullable=True),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('telegram_payment_charge_id')
    )
    op.create_index(op.f('ix_deposits_user_id'), 'deposits', ['user_id'], unique=False)
    op.create_table('paid_case_opens',
    sa.Column('id', sa.BigInteger(), nullable=False),
    sa.Column('user_id', sa.BigInteger(), nullable=False),
    sa.Column('price', sa.Integer(), nullable=False),
    sa.Column('prize_milli', sa.BigInteger(), nullable=False),
    sa.Column('fund_before_milli', sa.BigInteger(), nullable=False),
    sa.Column('idempotency_key', sa.String(length=200), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('idempotency_key')
    )
    op.create_index(op.f('ix_paid_case_opens_user_id'), 'paid_case_opens', ['user_id'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_paid_case_opens_user_id'), table_name='paid_case_opens')
    op.drop_table('paid_case_opens')
    op.drop_index(op.f('ix_deposits_user_id'), table_name='deposits')
    op.drop_table('deposits')
    op.drop_table('prize_fund')
