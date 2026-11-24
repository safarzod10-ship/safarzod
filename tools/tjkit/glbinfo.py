import json, struct, sys
for p in sys.argv[1:]:
    b = open(p, 'rb').read()
    n = struct.unpack('<I', b[12:16])[0]
    j = json.loads(b[20:20 + n])
    print(p.split('/')[-1], len(b) // 1024, 'KB')
    print(' images', [(i.get('mimeType'), j['bufferViews'][i['bufferView']]['byteLength'] // 1024) for i in j.get('images', [])])
    for m in j['materials']:
        print(' mat', m['name'], {k: v for k, v in m.items() if k in ('occlusionTexture', 'normalTexture', 'alphaMode')}, m['pbrMetallicRoughness'])
    print(' nodes', [(nd.get('name'), nd.get('translation'), nd.get('children')) for nd in j['nodes']])
