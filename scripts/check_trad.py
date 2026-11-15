"""Flag Mandarin script that is not already Taiwan traditional."""
import re
import sys
from pathlib import Path

from opencc import OpenCC

text = Path("js/courses.js").read_text(encoding="utf-8")
# Grab the mandarin object by slicing until `const japanese`.
start = text.index("const mandarin = {")
end = text.index("const japanese = {")
block = text[start:end]
scripts = re.findall(r'["“]([^"”]*[\u4e00-\u9fff][^"”]*)["”]', block)

s2tw = OpenCC("s2tw")
bad = 0
for script in scripts:
    converted = s2tw.convert(script)
    if converted != script:
        bad += 1
        print(f"NOT TAIWAN TRADITIONAL:\n  {script}\n  {converted}")

if bad:
    print(f"{bad} string(s) changed under s2tw")
    sys.exit(1)
print(f"traditional check passed ({len(scripts)} strings)")
