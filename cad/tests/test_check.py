import json, shutil, subprocess, sys
from pathlib import Path

HERE = Path(__file__).parent
CHECK = HERE.parent / "check.py"

def run(tmp_path, part_file):
    shutil.copy(HERE / "fixtures" / "dims.json", tmp_path / "dims.json")
    shutil.copy(HERE / "fixtures" / part_file, tmp_path / "part.py")
    subprocess.run([sys.executable, str(CHECK)], cwd=tmp_path, check=False, capture_output=True)
    return json.loads((tmp_path / "check.json").read_text())

def test_good_part_passes_and_exports(tmp_path):
    result = run(tmp_path, "good_part.py")
    assert result["ok"], result
    assert (tmp_path / "plate.step").exists() and (tmp_path / "plate.stl").exists()

def test_shifted_hole_fails_with_reason(tmp_path):
    result = run(tmp_path, "shifted_hole.py")
    assert not result["ok"]
    assert any("h1" in r for r in result["parts"][0]["reasons"])
