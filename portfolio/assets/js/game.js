/* =========================================================
   Mini runner for the "Зуба-Руба" card.
   Plays itself (demo), click / tap to take over and jump.
   ========================================================= */
(function () {
  "use strict";

  function MiniGame(canvas) {
    this.c = canvas;
    this.ctx = canvas.getContext("2d");
    this.W = 300; this.H = 560;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = this.W * this.dpr; canvas.height = this.H * this.dpr;
    this.ctx.scale(this.dpr, this.dpr);

    this.groundY = 430;
    this.reset(true);
    this.best = 0;
    this.manualUntil = 0;
    this.visible = false;
    this.running = false;
    this.t = 0;
    this.particles = [];
    this.shake = 0;

    const jump = (e) => {
      e.preventDefault();
      this.manualUntil = performance.now() + 6000;
      this.jump();
    };
    canvas.addEventListener("pointerdown", jump);

    this.frame = this.frame.bind(this);
    if ("IntersectionObserver" in window) {
      new IntersectionObserver((en) => {
        this.visible = en[0].isIntersecting;
        if (this.visible && !this.running) { this.running = true; this.last = 0; requestAnimationFrame(this.frame); }
      }, { rootMargin: "100px" }).observe(canvas);
    } else { this.visible = true; this.running = true; requestAnimationFrame(this.frame); }
    this.render();
  }

  MiniGame.prototype.reset = function (first) {
    this.p = { x: 70, y: this.groundY, vy: 0, onGround: true, squash: 0 };
    this.obs = [];
    this.coins = [];
    this.speed = 210;
    this.spawn = 1.1;
    this.coinSpawn = 0.6;
    this.score = 0;
    this.dist = 0;
    if (!first) this.shake = 12;
  };

  MiniGame.prototype.jump = function () {
    if (this.p.onGround) {
      this.p.vy = -560; this.p.onGround = false; this.p.squash = -0.25;
      for (let i = 0; i < 6; i++) this.particles.push({ x: this.p.x, y: this.groundY, vx: (Math.random() - 0.5) * 120, vy: -Math.random() * 120, life: 0.5, c: "#fff6d8" });
    }
  };

  MiniGame.prototype.update = function (dt, now) {
    const p = this.p;
    this.t += dt;
    this.speed = Math.min(420, this.speed + dt * 6);
    this.dist += this.speed * dt;

    // physics
    p.vy += 1500 * dt;
    p.y += p.vy * dt;
    if (p.y >= this.groundY) {
      if (!p.onGround) { p.squash = 0.3; }
      p.y = this.groundY; p.vy = 0; p.onGround = true;
    }
    p.squash *= 0.86;

    // spawn obstacles (candies)
    this.spawn -= dt;
    if (this.spawn <= 0) {
      const tall = Math.random() < 0.35;
      this.obs.push({ x: this.W + 30, w: 30, h: tall ? 56 : 34, hue: Math.random() < 0.5 ? "#ff4f8b" : "#7a5cff" });
      this.spawn = 0.9 + Math.random() * 0.9 - Math.min(0.35, this.speed / 2000);
    }
    this.coinSpawn -= dt;
    if (this.coinSpawn <= 0) {
      this.coins.push({ x: this.W + 20, y: this.groundY - 90 - Math.random() * 90, got: false, a: 0 });
      this.coinSpawn = 0.7 + Math.random() * 0.8;
    }

    const demo = now > this.manualUntil;
    for (const o of this.obs) {
      o.x -= this.speed * dt;
      // demo AI: jump when an obstacle is close
      if (demo && !o.seen && o.x - p.x < 58 + this.speed * 0.06 && o.x > p.x) { o.seen = true; this.jump(); }
      // collision (forgiving box)
      if (p.x + 14 > o.x - o.w / 2 + 4 && p.x - 14 < o.x + o.w / 2 - 4 && p.y > this.groundY - o.h + 8) {
        this.best = Math.max(this.best, this.score);
        for (let i = 0; i < 18; i++) this.particles.push({ x: p.x, y: p.y - 20, vx: (Math.random() - 0.5) * 340, vy: -Math.random() * 340, life: 0.8, c: o.hue });
        this.reset(false);
        return;
      }
    }
    this.obs = this.obs.filter((o) => o.x > -40);

    for (const c of this.coins) {
      c.x -= this.speed * dt; c.a += dt * 6;
      if (!c.got && Math.abs(c.x - p.x) < 22 && Math.abs(c.y - (p.y - 24)) < 30) {
        c.got = true; this.score += 1;
        for (let i = 0; i < 8; i++) this.particles.push({ x: c.x, y: c.y, vx: (Math.random() - 0.5) * 160, vy: (Math.random() - 0.5) * 160, life: 0.5, c: "#ffd23f" });
      }
    }
    this.coins = this.coins.filter((c) => c.x > -20 && !c.got);
    if (Math.floor(this.dist / 400) > Math.floor((this.dist - this.speed * dt) / 400)) this.score += 1;

    for (const q of this.particles) { q.x += q.vx * dt; q.y += q.vy * dt; q.vy += 600 * dt; q.life -= dt; }
    this.particles = this.particles.filter((q) => q.life > 0);
    this.shake *= 0.88;
  };

  MiniGame.prototype.render = function () {
    const ctx = this.ctx, W = this.W, H = this.H, gy = this.groundY;
    ctx.save();
    if (this.shake > 0.3) ctx.translate((Math.random() - 0.5) * this.shake, (Math.random() - 0.5) * this.shake);

    // sky
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "#2b1d5c"); g.addColorStop(0.6, "#7a3d8f"); g.addColorStop(1, "#ff8a5c");
    ctx.fillStyle = g; ctx.fillRect(-20, -20, W + 40, H + 40);

    // sun
    ctx.fillStyle = "rgba(255,210,63,.95)";
    ctx.beginPath(); ctx.arc(W * 0.72, 250, 36, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "rgba(255,210,63,.16)";
    ctx.beginPath(); ctx.arc(W * 0.72, 250, 56, 0, Math.PI * 2); ctx.fill();

    // parallax hills
    const hill = (off, amp, y, col, k) => {
      ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(0, H);
      for (let x = 0; x <= W; x += 10) ctx.lineTo(x, y - Math.sin((x + off) * k) * amp - Math.sin((x + off) * k * 2.3) * amp * 0.4);
      ctx.lineTo(W, H); ctx.fill();
    };
    hill(this.dist * 0.15, 26, 340, "#5a2f7e", 0.018);
    hill(this.dist * 0.35, 18, 380, "#3d1f63", 0.026);

    // ground
    ctx.fillStyle = "#1f1240"; ctx.fillRect(0, gy, W, H - gy);
    ctx.fillStyle = "#ffd23f"; ctx.fillRect(0, gy, W, 4);
    ctx.fillStyle = "rgba(255,255,255,.08)";
    for (let i = 0; i < 8; i++) { const x = ((i * 60 - this.dist) % (W + 60) + W + 60) % (W + 60) - 30; ctx.fillRect(x, gy + 30, 26, 4); }

    // coins (stars)
    for (const c of this.coins) {
      ctx.save(); ctx.translate(c.x, c.y); ctx.scale(Math.cos(c.a) * 0.5 + 0.7, 1);
      ctx.fillStyle = "#ffd23f"; star(ctx, 0, 0, 5, 11, 5); ctx.fill();
      ctx.restore();
    }

    // obstacles: wrapped candies
    for (const o of this.obs) {
      const x = o.x, top = gy - o.h;
      ctx.fillStyle = o.hue;
      roundRect(ctx, x - o.w / 2, top, o.w, o.h, 10); ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,.35)";
      for (let s = top + 6; s < gy - 4; s += 12) { ctx.fillRect(x - o.w / 2 + 4, s, o.w - 8, 4); }
      ctx.fillStyle = o.hue;
      ctx.beginPath(); ctx.moveTo(x - 6, top + 2); ctx.lineTo(x - 14, top - 12); ctx.lineTo(x + 2, top - 6); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(x + 6, top + 2); ctx.lineTo(x + 14, top - 12); ctx.lineTo(x - 2, top - 6); ctx.closePath(); ctx.fill();
    }

    // player: a brave tooth
    const p = this.p, sq = p.squash;
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.scale(1 + sq * 0.6, 1 - sq);
    // shadow
    ctx.fillStyle = "rgba(0,0,0,.25)";
    ctx.beginPath(); ctx.ellipse(0, 2 + (gy - p.y) * 0, 18, 5, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#fffaf0";
    ctx.beginPath();
    ctx.moveTo(-18, -44);
    ctx.bezierCurveTo(-24, -60, -6, -64, 0, -56);
    ctx.bezierCurveTo(6, -64, 24, -60, 18, -44);
    ctx.bezierCurveTo(16, -26, 14, -14, 12, 0);
    ctx.bezierCurveTo(8, 0, 6, -14, 0, -14);
    ctx.bezierCurveTo(-6, -14, -8, 0, -12, 0);
    ctx.bezierCurveTo(-14, -14, -16, -26, -18, -44);
    ctx.fill();
    ctx.strokeStyle = "#e9dcc0"; ctx.lineWidth = 2; ctx.stroke();
    // eyes
    const blink = (Math.sin(this.t * 3) > 0.97) ? 0.2 : 1;
    ctx.fillStyle = "#1f1600";
    ctx.beginPath(); ctx.ellipse(-6, -40, 3, 4 * blink, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(7, -40, 3, 4 * blink, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#ff7aa8";
    ctx.beginPath(); ctx.ellipse(-11, -32, 3.5, 2, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(12, -32, 3.5, 2, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "#1f1600"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(1, -34, 4, 0.15 * Math.PI, 0.85 * Math.PI); ctx.stroke();
    ctx.restore();

    // particles
    for (const q of this.particles) { ctx.globalAlpha = Math.max(0, q.life * 2); ctx.fillStyle = q.c; ctx.fillRect(q.x - 2, q.y - 2, 4, 4); }
    ctx.globalAlpha = 1;
    ctx.restore();

    // HUD
    ctx.fillStyle = "rgba(0,0,0,.25)";
    roundRect(ctx, 16, 56, W - 32, 40, 20); ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.font = "700 15px Unbounded, sans-serif";
    ctx.textBaseline = "middle";
    ctx.fillText("★ " + this.score, 32, 76);
    ctx.textAlign = "right";
    ctx.font = "500 12px Onest, sans-serif";
    ctx.fillStyle = "rgba(255,255,255,.8)";
    ctx.fillText("рекорд " + this.best, W - 32, 76);
    ctx.textAlign = "left";

    ctx.textAlign = "center";
    ctx.font = "800 26px Unbounded, sans-serif";
    ctx.fillStyle = "#ffd23f";
    ctx.fillText("ЗУБА-РУБА", W / 2, 132);
    if (performance.now() > this.manualUntil) {
      ctx.font = "500 13px Onest, sans-serif";
      ctx.fillStyle = "rgba(255,255,255," + (0.55 + Math.sin(this.t * 4) * 0.35) + ")";
      ctx.fillText("нажмите, чтобы прыгнуть", W / 2, 500);
    }
    ctx.textAlign = "left";
  };

  MiniGame.prototype.frame = function (now) {
    if (!this.visible) { this.running = false; return; }
    const dt = Math.min(0.033, (now - (this.last || now)) / 1000);
    this.last = now;
    this.update(dt, now);
    this.render();
    requestAnimationFrame(this.frame);
  };

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }
  function star(ctx, x, y, n, R, r) {
    ctx.beginPath();
    for (let i = 0; i < n * 2; i++) {
      const rad = i % 2 ? r : R, a = (i * Math.PI) / n - Math.PI / 2;
      ctx.lineTo(x + Math.cos(a) * rad, y + Math.sin(a) * rad);
    }
    ctx.closePath();
  }

  window.MiniGame = MiniGame;
})();
