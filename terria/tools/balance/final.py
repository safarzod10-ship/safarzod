import subprocess, json, sys
k=json.load(open('best.json'))
def cfg(cs, cells=8500):
    return {"levelTime":[0.1,0.4,1,2,4],"builders":[2,3,4,5,6,7],"levelCost":[1,3,8,20,50],"costScale":cs,"landBase":k['lb'],"landK":k['lk'],"landGrowth":k['lg'],
     "thCost":[round(x*k['tc']) for x in [0,300,3000,25000,150000,600000]],"thPop":[round(x*k['tp']) for x in [0,60,400,2000,7000,18000]],"thLand":[0,0.03,0.1,0.25,0.45,0.7],
     "regionCells":cells,"starterCells":round(cells*0.01)}
def run(prof, cs, cells=8500):
    d=json.loads(subprocess.run(['node','sim.ts',prof,json.dumps(cfg(cs,cells))],capture_output=True,text=True,timeout=600).stdout.strip().splitlines()[-1]); return d
for cs in []:
    d=run('diligent',cs); print(cs, d['days'], d['marks'])
print('---')
from concurrent.futures import ThreadPoolExecutor
jobs=[(p,0.30,8500) for p in ['hardcore','diligent','normal','casual']]+[('diligent',0.30,4090),('diligent',0.30,11196)]
with ThreadPoolExecutor(4) as ex:
    for (p,cs,c),d in zip(jobs, ex.map(lambda j: run(*j), jobs)):
        print(p, c, 'days', d['days'], 'th6', d['marks'].get('th6'), 'land1', d['marks'].get('land1'), 'act/day', d['perDay'], 'pop', d['pop'], 'bld', d['buildings'], d['block'])
