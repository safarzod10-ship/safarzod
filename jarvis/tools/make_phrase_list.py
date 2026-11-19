"""Генерирует PHRASES.md (список для записи) из phrases.json.

Запуск: python3 jarvis/tools/make_phrase_list.py
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
data = json.loads((ROOT / "sounds" / "phrases.json").read_text(encoding="utf-8"))
cats = data["categories"]
total = sum(len(c["phrases"]) for c in cats)

out = [
    "# Фразы Джарвиса — список для записи",
    "",
    f"Всего: **{total} файлов** в **{len(cats)} категориях**.",
    "",
    "## Как записывать",
    "- Формат: **OGG** (или WAV), моно, 44.1 кГц или 48 кГц.",
    "- Одна фраза = один файл. Имя файла указано слева от фразы.",
    "- Путь: `jarvis/sounds/voice/<категория>/<имя файла>.ogg`.",
    "- Тишина в начале и конце: не больше 0.1 сек.",
    "- Одинаковая громкость во всех файлах (нормализация до −1 dB).",
    "- Приложение берёт случайный вариант из категории и не повторяет предыдущий.",
    "- Время, дату, проценты и имена Джарвис вслух НЕ говорит: это показывается на экране.",
    "",
    "## Категории",
    "",
]
for c in cats:
    out.append(f"- [{c['title']}](#{c['key']}) — `{c['key']}` ({len(c['phrases'])})")
out.append("")

for c in cats:
    out.append(f'<a id="{c["key"]}"></a>')
    out.append(f"## {c['title']}")
    out.append(f"Папка `voice/{c['key']}/` · Когда: {c['when']}")
    out.append("")
    out.append("| Файл | Фраза |")
    out.append("|---|---|")
    for i, p in enumerate(c["phrases"], 1):
        out.append(f"| `{c['key']}_{i:02d}` | {p} |")
    out.append("")

(ROOT / "sounds" / "PHRASES.md").write_text("\n".join(out), encoding="utf-8")
print(f"OK: {total} phrases, {len(cats)} categories")
