import sys; sys.path.insert(0,'/home/user/safarzod/dushanbe_city_src/tools/character')
from rig_def import BONES
from PIL import Image, ImageDraw
S='/tmp/claude-0/-home-user-safarzod/a46b42c2-beab-5efe-837a-7f7bc68c0bbc/scratchpad/'
for view,ax in (('front',0),('side',1)):
    im=Image.open(S+'src_'+view+'.png').convert('RGB'); d=ImageDraw.Draw(im)
    P=lambda p:(300+p[ax]*450, 450-(p[2]-0.9)*450)
    for n,h,t,par,c in BONES:
        if n=='root': continue
        d.line([P(h),P(t)],fill=(0,255,0),width=2); x,y=P(h); d.ellipse([x-3,y-3,x+3,y+3],fill=(255,0,0))
    im.save(S+'ov_'+view+'.png')
