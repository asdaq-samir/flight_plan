"""A corridor not yet read is read in a process of its own and loaded
from what it kept (app.chart_model), so the planner's other requests do
not wait on it."""
import threading
from concurrent.futures import Future
from concurrent.futures.process import BrokenProcessPool
from types import SimpleNamespace

import pytest
from app import chart_model, detection


class _Pool:
    def __init__(self):
        self.asked = []

    def submit(self, fn, *args):
        self.asked.append(args[0])
        future = Future()
        future.set_result(None)
        return future


def test_an_unread_corridor_is_read_in_the_pool_once_however_often_asked(monkeypatch, tmp_path):
    pool = _Pool()
    monkeypatch.setattr(chart_model, "READS_IN_PROCESS", True)
    monkeypatch.setattr(chart_model, "_PROCESSES", pool)
    monkeypatch.setattr(chart_model, "_READING", {})
    monkeypatch.setattr(detection, "_kept_path", lambda key: tmp_path / "not-kept.json")
    key = ("C81->KDLH", chart_model.TRAINING_HALF_WIDTH_NM)
    first = chart_model._reading(key, (42.3, -88.1), (46.8, -92.2))
    assert first is not None and pool.asked == [key]
    # Done, and kept now: nothing more to read.
    (tmp_path / "not-kept.json").write_text("[]")
    assert chart_model._reading(key, (42.3, -88.1), (46.8, -92.2)) is None
    assert pool.asked == [key]


def test_a_corridor_kept_or_being_read_here_is_not_read_again(monkeypatch, tmp_path):
    pool = _Pool()
    monkeypatch.setattr(chart_model, "READS_IN_PROCESS", True)
    monkeypatch.setattr(chart_model, "_PROCESSES", pool)
    kept = tmp_path / "kept.json"
    kept.write_text("[]")
    monkeypatch.setattr(detection, "_kept_path", lambda key: kept)
    assert chart_model._reading(("C81->KMSN", 4.0), (0, 0), (1, 1)) is None
    monkeypatch.setattr(detection, "_kept_path", lambda key: tmp_path / "none.json")
    monkeypatch.setitem(detection._DETECT_JOBS, ("C81->KRFD", 4.0), {"done": False})
    assert chart_model._reading(("C81->KRFD", 4.0), (0, 0), (1, 1)) is None
    assert pool.asked == []


class _BrokenPool:
    def __init__(self):
        self.shut = False

    def submit(self, fn, *args):
        raise BrokenProcessPool("a child process terminated abruptly")

    def shutdown(self, wait=True, cancel_futures=False):
        self.shut = True


def test_a_pool_that_lost_a_process_is_replaced_and_the_read_goes_to_the_new_one(monkeypatch, tmp_path):
    broken, fresh = _BrokenPool(), _Pool()
    monkeypatch.setattr(chart_model, "READS_IN_PROCESS", True)
    monkeypatch.setattr(chart_model, "_PROCESSES", broken)
    monkeypatch.setattr(chart_model, "_READING", {})
    monkeypatch.setattr(chart_model, "_pool", lambda: fresh)
    monkeypatch.setattr(detection, "_kept_path", lambda key: tmp_path / "not-kept.json")
    key = ("KORD->KNEW", chart_model.TRAINING_HALF_WIDTH_NM)
    assert chart_model._reading(key, (42.0, -87.9), (30.0, -90.0)) is not None
    assert broken.shut and fresh.asked == [key] and chart_model._PROCESSES is fresh


