"""normalized weekly course schedules

Adds `course_schedules` (one row per weekly time slot) so a course can meet
multiple times per week, and links each session to its slot via
sessions.schedule_id (nullable, ON DELETE SET NULL). Mirrors
migrations/0004_course_schedules.sql and the CourseSchedule/Session ORM models.

Revision ID: c4d8f3e2b015
Revises: b3c7e2f1a904
Create Date: 2026-09-30 11:40:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "c4d8f3e2b015"
down_revision: Union[str, None] = "b3c7e2f1a904"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "course_schedules",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column(
            "course_id",
            sa.String(length=36),
            sa.ForeignKey("courses.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("day_of_week", sa.Integer(), nullable=False),
        sa.Column("start_period", sa.Integer(), nullable=False),
        sa.Column("end_period", sa.Integer(), nullable=False),
        sa.CheckConstraint(
            "day_of_week >= 0 AND day_of_week <= 6",
            name="ck_course_schedules_day_of_week",
        ),
        sa.CheckConstraint(
            "start_period >= 1 AND end_period >= start_period",
            name="ck_course_schedules_period_range",
        ),
        sa.UniqueConstraint(
            "course_id", "day_of_week", "start_period",
            name="uq_course_schedules_slot",
        ),
    )
    op.create_index(
        "idx_course_schedules_course", "course_schedules", ["course_id"]
    )
    op.add_column(
        "sessions", sa.Column("schedule_id", sa.String(length=36), nullable=True)
    )
    op.create_foreign_key(
        "fk_sessions_schedule",
        "sessions",
        "course_schedules",
        ["schedule_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint("fk_sessions_schedule", "sessions", type_="foreignkey")
    op.drop_column("sessions", "schedule_id")
    op.drop_index("idx_course_schedules_course", table_name="course_schedules")
    op.drop_table("course_schedules")
