"""course schedule/catalog fields

Adds optional timetable/catalog metadata to courses (code, department,
professor_name, day_of_week, start_period, end_period, location, credits).
All nullable for backward compatibility. Mirrors migrations/0002_course_schedule.sql
and the Course ORM model.

Revision ID: 8f2a1c9b4d10
Revises: 571dbd4d74af
Create Date: 2026-09-25 04:55:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "8f2a1c9b4d10"
down_revision: Union[str, None] = "571dbd4d74af"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("courses", sa.Column("code", sa.String(length=32), nullable=True))
    op.add_column("courses", sa.Column("department", sa.String(length=255), nullable=True))
    op.add_column("courses", sa.Column("professor_name", sa.String(length=255), nullable=True))
    op.add_column("courses", sa.Column("day_of_week", sa.Integer(), nullable=True))
    op.add_column("courses", sa.Column("start_period", sa.Integer(), nullable=True))
    op.add_column("courses", sa.Column("end_period", sa.Integer(), nullable=True))
    op.add_column("courses", sa.Column("location", sa.String(length=255), nullable=True))
    op.add_column("courses", sa.Column("credits", sa.Numeric(precision=3, scale=1), nullable=True))
    op.create_check_constraint(
        "ck_courses_day_of_week",
        "courses",
        "day_of_week IS NULL OR (day_of_week >= 0 AND day_of_week <= 6)",
    )


def downgrade() -> None:
    op.drop_constraint("ck_courses_day_of_week", "courses", type_="check")
    op.drop_column("courses", "credits")
    op.drop_column("courses", "location")
    op.drop_column("courses", "end_period")
    op.drop_column("courses", "start_period")
    op.drop_column("courses", "day_of_week")
    op.drop_column("courses", "professor_name")
    op.drop_column("courses", "department")
    op.drop_column("courses", "code")
    # ### end Alembic commands ###
