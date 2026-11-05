#!/usr/bin/env python3
"""Bundle the mini app into ONE self-contained HTML file: dist/homebeast.html.
Inlines the ES modules (pet rigs + PetView) and all images as data URIs.
usage: python3 tools/build_single.py"""
import base64, os, re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MODS = ['util', 'dragon_tl', 'dog_tl', 'cheetah_tl', 'dragon', 'dog', 'cheetah', 'petview']
PATHS = {m: f'js/pets/{m}.js' for m in MODS}
PATHS['petview'] = 'js/petview.js'
IMP = re.compile(r"import\s*\{([^}]*)\}\s*from\s*'\./(?:pets/)?(\w+)\.js';")

def names(spec):
    return ', '.join(n.strip().replace(' as ', ': ') for n in spec.split(',') if n.strip())

def module(name):
    src = open(os.path.join(ROOT, PATHS[name]), encoding='utf-8').read()
    src = IMP.sub(lambda m: f"const {{ {names(m.group(1))} }} = __m_{m.group(2)};", src)
    exports = re.findall(r'^export\s+(?:async\s+)?(?:class|function|const|let)\s+(\w+)', src, re.M)
    src = re.sub(r'^export\s+', '', src, flags=re.M)
    return f"// ---- {PATHS[name]}\nconst __m_{name} = (() => {{\n{src}\nreturn {{ {', '.join(exports)} }};\n}})();\n"

html = open(os.path.join(ROOT, 'index.html'), encoding='utf-8').read()
bundle = ''.join(module(m) for m in MODS)
html = html.replace("import { PetView } from './js/petview.js';", bundle + "const { PetView } = __m_petview;")

def data_uri(m):
    path = m.group(1)
    mime = 'image/webp' if path.endswith('.webp') else 'image/svg+xml' if path.endswith('.svg') else 'image/png'
    return "'data:%s;base64,%s'" % (mime, base64.b64encode(open(os.path.join(ROOT, path), 'rb').read()).decode())
html = re.sub(r"'(assets/[\w/.-]+)'", data_uri, html)
assert "from './" not in html and "'assets/" not in html, 'unbundled reference left'
os.makedirs(os.path.join(ROOT, 'dist'), exist_ok=True)
out = os.path.join(ROOT, 'dist', 'homebeast.html')
open(out, 'w', encoding='utf-8').write(html)
print(out, f'{os.path.getsize(out) / 1024:.0f} KB')
