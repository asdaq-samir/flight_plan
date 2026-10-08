"""A corridor not yet read is read in a process of its own and loaded
from what it kept (app.chart_model), so the planner's other requests do
not wait on it."""
import threading
from collections import deque
from concurrent.futures import Future
from concurrent.futures.process import BrokenProcessPool
from types import SimpleNamespace

import pytest
from app import chart_model, detection


@pytest.fixture(autouse=True)
def _empty_queue(monkeypatch):
    """Each test with the reader's queue empty and no read under way."""
    monkeypatch.setattr(chart_model, "_WANTED", deque())
    monkeypatch.setattr(chart_model, "_AHEAD", deque())
    monkeypatch.setattr(chart_model, "_RUNNING", 0)
    monkeypatch.setattr(chart_model, "_RUNNING_AHEAD", 0)


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


class _Held(_Pool):
    """A pool whose reads end when the test says: each read's future, by key."""
    def __init__(self):
        super().__init__()
        self.reads = {}

    def submit(self, fn, *args):
        self.asked.append(args[0][0])
        self.reads[args[0][0]] = Future()
        return self.reads[args[0][0]]


def _held(monkeypatch, tmp_path):
    pool = _Held()
    monkeypatch.setattr(chart_model, "READS_IN_PROCESS", True)
    monkeypatch.setattr(chart_model, "_PROCESSES", pool)
    monkeypatch.setattr(chart_model, "_READING", {})
    monkeypatch.setattr(detection, "_kept_path", lambda key: tmp_path / "not-kept.json")
    return pool


def _ask(route, ahead=False):
    return chart_model._reading((route, 4.0), (42.0, -88.0), (43.0, -89.0), ahead=ahead)


def test_a_read_waited_on_goes_before_the_reads_ahead_and_those_newest_first(monkeypatch, tmp_path):
    """The reads ahead one at a time, the latest typed first, a process
    kept for the route whose checkpoints are waited on -- where first
    come, first served had them wait 22 s behind routes typed on the way."""
    pool = _held(monkeypatch, tmp_path)
    for route in ("A->B", "B->C", "C->D", "D->E"):
        _ask(route, ahead=True)
    assert pool.asked == ["A->B"]
    wanted = _ask("X->Y")
    assert pool.asked == ["A->B", "X->Y"]
    pool.reads["A->B"].set_result(None)
    assert pool.asked[2] == "D->E"
    pool.reads["X->Y"].set_result(None)
    assert wanted.done() and wanted.result() is None
    pool.reads["D->E"].set_result(None)
    assert pool.asked == ["A->B", "X->Y", "D->E", "C->D"]


def test_a_read_ahead_that_is_then_waited_on_is_read_next(monkeypatch, tmp_path):
    pool = _held(monkeypatch, tmp_path)
    for route in ("A->B", "B->C", "C->D", "D->E", "E->F"):
        _ask(route, ahead=True)
    # C->D, queued behind E->F and D->E, waited on now: read at once.
    waited = _ask("C->D")
    assert pool.asked == ["A->B", "C->D"]
    pool.reads["C->D"].set_result("no tiles")
    assert waited.result() == "no tiles"


def test_past_a_few_reads_ahead_the_oldest_are_dropped(monkeypatch, tmp_path):
    pool = _held(monkeypatch, tmp_path)
    routes = [f"R{i}->S{i}" for i in range(1 + chart_model.AHEAD_KEPT + 2)]
    futures = [_ask(route, ahead=True) for route in routes]
    # One reading, AHEAD_KEPT queued, and the two oldest queued dropped.
    assert pool.asked == routes[:1]
    assert futures[1].cancelled() and futures[2].cancelled()
    assert (routes[1], 4.0) not in chart_model._READING
    # Asked for again, by a route that waits on it: read.
    again = _ask(routes[1])
    assert again is not futures[1] and not again.done() and pool.asked == [routes[0], routes[1]]
