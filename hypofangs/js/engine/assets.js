// Sprite atlases, audio clips and data files.
export const Assets = {
  manifest: null,
  pages: [], // {img, tex, loaded}
  sprites: {}, // name -> Sprite
  groupsLoaded: new Set(),
  renderer: null,
  json: {},
  async init(renderer) {
    this.renderer = renderer;
    this.manifest = await (await fetch("data/sprites.json")).json();
    this.pages = this.manifest.pages.map((name) => ({ name, img: null, tex: null }));
    for (const [name, e] of Object.entries(this.manifest.sprites)) {
      this.sprites[name] = new Sprite(name, e);
    }
  },
  async loadJSON(path) {
    if (!this.json[path]) this.json[path] = await (await fetch(path)).json();
    return this.json[path];
  },
  loadGroup(g, onProgress) {
    if (this.groupsLoaded.has(g)) return Promise.resolve();
    const ids = this.manifest.groups[g] || [];
    let done = 0;
    return Promise.all(ids.map((i) => new Promise((res, rej) => {
      const p = this.pages[i];
      if (p.tex) { res(); return; }
      const img = new Image();
      img.onload = () => {
        p.img = img; p.tex = this.renderer.makeTexture(img); p.w = img.width; p.h = img.height;
        done++; onProgress && onProgress(done / ids.length);
        res();
      };
      img.onerror = () => rej(new Error("atlas " + p.name));
      img.src = "atlas/" + p.name;
    }))).then(() => this.groupsLoaded.add(g));
  },
  // load every atlas page a scene references (plus whole groups)
  loadForScene(json, groups) {
    const pages = new Set();
    for (const g of groups) for (const i of this.manifest.groups[g] || []) pages.add(i);
    const re = /"S:([^"]+)"/g, str = JSON.stringify(json);
    let m;
    while ((m = re.exec(str))) { const s = this.sprites[m[1]]; if (s) pages.add(s.page); }
    return Promise.all([...pages].map((i) => this.loadPage(i)));
  },
  loadPage(i) {
    const p = this.pages[i];
    if (p.tex) return Promise.resolve();
    if (p.promise) return p.promise;
    p.promise = new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => { p.img = img; p.tex = this.renderer.makeTexture(img); p.w = img.width; p.h = img.height; res(); };
      img.onerror = () => rej(new Error("atlas " + p.name));
      img.src = "atlas/" + p.name;
    });
    return p.promise;
  },
  sprite(ref) {
    if (!ref) return null;
    if (ref.startsWith && ref.startsWith("S:")) ref = ref.slice(2);
    return this.sprites[ref] || null;
  },
  frames(arr) { return arr ? arr.map((r) => this.sprite(r)).filter(Boolean) : []; },
};

export class Sprite {
  constructor(name, e) {
    this.name = name;
    [this.page, this.x, this.y, this.w, this.h, this.px, this.py, this.ppu] = e;
    this.border = e[8] || null;
    // local rect in world units relative to pivot
    this.minX = -this.px * this.w / this.ppu;
    this.minY = -this.py * this.h / this.ppu;
    this.maxX = this.minX + this.w / this.ppu;
    this.maxY = this.minY + this.h / this.ppu;
  }
  get pageObj() { return Assets.pages[this.page]; }
  get tex() { return Assets.pages[this.page].tex; }
  get loaded() { return !!Assets.pages[this.page].tex; }
  uv() {
    const p = Assets.pages[this.page];
    return [this.x / p.w, this.y / p.h, (this.x + this.w) / p.w, (this.y + this.h) / p.h];
  }
  get boundsW() { return this.w / this.ppu; }
  get boundsH() { return this.h / this.ppu; }
}
