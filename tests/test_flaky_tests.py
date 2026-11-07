"""scripts/flaky_tests.py: what it prints in a public issue is made safe."""
import importlib.util
from pathlib import Path

_SPEC = importlib.util.spec_from_file_location("flaky_tests", Path(__file__).resolve().parent.parent / "scripts" / "flaky_tests.py")
flaky_tests = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(flaky_tests)


def test_a_name_cannot_end_its_code_span_or_the_hidden_comment():
    name = flaky_tests.clean("x` @org/team [a](http://evil) ![i](u) --> <b>\nnext")
    assert not any(c in name for c in "`<>\n")


def test_a_long_name_is_cut():
    assert len(flaky_tests.clean("a" * 1000)) == 300


def test_the_browser_lists_of_other_runs_are_cleaned(tmp_path, monkeypatch):
    (tmp_path / "e2e").mkdir()
    (tmp_path / "e2e" / "run.txt").write_text("[chromium] a.spec.ts:1 › evil` --> @org/team\n")
    monkeypatch.setattr(flaky_tests, "find_issue", lambda: None)
    printed = []
    monkeypatch.setattr(flaky_tests, "render", lambda entries, today: printed.append(entries) or "")
    monkeypatch.setattr(flaky_tests.subprocess, "run", lambda *a, **k: None)
    flaky_tests.report(tmp_path, dry_run=False)
    (entries,) = printed
    assert entries and not any(c in key for key in entries for c in "`<>")
