"""Every image that imports wingtip builds wingtip's Rust extension with the same
wingtip-native stage, word for word, as docker/Dockerfile.native has it.

wingtip imports wingtip_native at module level since the shared engine
(2026-11-03), so each image that copies src/ needs the wheel; in CI's
build of 2026-11-05 every image but the planner's failed on "No module
named 'wingtip_native'". The stage is repeated rather than shared because a
Dockerfile cannot include another and a named build context did not work
under compose (a `service:` context on a service scaled to zero is not
found). Kept the same text, BuildKit's cache key is the same, so one bake
of every image compiles the engine once and a commit that leaves native/
alone takes it from the registry's cache; a copy that drifts would
compile again, and could build the wheel differently.
"""
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
CANONICAL = ROOT / "docker" / "Dockerfile.native"
START = "# >>> wingtip-native"
END = "# <<< wingtip-native"

# Every image whose Dockerfile copies src/ (wingtip) in, and so needs the wheel.
IMAGES = [
    "planning-service/Dockerfile",
    "docker/Dockerfile.ml",
    "docker/Dockerfile.processing",
    "docker/Dockerfile.training",
]


def stage(text: str) -> str:
    start = text.index(START)
    return text[start:text.index(END, start) + len(END)]


@pytest.mark.parametrize("path", IMAGES)
def test_the_stage_is_the_canonical_one(path):
    text = (ROOT / path).read_text()
    assert stage(text) == stage(CANONICAL.read_text())


@pytest.mark.parametrize("path", IMAGES)
def test_the_image_installs_the_wheel(path):
    text = (ROOT / path).read_text()
    assert "--mount=type=bind,from=native,source=/wheels,target=/tmp/wheels" in text


def test_every_image_reading_src_is_listed():
    readers = {
        str(p.relative_to(ROOT))
        for p in [*ROOT.glob("*/Dockerfile"), *ROOT.glob("docker/Dockerfile.*")]
        if "COPY src" in p.read_text() or "src/requirements" in p.read_text()
    }
    assert readers <= set(IMAGES), readers - set(IMAGES)
