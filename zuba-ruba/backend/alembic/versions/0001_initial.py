"""initial schema

Revision ID: 0001
Revises: 
Create Date: 2026-11-09 17:54:26.765090
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = '0001'
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table('audit_log',
    sa.Column('id', sa.BigInteger(), nullable=False),
    sa.Column('admin_id', sa.BigInteger(), nullable=False),
    sa.Column('action', sa.String(length=64), nullable=False),
    sa.Column('target', sa.Text(), nullable=False),
    sa.Column('details', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_audit_log_admin_id'), 'audit_log', ['admin_id'], unique=False)
    op.create_table('broadcasts',
    sa.Column('id', sa.BigInteger(), nullable=False),
    sa.Column('admin_id', sa.BigInteger(), nullable=False),
    sa.Column('text', sa.Text(), nullable=False),
    sa.Column('image_path', sa.Text(), nullable=True),
    sa.Column('buttons', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
    sa.Column('status', sa.String(length=16), nullable=False),
    sa.Column('cursor_user_id', sa.BigInteger(), nullable=False),
    sa.Column('total', sa.Integer(), nullable=False),
    sa.Column('sent', sa.Integer(), nullable=False),
    sa.Column('failed', sa.Integer(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('started_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('finished_at', sa.DateTime(timezone=True), nullable=True),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_broadcasts_status'), 'broadcasts', ['status'], unique=False)
    op.create_table('flyer_errors',
    sa.Column('id', sa.BigInteger(), nullable=False),
    sa.Column('method', sa.String(length=64), nullable=False),
    sa.Column('user_id', sa.BigInteger(), nullable=True),
    sa.Column('error', sa.Text(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_table('settings',
    sa.Column('key', sa.String(length=64), nullable=False),
    sa.Column('value', sa.Text(), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_by', sa.BigInteger(), nullable=True),
    sa.PrimaryKeyConstraint('key')
    )
    op.create_table('users',
    sa.Column('id', sa.BigInteger(), autoincrement=False, nullable=False),
    sa.Column('first_name', sa.String(length=256), nullable=False),
    sa.Column('last_name', sa.String(length=256), nullable=True),
    sa.Column('username', sa.String(length=64), nullable=True),
    sa.Column('language_code', sa.String(length=16), nullable=True),
    sa.Column('photo_url', sa.Text(), nullable=True),
    sa.Column('is_premium', sa.Boolean(), nullable=False),
    sa.Column('ref_code', sa.String(length=16), nullable=False),
    sa.Column('referrer_id', sa.BigInteger(), nullable=True),
    sa.Column('registered_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('last_seen_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('onboarded_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('bot_started_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('bot_blocked', sa.Boolean(), nullable=False),
    sa.Column('is_blocked', sa.Boolean(), nullable=False),
    sa.Column('block_reason', sa.Text(), nullable=True),
    sa.Column('is_suspicious', sa.Boolean(), nullable=False),
    sa.Column('balance_available', sa.BigInteger(), nullable=False),
    sa.Column('balance_pending', sa.BigInteger(), nullable=False),
    sa.Column('balance_withdrawing', sa.BigInteger(), nullable=False),
    sa.CheckConstraint('balance_pending >= 0', name='ck_users_pending_nonneg'),
    sa.CheckConstraint('balance_withdrawing >= 0', name='ck_users_withdrawing_nonneg'),
    sa.CheckConstraint('referrer_id IS NULL OR referrer_id <> id', name='ck_users_no_self_referral'),
    sa.ForeignKeyConstraint(['referrer_id'], ['users.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('ref_code')
    )
    op.create_index(op.f('ix_users_referrer_id'), 'users', ['referrer_id'], unique=False)
    op.create_index(op.f('ix_users_username'), 'users', ['username'], unique=False)
    op.create_table('flyer_tasks',
    sa.Column('id', sa.BigInteger(), nullable=False),
    sa.Column('user_id', sa.BigInteger(), nullable=False),
    sa.Column('signature', sa.String(length=512), nullable=False),
    sa.Column('flyer_type', sa.String(length=64), nullable=False),
    sa.Column('task_type', sa.String(length=16), nullable=False),
    sa.Column('title', sa.Text(), nullable=False),
    sa.Column('links', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
    sa.Column('photo', sa.Text(), nullable=True),
    sa.Column('resource_id', sa.BigInteger(), nullable=True),
    sa.Column('flyer_price_kopecks', sa.BigInteger(), nullable=False),
    sa.Column('flyer_status', sa.String(length=32), nullable=True),
    sa.Column('status', sa.String(length=16), nullable=False),
    sa.Column('is_offered', sa.Boolean(), nullable=False),
    sa.Column('first_seen_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('last_seen_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('last_check_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('checks_count', sa.Integer(), nullable=False),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('signature')
    )
    op.create_index(op.f('ix_flyer_tasks_user_id'), 'flyer_tasks', ['user_id'], unique=False)
    op.create_table('notifications',
    sa.Column('id', sa.BigInteger(), nullable=False),
    sa.Column('user_id', sa.BigInteger(), nullable=False),
    sa.Column('kind', sa.String(length=32), nullable=False),
    sa.Column('dedup_key', sa.String(length=200), nullable=False),
    sa.Column('title', sa.Text(), nullable=False),
    sa.Column('text', sa.Text(), nullable=False),
    sa.Column('buttons', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
    sa.Column('status', sa.String(length=16), nullable=False),
    sa.Column('attempts', sa.Integer(), nullable=False),
    sa.Column('next_attempt_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('last_error', sa.Text(), nullable=True),
    sa.Column('telegram_message_id', sa.BigInteger(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('sent_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('read_at', sa.DateTime(timezone=True), nullable=True),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('dedup_key')
    )
    op.create_index(op.f('ix_notifications_status'), 'notifications', ['status'], unique=False)
    op.create_index(op.f('ix_notifications_user_id'), 'notifications', ['user_id'], unique=False)
    op.create_table('operations',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('user_id', sa.BigInteger(), nullable=False),
    sa.Column('kind', sa.String(length=24), nullable=False),
    sa.Column('amount_milli', sa.BigInteger(), nullable=False),
    sa.Column('status', sa.String(length=16), nullable=False),
    sa.Column('reason', sa.Text(), nullable=False),
    sa.Column('idempotency_key', sa.String(length=200), nullable=False),
    sa.Column('case_id', sa.BigInteger(), nullable=True),
    sa.Column('completion_id', sa.BigInteger(), nullable=True),
    sa.Column('boost_id', sa.BigInteger(), nullable=True),
    sa.Column('withdrawal_id', sa.BigInteger(), nullable=True),
    sa.Column('admin_id', sa.BigInteger(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('idempotency_key')
    )
    op.create_index(op.f('ix_operations_completion_id'), 'operations', ['completion_id'], unique=False)
    op.create_index('ix_operations_user_created', 'operations', ['user_id', 'created_at'], unique=False)
    op.create_table('withdrawals',
    sa.Column('id', sa.BigInteger(), nullable=False),
    sa.Column('user_id', sa.BigInteger(), nullable=False),
    sa.Column('amount_milli', sa.BigInteger(), nullable=False),
    sa.Column('stars', sa.Integer(), nullable=False),
    sa.Column('method', sa.String(length=32), nullable=False),
    sa.Column('gift_id', sa.String(length=128), nullable=True),
    sa.Column('status', sa.String(length=16), nullable=False),
    sa.Column('idempotency_key', sa.String(length=200), nullable=False),
    sa.Column('operation_id', sa.UUID(), nullable=True),
    sa.Column('comment', sa.Text(), nullable=True),
    sa.Column('error', sa.Text(), nullable=True),
    sa.Column('admin_id', sa.BigInteger(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('processed_at', sa.DateTime(timezone=True), nullable=True),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('idempotency_key')
    )
    op.create_index(op.f('ix_withdrawals_status'), 'withdrawals', ['status'], unique=False)
    op.create_index(op.f('ix_withdrawals_user_id'), 'withdrawals', ['user_id'], unique=False)
    op.create_table('boosts',
    sa.Column('id', sa.BigInteger(), nullable=False),
    sa.Column('user_id', sa.BigInteger(), nullable=False),
    sa.Column('task_id', sa.BigInteger(), nullable=False),
    sa.Column('signature', sa.String(length=512), nullable=False),
    sa.Column('channel', sa.Text(), nullable=False),
    sa.Column('link', sa.Text(), nullable=True),
    sa.Column('status', sa.String(length=16), nullable=False),
    sa.Column('assigned_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('last_check_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('next_check_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('periods_paid', sa.Integer(), nullable=False),
    sa.Column('rewarded_milli', sa.BigInteger(), nullable=False),
    sa.Column('income_kopecks', sa.BigInteger(), nullable=False),
    sa.Column('check_failures', sa.Integer(), nullable=False),
    sa.Column('ended_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('end_reason', sa.Text(), nullable=True),
    sa.ForeignKeyConstraint(['task_id'], ['flyer_tasks.id'], ),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('signature'),
    sa.UniqueConstraint('task_id')
    )
    op.create_index(op.f('ix_boosts_next_check_at'), 'boosts', ['next_check_at'], unique=False)
    op.create_index(op.f('ix_boosts_status'), 'boosts', ['status'], unique=False)
    op.create_index(op.f('ix_boosts_user_id'), 'boosts', ['user_id'], unique=False)
    op.create_table('completions',
    sa.Column('id', sa.BigInteger(), nullable=False),
    sa.Column('task_id', sa.BigInteger(), nullable=False),
    sa.Column('user_id', sa.BigInteger(), nullable=False),
    sa.Column('signature', sa.String(length=512), nullable=False),
    sa.Column('task_type', sa.String(length=16), nullable=False),
    sa.Column('title', sa.Text(), nullable=False),
    sa.Column('reward_milli', sa.BigInteger(), nullable=False),
    sa.Column('income_kopecks', sa.BigInteger(), nullable=False),
    sa.Column('flyer_price_kopecks', sa.BigInteger(), nullable=False),
    sa.Column('status', sa.String(length=24), nullable=False),
    sa.Column('flyer_status', sa.String(length=32), nullable=True),
    sa.Column('completed_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('hold_until', sa.DateTime(timezone=True), nullable=False),
    sa.Column('paid_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('confirmed_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('cancelled_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('next_check_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('check_attempts', sa.Integer(), nullable=False),
    sa.Column('note', sa.Text(), nullable=True),
    sa.Column('resolved_by', sa.BigInteger(), nullable=True),
    sa.ForeignKeyConstraint(['task_id'], ['flyer_tasks.id'], ),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('signature'),
    sa.UniqueConstraint('task_id')
    )
    op.create_index(op.f('ix_completions_next_check_at'), 'completions', ['next_check_at'], unique=False)
    op.create_index(op.f('ix_completions_status'), 'completions', ['status'], unique=False)
    op.create_index(op.f('ix_completions_user_id'), 'completions', ['user_id'], unique=False)
    op.create_table('task_checks',
    sa.Column('id', sa.BigInteger(), nullable=False),
    sa.Column('task_id', sa.BigInteger(), nullable=False),
    sa.Column('user_id', sa.BigInteger(), nullable=False),
    sa.Column('source', sa.String(length=16), nullable=False),
    sa.Column('flyer_status', sa.String(length=32), nullable=True),
    sa.Column('error', sa.Text(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['task_id'], ['flyer_tasks.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_task_checks_task_id'), 'task_checks', ['task_id'], unique=False)
    op.create_index(op.f('ix_task_checks_user_id'), 'task_checks', ['user_id'], unique=False)
    op.create_table('boost_periods',
    sa.Column('id', sa.BigInteger(), nullable=False),
    sa.Column('boost_id', sa.BigInteger(), nullable=False),
    sa.Column('period_index', sa.Integer(), nullable=False),
    sa.Column('flyer_status', sa.String(length=32), nullable=True),
    sa.Column('reward_milli', sa.BigInteger(), nullable=False),
    sa.Column('income_kopecks', sa.BigInteger(), nullable=False),
    sa.Column('operation_id', sa.UUID(), nullable=True),
    sa.Column('checked_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['boost_id'], ['boosts.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('boost_id', 'period_index', name='uq_boost_period')
    )
    op.create_index(op.f('ix_boost_periods_boost_id'), 'boost_periods', ['boost_id'], unique=False)
    op.create_table('cases',
    sa.Column('id', sa.BigInteger(), nullable=False),
    sa.Column('user_id', sa.BigInteger(), nullable=False),
    sa.Column('source', sa.String(length=16), nullable=False),
    sa.Column('label', sa.Text(), nullable=False),
    sa.Column('completion_id', sa.BigInteger(), nullable=True),
    sa.Column('referral_key', sa.String(length=128), nullable=True),
    sa.Column('amount_milli', sa.BigInteger(), nullable=False),
    sa.Column('state', sa.String(length=16), nullable=False),
    sa.Column('operation_id', sa.UUID(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('opened_at', sa.DateTime(timezone=True), nullable=True),
    sa.ForeignKeyConstraint(['completion_id'], ['completions.id'], ),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('completion_id'),
    sa.UniqueConstraint('referral_key')
    )
    op.create_index(op.f('ix_cases_user_id'), 'cases', ['user_id'], unique=False)
    op.create_table('referral_rewards',
    sa.Column('id', sa.BigInteger(), nullable=False),
    sa.Column('inviter_id', sa.BigInteger(), nullable=False),
    sa.Column('invitee_id', sa.BigInteger(), nullable=False),
    sa.Column('group_index', sa.Integer(), nullable=False),
    sa.Column('case_id', sa.BigInteger(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['case_id'], ['cases.id'], ),
    sa.ForeignKeyConstraint(['invitee_id'], ['users.id'], ),
    sa.ForeignKeyConstraint(['inviter_id'], ['users.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('invitee_id', 'group_index', name='uq_referral_group')
    )
    op.create_index(op.f('ix_referral_rewards_inviter_id'), 'referral_rewards', ['inviter_id'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_referral_rewards_inviter_id'), table_name='referral_rewards')
    op.drop_table('referral_rewards')
    op.drop_index(op.f('ix_cases_user_id'), table_name='cases')
    op.drop_table('cases')
    op.drop_index(op.f('ix_boost_periods_boost_id'), table_name='boost_periods')
    op.drop_table('boost_periods')
    op.drop_index(op.f('ix_task_checks_user_id'), table_name='task_checks')
    op.drop_index(op.f('ix_task_checks_task_id'), table_name='task_checks')
    op.drop_table('task_checks')
    op.drop_index(op.f('ix_completions_user_id'), table_name='completions')
    op.drop_index(op.f('ix_completions_status'), table_name='completions')
    op.drop_index(op.f('ix_completions_next_check_at'), table_name='completions')
    op.drop_table('completions')
    op.drop_index(op.f('ix_boosts_user_id'), table_name='boosts')
    op.drop_index(op.f('ix_boosts_status'), table_name='boosts')
    op.drop_index(op.f('ix_boosts_next_check_at'), table_name='boosts')
    op.drop_table('boosts')
    op.drop_index(op.f('ix_withdrawals_user_id'), table_name='withdrawals')
    op.drop_index(op.f('ix_withdrawals_status'), table_name='withdrawals')
    op.drop_table('withdrawals')
    op.drop_index('ix_operations_user_created', table_name='operations')
    op.drop_index(op.f('ix_operations_completion_id'), table_name='operations')
    op.drop_table('operations')
    op.drop_index(op.f('ix_notifications_user_id'), table_name='notifications')
    op.drop_index(op.f('ix_notifications_status'), table_name='notifications')
    op.drop_table('notifications')
    op.drop_index(op.f('ix_flyer_tasks_user_id'), table_name='flyer_tasks')
    op.drop_table('flyer_tasks')
    op.drop_index(op.f('ix_users_username'), table_name='users')
    op.drop_index(op.f('ix_users_referrer_id'), table_name='users')
    op.drop_table('users')
    op.drop_table('settings')
    op.drop_table('flyer_errors')
    op.drop_index(op.f('ix_broadcasts_status'), table_name='broadcasts')
    op.drop_table('broadcasts')
    op.drop_index(op.f('ix_audit_log_admin_id'), table_name='audit_log')
    op.drop_table('audit_log')
