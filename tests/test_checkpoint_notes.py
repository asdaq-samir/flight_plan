"""vfr.checkpoint_notes: a pilot's own edit is theirs, the shared note
is everyone else's, and nothing an edit replaces is lost."""
import threading

from vfr import checkpoint_notes, routecsv

ROUTE = "C81->KDLH"


def test_a_pilots_edit_is_theirs_and_everyone_else_keeps_the_shared_note(tmp_path):
    path = tmp_path / "notes.csv"
    checkpoint_notes.save_note(ROUTE, 45.0, -90.0, "Shared: the lake with the island", path=path)
    checkpoint_notes.save_note(ROUTE, 45.0, -90.0, "Mine: north shore", pilot="42", path=path)

    notes = checkpoint_notes.load_notes(ROUTE, path=path)
    assert checkpoint_notes.find_note(notes, 45.0, -90.0, "42")["description"] == "Mine: north shore"
    assert checkpoint_notes.find_note(notes, 45.0, -90.0, "7")["description"] == "Shared: the lake with the island"
    assert checkpoint_notes.find_note(notes, 45.0, -90.0)["description"] == "Shared: the lake with the island"


def test_an_edit_is_added_and_what_it_replaced_stays(tmp_path):
    path = tmp_path / "notes.csv"
    checkpoint_notes.save_note(ROUTE, 45.0, -90.0, "first", path=path)
    checkpoint_notes.save_note(ROUTE, 45.0, -90.0001, "second", path=path)

    notes = checkpoint_notes.load_notes(ROUTE, path=path)
    assert [n["description"] for n in notes] == ["first", "second"]
    assert checkpoint_notes.find_note(notes, 45.0, -90.0)["description"] == "second"


def test_a_row_from_before_pilots_reads_as_the_shared_note(tmp_path):
    path = tmp_path / "notes.csv"
    path.write_text("route,lat,lon,description,created_at\nC81->KDLH,45.0,-90.0,old,2026-09-18T04:41:16+00:00\n")

    notes = checkpoint_notes.load_notes(ROUTE, path=path)
    assert checkpoint_notes.find_note(notes, 45.0, -90.0, "42")["description"] == "old"


def test_concurrent_saves_keep_every_row(tmp_path):
    """Read, change, write back, from twenty threads at once: without the
    lock each writer's copy dropped the others' rows."""
    path = tmp_path / "notes.csv"

    def save(i):
        checkpoint_notes.save_note(ROUTE, 45.0 + i, -90.0, f"note {i}", path=path)

    threads = [threading.Thread(target=save, args=(i,)) for i in range(20)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    assert len(checkpoint_notes.load_notes(path=path)) == 20


def test_a_failed_write_leaves_the_old_file_whole(tmp_path):
    path = tmp_path / "rows.csv"
    routecsv.write_rows(path, ["route", "lat"], [{"route": ROUTE, "lat": 1.0}])

    class Boom:
        def get(self, column):
            raise RuntimeError("disk gone")

    try:
        routecsv.write_rows(path, ["route", "lat"], [{"route": ROUTE, "lat": 2.0}, Boom()])
    except RuntimeError:
        pass

    assert path.read_text().splitlines() == ["route,lat", f"{ROUTE},1.0"]
    assert [p.name for p in tmp_path.iterdir()] == ["rows.csv"]
