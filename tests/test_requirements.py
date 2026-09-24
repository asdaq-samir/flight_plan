"""Pins that two images must agree on, read from their requirement files."""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MODEL_RUNTIME = ("scikit-learn", "joblib", "numpy", "pandas")


def _pins(path: Path) -> dict:
    """name -> version for every `name==version` line, following `-r`."""
    pins = {}
    for line in path.read_text().splitlines():
        line = line.split("#", 1)[0].strip()
        if line.startswith("-r "):
            pins.update(_pins((path.parent / line[3:].strip()).resolve()))
        elif match := re.fullmatch(r"([A-Za-z0-9_.\-\[\]]+)==(\S+)", line):
            pins[re.sub(r"\[.*\]", "", match[1]).lower()] = match[2]
    return pins


def test_the_image_that_writes_the_model_and_the_one_that_loads_it_pin_the_same_runtime():
    # The writer was unpinned under a "bump both together" note, so the
    # first training rebuild after a scikit-learn release wrote a model
    # the service would load with a different version.
    writer = _pins(ROOT / "docker" / "requirements-training.txt")
    reader = _pins(ROOT / "model-service" / "requirements.txt")
    assert {name: writer.get(name) for name in MODEL_RUNTIME} == {name: reader.get(name) for name in MODEL_RUNTIME}
    assert all(writer.get(name) for name in MODEL_RUNTIME)
