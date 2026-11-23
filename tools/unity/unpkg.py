import sys, struct, zlib, os, gzip, xml.etree.ElementTree as ET
pkg, out = sys.argv[1], sys.argv[2]
f = open(pkg, 'rb')
magic, hsize, ver, tclen, tulen, ck = struct.unpack('>4sHHQQI', f.read(28))
assert magic == b'xar!'
f.seek(hsize); toc = ET.fromstring(zlib.decompress(f.read(tclen))); heap = hsize + tclen
pay = None
def walk(e, path):
    global pay
    for fe in e.findall('file'):
        name = fe.find('name').text; p = path + '/' + name
        d = fe.find('data')
        if d is not None:
            print(p, d.find('length').text, d.find('encoding').get('style'))
            if name.startswith('Payload'):
                pay = (int(d.find('offset').text), int(d.find('length').text), d.find('encoding').get('style'))
        walk(fe, p)
walk(toc.find('toc'), '')
off, ln, enc = pay
class Sub:
    def __init__(s): f.seek(heap + off); s.left = ln
    def read(s, n=-1):
        if n < 0 or n > s.left: n = s.left
        b = f.read(n); s.left -= len(b); return b
raw = Sub()
head = f.read(4); f.seek(heap + off)
print('payload magic', head)
src = gzip.GzipFile(fileobj=raw) if head[:2] == b'\x1f\x8b' else raw
def rd(n):
    b = b''
    while len(b) < n:
        c = src.read(n - len(b))
        if not c: break
        b += c
    return b
n = 0
while True:
    h = rd(76)
    if len(h) < 76: break
    assert h[:6] == b'070707', h[:6]
    mode = int(h[18:24], 8); nsz = int(h[59:65], 8); fsz = int(h[65:76], 8)
    name = rd(nsz)[:-1].decode()
    if name == 'TRAILER!!!': break
    dst = os.path.normpath(os.path.join(out, name))
    assert dst.startswith(os.path.normpath(out)), name
    t = mode & 0o170000
    if t == 0o040000:
        os.makedirs(dst, exist_ok=True)
    elif t == 0o120000:
        tgt = rd(fsz).decode(); os.makedirs(os.path.dirname(dst), exist_ok=True)
        if os.path.lexists(dst): os.remove(dst)
        os.symlink(tgt, dst)
    else:
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        with open(dst, 'wb') as o:
            left = fsz
            while left:
                c = rd(min(left, 1 << 20)); o.write(c); left -= len(c)
        os.chmod(dst, mode & 0o777)
    n += 1
print('files', n)
