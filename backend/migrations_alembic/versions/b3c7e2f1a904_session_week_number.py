"""session week number (1..15주차)

Adds an optional academic week number to sessions so attendance can be reported
per week. Nullable for backward compatibility. Mirrors
migrations/0003_session_week_number.sql and the Session ORM model.

Revision ID: b3c7e2f1a904
Revises: 8f2a1c9b4d10
Create Date: 2026-09-28 13:16:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "b3c7e2f1a904"
down_revision: Union[str, None] = "8f2a1c9b4d10"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("sessions", sa.Column("week_number", sa.Integer(), nullable=True))
    op.create_check_constraint(
        "ck_sessions_week_number",
        "sessions",
        "week_number IS NULL OR (week_number >= 1 AND week_number <= 15)",
    )


def downgrade() -> None:
    op.drop_constraint("ck_sessions_week_number", "sessions", type_="check")
    op.drop_column("sessions", "week_number")
