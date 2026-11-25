# Builds Assets/Resources/credits.txt (shown on the in-game "АВТОРЫ" page) from ASSET_LICENSES.md and
# Assets/Resources/Sounds/CREDITS.md, so in-game attribution always matches the licence records.
#   python3 -I tools/credits/make_credits.py
import os, re
R = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

def rows(path):
    out, head = [], None
    for line in open(path, encoding='utf-8'):
        line = line.strip()
        if line.startswith('#'): head = line.lstrip('# ').strip(); continue
        if not line.startswith('|') or set(line) <= set('|-: '): continue
        cells = [c.strip() for c in line.strip('|').split('|')]
        if cells and cells[0] in ('Asset', 'File'): continue
        out.append((head, cells))
    return out

clean = lambda s: re.sub(r'\s+', ' ', re.sub(r'\(.*?\.txt\)|—\s*Assets/\S+|Assets/\S+', '', s)).strip(' —')
lines = ['<b>БАЗАР</b> — игра проекта Safarzod.', '']
sect = None
for head, c in rows(os.path.join(R, 'ASSET_LICENSES.md')):
    if len(c) < 3 or 'legacy' in c[0]: continue          # legacy Bazaar scene props are not in the shipped level
    if head != sect:
        sect = head; lines += ['', '<b>' + {'3D models (Sketchfab, CC Attribution 4.0)': 'Модели (Sketchfab)', 'Level': 'Карта, текстуры, шрифт граффити',
            'Fonts (UI)': 'Шрифты интерфейса'}.get(head, 'Руки от первого лица' if head and head.startswith('First-person') else head) + '</b>']
    asset, author, lic = clean(c[0]), re.sub(r';\s*(the description|same note).*', '', c[1].split('. NOTE')[0]).strip(), c[2].split('(')[0].strip()
    lines.append(f'{asset} — {author} ({lic})')
cc0, by = set(), []
for _, c in rows(os.path.join(R, 'Assets/Resources/Sounds/CREDITS.md')):
    if len(c) < 5: continue
    title, author, lic = c[1], c[2], c[3]
    if lic.startswith('CC0'): cc0.add(author)
    elif (title, author, lic) not in by: by.append((title, author, lic))
lines += ['', '<b>Звуки (настоящие записи)</b>']
lines += [f'«{t}» — {a} ({l}), freesound.org' for t, a, l in by]
lines.append('CC0: ' + ', '.join(sorted(cc0)))
lines += ['', 'Полные условия лицензий: CC BY 4.0 — creativecommons.org/licenses/by/4.0, SIL OFL 1.1 — openfontlicense.org.']
open(os.path.join(R, 'Assets/Resources/credits.txt'), 'w', encoding='utf-8').write('\n'.join(lines).replace('\n\n\n', '\n\n') + '\n')
print(len(lines), 'lines')
