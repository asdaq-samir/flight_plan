import threading
import time

from wingtip.once import once


def test_callers_at_once_build_it_once_and_share_the_answer():
    built = []

    @once(maxsize=2)
    def table(path: str) -> list:
        built.append(path)
        time.sleep(0.2)
        return [path]

    answers = []
    threads = [threading.Thread(target=lambda: answers.append(table("APT_CON.csv"))) for _ in range(8)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert built == ["APT_CON.csv"]
    assert len(answers) == 8 and all(a is answers[0] for a in answers)


def test_other_keys_are_built_beside_each_other_and_a_failure_is_tried_again():
    calls = []
    # Side by side, not one after the other: "a" and "b" each wait inside
    # their build for the other to arrive, which only happens if neither
    # waits for the other to finish. It timed this before (under 0.35 s for
    # two 0.2 s builds), which a busy machine failed at 0.62 s.
    both_in = threading.Barrier(2, timeout=10)
    side_by_side = []

    @once(maxsize=4)
    def table(path: str) -> str:
        calls.append(path)
        if path == "bad" and calls.count("bad") == 1:
            raise OSError("not yet")
        if path in ("a", "b") and calls.count(path) == 1:
            try:
                both_in.wait()
                side_by_side.append(path)
            except threading.BrokenBarrierError:
                pass
        return path

    threads = [threading.Thread(target=table, args=(p,)) for p in ("a", "b")]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert sorted(side_by_side) == ["a", "b"]
    try:
        table("bad")
    except OSError:
        pass
    assert table("bad") == "bad"
    table.cache_clear()
    table("a")
    assert calls.count("a") == 2
