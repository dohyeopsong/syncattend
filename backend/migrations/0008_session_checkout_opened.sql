-- Syncattend (SDAS) — track whether the 2차 (check_out) window was ever opened.
--
-- The phase column alone cannot distinguish "closed after 1차 only" from
-- "closed after 2차" — both read 'closed'. This boolean records that the
-- professor opened the check_out window at least once, so the UI can show the
-- "2차 인증 열기" button only when the 2차 phase has NOT yet happened.
--
-- Allows the intended flow: 1차 인증 → 닫기 → 결석자 검토 → (re-open) 2차 인증
-- → 닫기 → 최종 마감. openCheckout now accepts a closed session for the same
-- reason (re-opening the SAME session keeps attendance aggregation intact).
--
-- Aligns with app/models.py and contracts/openapi.yaml (owner A keeps in sync).

ALTER TABLE sessions ADD COLUMN checkout_opened BOOLEAN NOT NULL DEFAULT FALSE;