def _hop_stubs(monkeypatch, tmp_path, outcomes):
    """corridor() over a stubbed hop, its reads in the pool ending as
    `outcomes` say, one each: an exception raised, or the read's error."""
    hop = SimpleNamespace(start=(42.0, -87.9), end=(30.0, -90.0), dep_ident="KORD", dest_ident="KNEW")
    monkeypatch.setattr(chart_model, "load_hop", lambda dep, dest: hop)
    monkeypatch.setattr(chart_model, "READS_IN_PROCESS", True)
    monkeypatch.setattr(chart_model, "_READING", {})
    monkeypatch.setattr(detection, "_kept_path", lambda key: tmp_path / "not-kept.json")
    monkeypatch.setattr(chart_model, "detect_job", lambda *a: {"cond": threading.Condition(), "done": True, "error": None, "blocks": []})
    monkeypatch.setattr(chart_model, "faa_airports", lambda *a: [])
    ends = iter(outcomes)

    class Pool(_Pool):
        def submit(self, fn, *args):
            self.asked.append(args[0])
            future, end = Future(), next(ends)
            if isinstance(end, BaseException):
                future.set_exception(end)
            else:
                future.set_result(end)
            return future

    pool = Pool()
    monkeypatch.setattr(chart_model, "_PROCESSES", pool)
    return pool


def test_a_read_whose_process_died_is_read_once_more_in_a_process(monkeypatch, tmp_path):
    pool = _hop_stubs(monkeypatch, tmp_path, [BrokenProcessPool("terminated abruptly"), None])
    assert chart_model.corridor("KORD->KNEW", wait=True) == []
    assert len(pool.asked) == 2


def test_a_read_whose_process_died_twice_says_so_in_words(monkeypatch, tmp_path):
    _hop_stubs(monkeypatch, tmp_path, [BrokenProcessPool("terminated abruptly")] * 2)
    with pytest.raises(RuntimeError, match="could not be read: the reader stopped part way"):
        chart_model.corridor("KORD->KNEW", wait=True)


class _Running(_Pool):
    def __init__(self):
        super().__init__()
        self.shut = False

    def submit(self, fn, *args):
        self.asked.append(args[0])
        return Future()  # never done: a read still going

    def shutdown(self, wait=True, cancel_futures=False):
        self.shut = True


def test_an_idle_pool_is_let_go_but_not_while_reading_or_soon_after(monkeypatch, tmp_path):
    pool = _Running()
    monkeypatch.setattr(chart_model, "READS_IN_PROCESS", True)
    monkeypatch.setattr(chart_model, "_PROCESSES", pool)
    monkeypatch.setattr(chart_model, "_READING", {})
    monkeypatch.setattr(detection, "_kept_path", lambda key: tmp_path / "not-kept.json")
    running = chart_model._reading(("KORD->KNEW", 4.0), (42.0, -87.9), (30.0, -90.0))
    later = chart_model._LAST_READ + chart_model.IDLE_S + 1
    # Still reading: kept, however long ago it began.
    assert not chart_model.release_idle(now=later) and not pool.shut
    running.set_result(None)
    # Read a moment ago: kept.
    assert not chart_model.release_idle(now=chart_model._LAST_READ + 1)
    assert chart_model.release_idle(now=chart_model._LAST_READ + chart_model.IDLE_S + 1)
    assert pool.shut and chart_model._PROCESSES is None and chart_model._READING == {}


def test_a_corridor_is_ready_once_read_here_or_kept_on_disk(monkeypatch, tmp_path):
    kept = tmp_path / "kept.json"
    monkeypatch.setattr(detection, "_kept_path", lambda key: kept)
    monkeypatch.setitem(detection._DETECT_JOBS, ("C81->KMSN", 4.0), {"done": True, "error": None})
    monkeypatch.setitem(detection._DETECT_JOBS, ("C81->KRFD", 4.0), {"done": False, "error": None})
    assert chart_model.corridor_kept("C81->KMSN")
    # Under way is not read; nor is a read that failed.
    assert not chart_model.corridor_kept("C81->KRFD")
    monkeypatch.setitem(detection._DETECT_JOBS, ("C81->KRFD", 4.0), {"done": True, "error": "no tiles"})
    assert not chart_model.corridor_kept("C81->KRFD")
    kept.write_text("[]")
    assert chart_model.corridor_kept("C81->KDLH")
