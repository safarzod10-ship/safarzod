import random, sys, os
sys.path.insert(0, os.path.dirname(__file__))
import meshkit as mk, buildings as bl
rng = random.Random(4)
base, det = mk.Builder(), mk.Builder()
ctx = bl.Ctx(base, det, rng)
specs = [
    bl.make("panel5", rng, x=0, z=0, L=48, D=12, n_entr=3, entr_side="front", roof="gable"),
    bl.make("panel9", rng, x=70, z=0, L=40, D=13, n_entr=2, entr_side="front",
            shops=[("front", -19, -10, "dorukhona"), ("front", 9, 19, "magoza")]),
    bl.make("brick5", rng, x=130, z=0, L=36, D=12, n_entr=2, entr_side="front"),
    bl.make("tower", rng, x=0, z=-60, L=30, D=16, n_entr=1, entr_side="back", floors=14,
            shops=[("front", -14, -2, "supermarket"), ("front", 2, 14, "qahvakhona")]),
    bl.make("school", rng, x=70, z=-60, L=50, D=14, n_entr=1, entr_side="front", sign=None),
    bl.make("hospital", rng, x=140, z=-60, L=40, D=14, n_entr=1, entr_side="front", sign="bemorkhona"),
    bl.make("shop", rng, x=-50, z=0, L=16, D=10, shops=[("front", -7.5, 7.5, "choikhona")]),
    bl.make("house", rng, x=-50, z=-40, L=12, D=9),
]
for B in specs:
    bl.build(ctx, B)
mk.write_glb(sys.argv[1], [("base", base.meshes), ("detail", det.meshes)])
tb = sum(base.stats().values()); td = sum(det.stats().values())
print("tris base", tb, "detail", td, "attach", len(ctx.attach), "colliders", len(ctx.colliders))
