"""
Tests: risk-warning thresholds are externalized to config and applied at the
exact boundaries.

Default config: risk_warning_threshold=2, risk_absence_threshold=3
  absences 0,1        -> None
  absences 2          -> warning
  absences 3+         -> danger

Also verifies that overriding the config thresholds changes the boundaries,
proving the values are genuinely externalized (not hard-coded).
"""
import pytest

from app.config import Settings, get_settings
from app.schemas import RiskLevel
from app.services import aggregate


@pytest.fixture
def override_thresholds(monkeypatch):
    """Return a helper that installs a Settings with custom thresholds."""

    def _apply(warning_at: int, danger_at: int):
        s = Settings(
            risk_warning_threshold=warning_at, risk_absence_threshold=danger_at
        )
        monkeypatch.setattr(aggregate, "get_settings", lambda: s)

    return _apply


def test_default_boundaries():
    # Uses real config defaults (2 / 3).
    get_settings.cache_clear()
    assert aggregate.risk_warning_for(0) is None
    assert aggregate.risk_warning_for(1) is None

    w2 = aggregate.risk_warning_for(2)
    assert w2 is not None and w2.level == RiskLevel.warning and w2.absences == 2

    d3 = aggregate.risk_warning_for(3)
    assert d3 is not None and d3.level == RiskLevel.danger

    d5 = aggregate.risk_warning_for(5)
    assert d5 is not None and d5.level == RiskLevel.danger


def test_custom_boundaries_are_externalized(override_thresholds):
    # warning at 4, danger at 6
    override_thresholds(warning_at=4, danger_at=6)
    assert aggregate.risk_warning_for(3) is None
    assert aggregate.risk_warning_for(4).level == RiskLevel.warning
    assert aggregate.risk_warning_for(5).level == RiskLevel.warning
    assert aggregate.risk_warning_for(6).level == RiskLevel.danger


def test_warning_equals_danger_threshold(override_thresholds):
    # When warning == danger, the danger branch wins at the boundary.
    override_thresholds(warning_at=3, danger_at=3)
    assert aggregate.risk_warning_for(2) is None
    assert aggregate.risk_warning_for(3).level == RiskLevel.danger
