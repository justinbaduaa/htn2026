"""Builds slicer/ender3v2.ini from PrusaSlicer's Creality vendor bundle. Run once: .venv/bin/python slicer/flatten.py"""
import configparser, urllib.request
from pathlib import Path

URL = "https://raw.githubusercontent.com/prusa3d/PrusaSlicer-settings/master/live/Creality/0.3.0.ini"
PRINTER, PRINT, FILAMENT = "printer:Creality Ender-3 V2 (0.4 mm nozzle)", "print:0.20 mm NORMAL (0.4 mm nozzle) @CREALITY", "filament:Generic PLA @CREALITY"

text = urllib.request.urlopen(URL).read().decode()
cp = configparser.RawConfigParser(strict=False, interpolation=None, delimiters=("=",))
cp.optionxform = str
cp.read_string(text)

def resolve(section):
    """Depth-first merge. `inherits = A; B` applies A, then B, then the section's own keys."""
    prefix = section.split(":")[0]
    out = {}
    for parent in [p.strip() for p in cp.get(section, "inherits", fallback="").split(";") if p.strip()]:
        out.update(resolve(f"{prefix}:{parent}"))
    for k, v in cp.items(section):
        if k != "inherits":
            out[k] = v
    return out

flat = {}
for s in (PRINTER, PRINT, FILAMENT):
    flat.update(resolve(s))
flat.pop("printer_model", None); flat.pop("printer_variant", None)
Path(__file__).with_name("ender3v2.ini").write_text("\n".join(f"{k} = {v}" for k, v in sorted(flat.items())) + "\n")
print(f"wrote {len(flat)} keys")
