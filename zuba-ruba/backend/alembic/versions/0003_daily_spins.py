"""daily spins

Revision ID: 0003
Revises: 0002
Create Date: 2026-11-10 07:25:34.572565
"""
from alembic import op
import sqlalchemy as sa


revision = '0003'
down_revision = '0002'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table('daily_spins',
    sa.Column('id', sa.BigInteger(), nullable=False),
    sa.Column('user_id', sa.BigInteger(), nullable=False),
    sa.Column('day', sa.Date(), nullable=False),
    sa.Column('amount_milli', sa.BigInteger(), nullable=False),
    sa.Column('operation_id', sa.UUID(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('user_id', 'day', name='uq_daily_spin_user_day')
    )
    op.create_index(op.f('ix_daily_spins_user_id'), 'daily_spins', ['user_id'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_daily_spins_user_id'), table_name='daily_spins')
    op.drop_table('daily_spins')
