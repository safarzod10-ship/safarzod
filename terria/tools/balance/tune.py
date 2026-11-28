import subprocess, json, random, math, sys
from concurrent.futures import ThreadPoolExecutor
random.seed(7)
TARGET={'th2':1,'th3':5,'th4':14,'th5':30,'th6':55,'land0.1':7,'land0.25':20,'land0.5':42,'land0.75':62,'land1':82,'end':90}
base={"levelTime":[0.1,0.4,1,2,4],"builders":[2,3,4,5,6,7],"levelCost":[1,3,8,20,50]}
def sim(k, prof='diligent'):
    o=dict(base, costScale=k['cs'], landBase=k['lb'], landK=k['lk'], landGrowth=k['lg'],
           thCost=[round(x*k['tc']) for x in [0,300,3000,25000,150000,600000]],
           thPop=[round(x*k['tp']) for x in [0,60,400,2000,7000,18000]],
           thLand=[0,0.03,0.1,0.25,0.45,0.7])
    out=subprocess.run(['node','sim.ts',prof,json.dumps(o)],capture_output=True,text=True,timeout=600).stdout.strip().splitlines()[-1]
    d=json.loads(out); d['marks']['end']=d['days'] if d['days']<400 else 999; return d,o
def score(d):
    m=d['marks']; return sum((math.log((m.get(k,999)+2)/(v+2)))**2 for k,v in TARGET.items())
def rnd(): return dict(cs=random.uniform(0.3,1.2), lb=random.uniform(5,60), lk=random.uniform(2,40), lg=random.uniform(0.8,2.2), tc=random.uniform(0.3,3), tp=random.uniform(0.4,2))
best=[]
with ThreadPoolExecutor(8) as ex:
    b0=json.load(open("best.json")); pts=[rnd() for _ in range(60)]+[{kk:v*random.uniform(0.8,1.2) for kk,v in b0.items()} for _ in range(40)]
    for k,(d,o) in zip(pts, ex.map(sim, pts)): best.append((score(d),k,d))
    best.sort(key=lambda x:x[0])
    for it in range(4):
        seeds=[b[1] for b in best[:8]]
        pts=[{kk:v*random.uniform(0.85,1.15) for kk,v in s.items()} for s in seeds for _ in range(10)]
        for k,(d,o) in zip(pts, ex.map(sim, pts)): best.append((score(d),k,d))
        best.sort(key=lambda x:x[0])
        print('iter',it,round(best[0][0],3), {k:round(v,3) for k,v in best[0][1].items()}, flush=True)
s,k,d=best[0]
print(json.dumps({'k':k,'marks':d['marks'],'block':d['block'],'perDay':d['perDay'],'pop':d['pop'],'bld':d['buildings'],'byType':d['byType']}))
json.dump(k, open('best.json','w'))
