// Keyboard, mouse and touch state with per-frame edge detection (isPressed / wasPressedThisFrame).
export const Input = {
  down: new Set(), // currently held codes ("KeyA", "Mouse0", "Touch:jump"...)
  pressed: new Set(), // went down this frame
  released: new Set(),
  pendingDown: new Set(),
  pendingUp: new Set(),
  mouse: { x: 0, y: 0, moved: false },
  lastDevice: "keyboard",
  init(target) {
    window.addEventListener("keydown", (e) => {
      if (e.code === "Tab" || e.code === "Space" || e.code.startsWith("Arrow") || e.code === "F1") e.preventDefault();
      if (e.repeat) return;
      this.pendingDown.add(e.code); this.lastDevice = "keyboard";
    });
    window.addEventListener("keyup", (e) => this.pendingUp.add(e.code));
    window.addEventListener("blur", () => { for (const k of this.down) this.pendingUp.add(k); });
    target.addEventListener("mousedown", (e) => { this.pendingDown.add("Mouse" + e.button); this.lastDevice = "keyboard"; e.preventDefault(); });
    window.addEventListener("mouseup", (e) => this.pendingUp.add("Mouse" + e.button));
    target.addEventListener("contextmenu", (e) => e.preventDefault());
    target.addEventListener("mousemove", (e) => { this.mouse.x = e.clientX; this.mouse.y = e.clientY; this.mouse.moved = true; });
  },
  // virtual buttons (touch)
  press(code) { this.pendingDown.add(code); this.lastDevice = "touch"; },
  release(code) { this.pendingUp.add(code); },
  beginFrame() {
    this.pressed.clear(); this.released.clear();
    for (const k of this.pendingDown) { if (!this.down.has(k)) this.pressed.add(k); this.down.add(k); }
    for (const k of this.pendingUp) {
      if (this.pendingDown.has(k)) { this.released.add(k); this.down.delete(k); continue; } // tap within one frame: down this frame, up next
      if (this.down.has(k)) { this.down.delete(k); this.released.add(k); }
    }
    // keep a tap visible for exactly one frame
    for (const k of this.pendingUp) if (this.pendingDown.has(k)) this.down.add(k), this._tapRelease = (this._tapRelease || new Set()).add(k);
    this.pendingDown.clear(); this.pendingUp.clear();
    if (this._tapReleaseNext) { for (const k of this._tapReleaseNext) if (!this.pressed.has(k)) this.down.delete(k); this._tapReleaseNext = null; }
    if (this._tapRelease) { this._tapReleaseNext = this._tapRelease; this._tapRelease = null; }
  },
  held(...codes) { return codes.some((c) => this.down.has(c)); },
  hit(...codes) { return codes.some((c) => this.pressed.has(c)); },
  any() { return this.pressed.size > 0; },
};
