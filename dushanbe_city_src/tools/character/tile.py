import sys, glob, re, os
from PIL import Image
d=sys.argv[1]
for name in ('walk','run','idle','jump_start','fall','land'):
    for view in ('side','front'):
        fs=sorted(glob.glob(f'{d}/_{name}_{view}_*.png'), key=lambda p:int(re.findall(r'_(\d+)\.png',p)[0]))
        if not fs: continue
        ims=[Image.open(f).convert('RGB') for f in fs]
        W=Image.new('RGB',(300*len(ims),450),(40,40,40))
        for i,im in enumerate(ims): W.paste(im,(i*300,0))
        W.save(f'{d}/sheet_{name}_{view}.png')
