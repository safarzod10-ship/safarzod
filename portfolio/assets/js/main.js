/* =========================================================
   Bob Proger — interactions & motion
   GSAP 3 + ScrollTrigger + SplitText + Lenis
   ========================================================= */
(function () {
  "use strict";

  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));

  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  const hasGSAP = typeof window.gsap !== "undefined";

  // Year / clock are useful even without animation libraries
  $$("[data-year]").forEach((el) => (el.textContent = new Date().getFullYear()));
  const clock = $("[data-clock]");
  const tick = () => { if (clock) clock.textContent = new Date().toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" }); };
  tick(); setInterval(tick, 10000);

  renderReviews();

  if (!hasGSAP) { document.body.classList.remove("is-loading"); $(".loader") && $(".loader").remove(); return; }

  gsap.registerPlugin(ScrollTrigger, SplitText, CustomEase);
  CustomEase.create("expo", "0.16, 1, 0.3, 1");
  CustomEase.create("inout", "0.76, 0, 0.24, 1");

  /* ---------------------------------------------------------
     Smooth scroll
     --------------------------------------------------------- */
  let lenis = null;
  if (!reduce && typeof window.Lenis !== "undefined") {
    lenis = new Lenis({ lerp: 0.09, wheelMultiplier: 1, smoothWheel: true });
    lenis.on("scroll", ScrollTrigger.update);
    gsap.ticker.add((t) => lenis.raf(t * 1000));
    gsap.ticker.lagSmoothing(0);
    lenis.stop();
  }
  const scrollTo = (target) => {
    if (lenis) lenis.scrollTo(target, { duration: 1.6, easing: (t) => 1 - Math.pow(1 - t, 4) });
    else (typeof target === "number" ? window.scrollTo({ top: target }) : document.querySelector(target)?.scrollIntoView());
  };
  $$('a[href^="#"]').forEach((a) => a.addEventListener("click", (e) => {
    const id = a.getAttribute("href");
    if (id.length < 2 && id !== "#") return;
    e.preventDefault();
    closeMenu();
    scrollTo(id === "#top" || id === "#" ? 0 : id);
  }));

  /* ---------------------------------------------------------
     Hero WebGL
     --------------------------------------------------------- */
  let heroGL = null;
  const glCanvas = $(".hero__gl");
  if (glCanvas && window.HeroGL) {
    heroGL = new HeroGL(glCanvas);
    if (heroGL.ok) {
      if (reduce) { heroGL.intro = 1; heroGL.draw(); }
      else heroGL.start();
    }
  }

  /* ---------------------------------------------------------
     Split hero title into masked characters
     --------------------------------------------------------- */
  const heroChars = [];
  $$(".hero__row").forEach((row) => {
    const text = row.textContent;
    row.textContent = "";
    for (const ch of text) {
      const mask = document.createElement("span");
      mask.className = "char-mask";
      const c = document.createElement("span");
      c.className = "char";
      c.textContent = ch;
      mask.appendChild(c);
      row.appendChild(mask);
      heroChars.push(c);
    }
  });

  /* ---------------------------------------------------------
     Fit big type to its container (keeps CSS size as maximum)
     --------------------------------------------------------- */
  function fitWords(el) {
    el.style.fontSize = "";
    const max = parseFloat(getComputedStyle(el).fontSize);
    const avail = el.clientWidth - parseFloat(getComputedStyle(el).paddingLeft) - parseFloat(getComputedStyle(el).paddingRight);
    el.style.fontSize = "100px";
    const probe = document.createElement("span");
    probe.style.cssText = "position:absolute;visibility:hidden;white-space:nowrap;left:0;top:0";
    el.appendChild(probe);
    let w = 0;
    el.textContent.trim().split(/\s+/).forEach((word) => { probe.textContent = word; w = Math.max(w, probe.getBoundingClientRect().width); });
    probe.remove();
    el.style.fontSize = Math.min(max, (100 * avail) / Math.max(1, w) * 0.97) + "px";
  }
  // stacked = children are on separate lines (fit the widest); otherwise they sit in one row (fit the sum)
  function fitChildren(el, stacked) {
    el.style.fontSize = "";
    const cs = getComputedStyle(el);
    const max = parseFloat(cs.fontSize);
    const avail = el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    el.style.fontSize = "100px";
    const kids = Array.from(el.children);
    const widths = kids.map((k) => { k.style.width = "max-content"; const w = k.getBoundingClientRect().width; k.style.width = ""; return w; });
    const gap = parseFloat(getComputedStyle(el).columnGap) || 0;
    const need = stacked ? Math.max(...widths) : widths.reduce((a, b) => a + b, 0) + gap * (kids.length - 1);
    el.style.fontSize = Math.min(max, (100 * avail) / Math.max(1, need) * 0.985) + "px";
  }
  function fitAll() {
    $$(".work__name").forEach(fitWords);
    const giant = $(".footer__giant");
    if (giant) fitChildren(giant, window.innerWidth <= 700);
    const ht = $(".hero__title");
    if (ht) fitChildren(ht, true);
  }
  fitAll();
  document.fonts && document.fonts.ready.then(() => { fitAll(); ScrollTrigger.refresh(); });
  let fitRaf;
  window.addEventListener("resize", () => { cancelAnimationFrame(fitRaf); fitRaf = requestAnimationFrame(fitAll); });

  /* ---------------------------------------------------------
     Preloader → hero intro
     --------------------------------------------------------- */
  const loader = $(".loader");
  let visited = false;
  try { visited = sessionStorage.getItem("bp_visited") === "1"; sessionStorage.setItem("bp_visited", "1"); } catch (e) { /* storage blocked */ }

  function heroIntro(delay = 0) {
    const tl = gsap.timeline({ delay, defaults: { ease: "expo" } });
    if (heroGL && heroGL.ok) tl.to(heroGL, { intro: 1, duration: 2.4, ease: "power2.out" }, 0);
    tl.from(heroChars, { yPercent: 115, rotateX: -80, duration: 1.4, stagger: { each: 0.05, from: "start" } }, 0.1)
      .from(".hero__top > *", { y: 24, autoAlpha: 0, duration: 1.1, stagger: 0.1 }, 0.5)
      .from(".hero__lead", { y: 30, autoAlpha: 0, duration: 1.1 }, 0.7)
      .from(".hero__scroll", { scale: 0, rotate: -120, duration: 1.4 }, 0.8)
      .from(".nav > *", { y: -30, autoAlpha: 0, duration: 1, stagger: 0.06 }, 0.6);
    return tl;
  }

  function finishLoading() {
    document.body.classList.remove("is-loading");
    if (lenis) lenis.start();
    ScrollTrigger.refresh();
  }

  if (reduce || !loader) {
    loader && loader.remove();
    if (heroGL && heroGL.ok) heroGL.intro = 1;
    finishLoading();
  } else {
    const num = $(".loader__num");
    const counter = { v: 0 };
    const logItems = $$(".loader__log li");
    const total = visited ? 1.1 : 2.6;
    const tl = gsap.timeline({ onComplete: () => loader.remove() });
    tl.to(counter, {
        v: 100, duration: total, ease: "power2.inOut",
        onUpdate: () => { num.textContent = Math.round(counter.v); },
      }, 0)
      .to(".loader__bar i", { scaleX: 1, duration: total, ease: "power2.inOut" }, 0)
      .to(logItems, { autoAlpha: 1, y: 0, duration: 0.3, stagger: total / logItems.length * 0.92, ease: "power2.out" }, 0)
      .to(".loader__inner", { yPercent: -8, autoAlpha: 0, duration: 0.6, ease: "power3.in" }, total + 0.1)
      .to(".loader__cols span", {
        yPercent: -100, duration: 1.1, ease: "inout",
        stagger: { each: 0.07, from: "center" },
      }, total + 0.45)
      .add(() => finishLoading(), total + 0.7)
      .add(heroIntro(), total + 0.65);
  }

  /* ---------------------------------------------------------
     Hero: variable-weight letters react to the cursor
     --------------------------------------------------------- */
  if (finePointer && !reduce) {
    const mouse = { x: -9999, y: -9999 };
    window.addEventListener("pointermove", (e) => { mouse.x = e.clientX; mouse.y = e.clientY; }, { passive: true });
    const weights = heroChars.map(() => ({ w: 800 }));
    const hero = $(".hero");
    let heroVisible = true;
    ScrollTrigger.create({ trigger: hero, start: "top bottom", end: "bottom top", onToggle: (s) => (heroVisible = s.isActive) });
    gsap.ticker.add(() => {
      if (!heroVisible) return;
      heroChars.forEach((c, i) => {
        const r = c.getBoundingClientRect();
        const dx = mouse.x - (r.left + r.width / 2);
        const dy = mouse.y - (r.top + r.height / 2);
        const d = Math.sqrt(dx * dx + dy * dy);
        const k = Math.max(0, 1 - d / 420);
        const target = 800 - 600 * k * k;
        weights[i].w += (target - weights[i].w) * 0.12;
        c.style.fontVariationSettings = `"wght" ${weights[i].w.toFixed(1)}`;
        c.style.fontWeight = Math.round(weights[i].w);
      });
    });
  }

  /* ---------------------------------------------------------
     Hero: rotating word
     --------------------------------------------------------- */
  const words = $$(".rotator__word");
  if (words.length > 1) {
    let idx = 0;
    const rot = $(".rotator");
    // hand transforms over to GSAP so CSS translate and yPercent don't stack
    words.forEach((w, i) => gsap.set(w, { y: 0, yPercent: i === 0 ? 0 : 110 }));
    const sizeTo = (w) => { rot.style.width = w.offsetWidth + "px"; };
    const fit = () => sizeTo(words[idx]);
    document.fonts && document.fonts.ready.then(fit);
    window.addEventListener("resize", fit);
    fit();
    if (!reduce) {
      setInterval(() => {
        const cur = words[idx];
        idx = (idx + 1) % words.length;
        const next = words[idx];
        gsap.to(cur, { yPercent: -110, duration: 0.8, ease: "expo", onComplete: () => cur.classList.remove("is-active") });
        gsap.fromTo(next, { yPercent: 110 }, { yPercent: 0, duration: 0.8, ease: "expo", onStart: () => next.classList.add("is-active") });
        gsap.to(rot, { width: next.offsetWidth, duration: 0.8, ease: "expo" });
      }, 2400);
    }
  }

  /* ---------------------------------------------------------
     Hero: parallax out on scroll
     --------------------------------------------------------- */
  if (!reduce) {
    gsap.timeline({ scrollTrigger: { trigger: ".hero", start: "top top", end: "bottom top", scrub: true } })
      .to(".hero__row--1", { xPercent: -18, ease: "none" }, 0)
      .to(".hero__row--2", { xPercent: 12, ease: "none" }, 0)
      .to(".hero__title", { yPercent: 30, ease: "none" }, 0)
      .to(".hero__bottom, .hero__top", { y: -80, autoAlpha: 0, ease: "none" }, 0)
      .to(heroGL || {}, { scroll: 1, ease: "none" }, 0);
  }

  /* ---------------------------------------------------------
     Section titles: line reveal
     --------------------------------------------------------- */
  document.fonts && document.fonts.ready.then(() => {
    $$("[data-split]").forEach((el) => {
      if (reduce) return;
      const split = SplitText.create(el, { type: "lines,chars", linesClass: "line", mask: "lines" });
      gsap.from(split.chars, {
        yPercent: 110, rotate: 6, duration: 1.2, ease: "expo",
        stagger: 0.025,
        scrollTrigger: { trigger: el, start: "top 85%" },
      });
    });
    ScrollTrigger.refresh();
  });

  /* ---------------------------------------------------------
     Manifesto: words light up while scrolling
     --------------------------------------------------------- */
  const mText = $("[data-words]");
  if (mText && !reduce) {
    const split = SplitText.create(mText, { type: "words", wordsClass: "word" });
    gsap.to(split.words, {
      opacity: 1, ease: "none", stagger: 0.1,
      scrollTrigger: { trigger: mText, start: "top 78%", end: "bottom 45%", scrub: 0.6 },
    });
  }

  $$("[data-count]").forEach((el) => {
    const to = +el.dataset.count;
    if (reduce) { el.textContent = to; return; }
    const o = { v: 0 };
    gsap.to(o, {
      v: to, duration: 1.6, ease: "power3.out",
      onUpdate: () => (el.textContent = Math.round(o.v)),
      scrollTrigger: { trigger: el, start: "top 90%" },
    });
  });
  if (!reduce) {
    gsap.from(".fact", { y: 60, autoAlpha: 0, duration: 1.2, ease: "expo", stagger: 0.12, scrollTrigger: { trigger: ".manifesto__facts", start: "top 88%" } });
  }

  /* ---------------------------------------------------------
     Marquee: endless, speeds up & skews with scroll velocity
     --------------------------------------------------------- */
  const track = $(".marquee__track");
  if (track) {
    track.innerHTML += track.innerHTML; // duplicate for seamless loop
    let x = 0, dir = -1, skew = 0;
    const half = () => track.scrollWidth / 2;
    gsap.ticker.add((t, dtMs) => {
      const dt = Math.min(0.05, dtMs / 1000);
      const v = lenis ? lenis.velocity : 0;
      if (v !== 0) dir = v > 0 ? -1 : 1;
      const speed = reduce ? 0 : 70 + Math.min(900, Math.abs(v) * 40);
      x += dir * speed * dt;
      const h = half();
      if (x <= -h) x += h;
      if (x > 0) x -= h;
      skew += ((reduce ? 0 : gsap.utils.clamp(-12, 12, v * 0.6)) - skew) * 0.12;
      track.style.transform = `translate3d(${x}px,0,0) skewX(${skew}deg)`;
    });
  }

  /* ---------------------------------------------------------
     Works: stacking cards + background colour morph
     --------------------------------------------------------- */
  const works = $$(".work");
  const worksSection = $(".works");
  works.forEach((w, i) => w.style.setProperty("--i", i));

  // A sticky card taller than the screen would hide its bottom forever.
  // Give such cards a negative sticky top so they scroll fully into view first, then stick.
  function setStickyTops() {
    const vh = window.innerHeight;
    works.forEach((w, i) => {
      w.style.top = "";
      const base = parseFloat(getComputedStyle(w).top) || 0;
      const h = $(".work__card", w).offsetHeight;
      const fitTop = vh - h - 16 + i * 10;
      if (fitTop < base) w.style.top = fitTop + "px";
    });
  }
  setStickyTops();
  window.addEventListener("resize", setStickyTops);
  document.fonts && document.fonts.ready.then(setStickyTops);

  function shade(hex, amount) {
    // mix colour with deep ink; amount 0..1 (1 = full ink)
    const n = parseInt(hex.slice(1), 16);
    const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    const ir = 10, ig = 10, ib = 14;
    const m = (a, c) => Math.round(a + (c - a) * amount);
    return `rgb(${m(r, ir)},${m(g, ig)},${m(b, ib)})`;
  }

  if (worksSection) {
    const setBg = (bg, ink) => gsap.to(worksSection, { "--works-bg": bg, "--works-ink": ink, duration: 0.9, ease: "power2.out", overwrite: "auto" });
    works.forEach((w, i) => {
      const c = w.dataset.color;
      ScrollTrigger.create({
        trigger: w, start: "top 60%", end: "bottom 40%",
        onEnter: () => setBg(shade(c, 0.78), "#e9e9e6"),
        onEnterBack: () => setBg(shade(c, 0.78), "#e9e9e6"),
        onLeaveBack: () => { if (i === 0) setBg("#e9e9e6", "#111216"); },
      });
    });

    if (!reduce) {
      works.forEach((w, i) => {
        const card = $(".work__card", w);
        // entrance: card tilts up into place
        gsap.fromTo(card, { rotateX: 18, yPercent: 12, scale: 0.92 }, {
          rotateX: 0, yPercent: 0, scale: 1, ease: "none",
          scrollTrigger: { trigger: w, start: "top bottom", end: "top 30%", scrub: true },
        });
        // stacked: shrink and dim as the following cards pile on top
        if (i < works.length - 1) {
          const remaining = works.length - 1 - i;
          gsap.to(card, {
            scale: 1 - remaining * 0.035, "--dim": 0.35 + remaining * 0.06, ease: "none",
            scrollTrigger: { trigger: works[i + 1], start: "top bottom", end: "top 20%", scrub: true },
          });
        }
        // info parallax
        gsap.from($(".work__name", w), {
          yPercent: 60, autoAlpha: 0, duration: 1.2, ease: "expo",
          scrollTrigger: { trigger: w, start: "top 65%" },
        });
      });
    }
  }

  /* ---------- Кислород: laser removes the tattoo ---------- */
  const kis = $(".kislorod__skin");
  if (kis) {
    const tattoo = $(".kislorod__tattoo", kis);
    const laser = $(".kislorod__laser", kis);
    const bubbles = $$(".kislorod__bubbles i", kis);
    bubbles.forEach((b, i) => {
      gsap.set(b, { left: 12 + i * 14 + "%" });
      if (!reduce) gsap.to(b, { y: -260, x: "random(-20,20)", scale: "random(.6,1.6)", opacity: 0, duration: "random(3,5)", repeat: -1, delay: i * 0.6, ease: "none" });
    });
    if (!reduce) {
      const sweep = { p: 0 };
      const tl = gsap.timeline({ repeat: -1, repeatDelay: 0.6, paused: true });
      tl.set(sweep, { p: 0 })
        .set(tattoo, { opacity: 1 })
        .fromTo(laser, { left: "-5%", opacity: 0 }, { opacity: 1, duration: 0.3 })
        .to(sweep, {
          p: 105, duration: 2.6, ease: "power1.inOut",
          onUpdate: () => {
            laser.style.left = sweep.p + "%";
            tattoo.style.clipPath = `inset(0 0 0 ${sweep.p}%)`;
          },
        }, "<")
        .to(laser, { opacity: 0, duration: 0.3 })
        .to({}, { duration: 1 })
        .set(tattoo, { clipPath: "inset(0 0 0 0%)", opacity: 0 })
        .to(tattoo, { opacity: 1, duration: 0.8 });
      ScrollTrigger.create({ trigger: kis, start: "top bottom", end: "bottom top", onToggle: (s) => (s.isActive ? tl.play() : tl.pause()) });
    }
  }

  /* ---------- Telegram chats: messages appear one by one ---------- */
  $$("[data-chat]").forEach((chat) => {
    const items = Array.from(chat.children);
    if (reduce) return;
    const typing = items.find((m) => m.classList.contains("msg--typing"));
    const tl = gsap.timeline({ repeat: -1, repeatDelay: 2.4, paused: true });
    // hidden messages take no space, so new ones push the chat up like in Telegram
    tl.set(items, { autoAlpha: 0, y: 16, scale: 0.92, display: "none" });
    items.forEach((m) => {
      const me = m.classList.contains("msg--me");
      const origin = me ? "100% 100%" : "0% 100%";
      if (m === typing) {
        tl.set(m, { display: "" }, "+=0.3")
          .to(m, { autoAlpha: 1, y: 0, scale: 1, duration: 0.35, ease: "back.out(2)", transformOrigin: origin })
          .set(m, { display: "none", autoAlpha: 0 }, "+=1.1");
      } else {
        tl.set(m, { display: "" }, me ? "+=0.9" : "+=0.35")
          .to(m, { autoAlpha: 1, y: 0, scale: 1, duration: 0.5, ease: "back.out(1.8)", transformOrigin: origin });
      }
    });
    tl.to(items, { autoAlpha: 0, y: -10, duration: 0.4, stagger: 0.03, ease: "power2.in" }, "+=2.4");
    ScrollTrigger.create({ trigger: chat, start: "top bottom", end: "bottom top", onToggle: (s) => (s.isActive ? tl.play() : tl.pause()) });
  });

  /* ---------- Garnet seeds float ---------- */
  if (!reduce) {
    $$(".seeds i").forEach((s, i) => {
      gsap.to(s, { y: "random(-24,24)", rotate: "+=random(-30,30)", duration: "random(2.5,4.5)", repeat: -1, yoyo: true, ease: "sine.inOut", delay: i * 0.2 });
    });
    $$(".work").forEach((w) => {
      const vis = $(".work__visual", w);
      const inner = vis && vis.firstElementChild;
      if (!inner || !finePointer) return;
      vis.addEventListener("pointermove", (e) => {
        const r = vis.getBoundingClientRect();
        const px = (e.clientX - r.left) / r.width - 0.5;
        const py = (e.clientY - r.top) / r.height - 0.5;
        gsap.to(inner, { rotateY: px * 16 - (inner.classList.contains("mock-browser") ? 14 : 0), rotateX: -py * 12 + (inner.classList.contains("mock-browser") ? 6 : 0), duration: 0.8, ease: "power3.out", transformPerspective: 1000 });
      });
      vis.addEventListener("pointerleave", () => {
        gsap.to(inner, { rotateY: inner.classList.contains("mock-browser") ? -14 : 0, rotateX: inner.classList.contains("mock-browser") ? 6 : 0, duration: 1.2, ease: "expo" });
      });
    });
  }

  /* ---------- First VPN: power button demo ---------- */
  const app = $(".vpnapp");
  if (app) {
    const btn = $(".vpnapp__power", app), status = $(".vpnapp__status", app), timer = $(".vpnapp__timer", app);
    const dl = $("[data-dl]", app), ul = $("[data-ul]", app);
    let on = false, since = 0, autoTimer = null, manual = false;
    const set = (v) => {
      on = v;
      app.classList.toggle("is-on", on);
      status.textContent = on ? "Подключено" : "Отключено";
      since = performance.now();
      gsap.fromTo(btn, { scale: 0.9 }, { scale: 1, duration: 0.8, ease: "elastic.out(1,.4)" });
    };
    btn.addEventListener("click", () => { manual = true; set(!on); });
    setInterval(() => {
      if (on) {
        const s = Math.floor((performance.now() - since) / 1000);
        const hh = String(Math.floor(s / 3600)).padStart(2, "0"), mm = String(Math.floor(s / 60) % 60).padStart(2, "0"), ss = String(s % 60).padStart(2, "0");
        timer.textContent = `${hh}:${mm}:${ss}`;
        dl.textContent = (80 + Math.random() * 60).toFixed(1);
        ul.textContent = (30 + Math.random() * 30).toFixed(1);
      } else {
        timer.textContent = "00:00:00"; dl.textContent = "0.0"; ul.textContent = "0.0";
      }
    }, 500);
    ScrollTrigger.create({
      trigger: app, start: "top 70%", end: "bottom top",
      onEnter: () => { if (!manual) autoTimer = setTimeout(() => set(true), 900); },
      onLeave: () => clearTimeout(autoTimer),
    });
  }

  /* ---------- Зуба-Руба mini game ---------- */
  const gameCanvas = $(".game");
  if (gameCanvas && window.MiniGame) new MiniGame(gameCanvas);

  /* ---------------------------------------------------------
     Services: animated accordion
     --------------------------------------------------------- */
  $$(".service").forEach((d) => {
    const summary = $("summary", d);
    const body = $(".service__body", d);
    summary.addEventListener("click", (e) => {
      e.preventDefault();
      if (d.open) {
        gsap.to(body, { height: 0, autoAlpha: 0, duration: 0.6, ease: "inout", onComplete: () => { d.open = false; gsap.set(body, { clearProps: "all" }); ScrollTrigger.refresh(); } });
      } else {
        d.open = true;
        gsap.fromTo(body, { height: 0, autoAlpha: 0 }, { height: "auto", autoAlpha: 1, duration: 0.8, ease: "expo", onComplete: () => ScrollTrigger.refresh() });
        gsap.from($$("li", body), { x: -20, autoAlpha: 0, stagger: 0.06, duration: 0.6, ease: "expo", delay: 0.15 });
      }
    });
  });
  if (!reduce) {
    gsap.from(".service", { y: 50, autoAlpha: 0, duration: 1.1, ease: "expo", stagger: 0.1, scrollTrigger: { trigger: ".services__list", start: "top 85%" } });
  }

  /* ---------------------------------------------------------
     Process: horizontal scroll on desktop
     --------------------------------------------------------- */
  const mm = gsap.matchMedia();
  mm.add("(min-width: 861px) and (prefers-reduced-motion: no-preference)", () => {
    const pTrack = $(".process__track");
    const dist = () => pTrack.scrollWidth - window.innerWidth;
    const tw = gsap.to(pTrack, {
      x: () => -dist(), ease: "none",
      scrollTrigger: {
        trigger: ".process", start: "top top", end: () => "+=" + dist(),
        pin: ".process__pin", scrub: 0.8, invalidateOnRefresh: true, anticipatePin: 1,
        onUpdate: (s) => gsap.set(".process__progress i", { scaleX: s.progress }),
      },
    });
    $$(".step").forEach((s) => {
      gsap.from(s.querySelector(".step__num"), {
        yPercent: 60, autoAlpha: 0, ease: "expo", duration: 1,
        scrollTrigger: { trigger: s, containerAnimation: tw, start: "left 85%" },
      });
    });
  });
  mm.add("(max-width: 860px) and (prefers-reduced-motion: no-preference)", () => {
    $$(".step").forEach((s) => gsap.from(s, { y: 60, autoAlpha: 0, duration: 1, ease: "expo", scrollTrigger: { trigger: s, start: "top 88%" } }));
  });

  /* ---------------------------------------------------------
     Reviews CTA: light follows cursor
     --------------------------------------------------------- */
  const cta = $(".reviews__cta");
  if (cta) {
    cta.addEventListener("pointermove", (e) => {
      const r = cta.getBoundingClientRect();
      cta.style.setProperty("--mx", e.clientX - r.left + "px");
      cta.style.setProperty("--my", e.clientY - r.top + "px");
    });
    if (!reduce) gsap.from(cta, { y: 80, autoAlpha: 0, duration: 1.2, ease: "expo", scrollTrigger: { trigger: cta, start: "top 90%" } });
  }

  /* ---------------------------------------------------------
     Footer curtain: giant name rises
     --------------------------------------------------------- */
  if (!reduce) {
    gsap.timeline({ scrollTrigger: { trigger: ".footer-wrap", start: "top bottom", end: "bottom bottom", scrub: true } })
      .from(".footer__giant span", { yPercent: 70, ease: "none", stagger: 0.1 }, 0)
      .from(".footer__top", { y: -120, ease: "none" }, 0)
      .from(".footer__btn", { rotate: -40, scale: 0.6, ease: "none" }, 0);
  }

  /* ---------------------------------------------------------
     Nav: hide on scroll down, show on scroll up
     --------------------------------------------------------- */
  const nav = $(".nav");
  let lastY = 0;
  const onScrollNav = (y) => {
    if (document.body.classList.contains("menu-open")) return;
    if (y < 200) nav.classList.remove("is-hidden");
    else if (y > lastY + 4) nav.classList.add("is-hidden");
    else if (y < lastY - 4) nav.classList.remove("is-hidden");
    lastY = y;
  };
  window.addEventListener("scroll", () => onScrollNav(window.scrollY), { passive: true });
  nav.addEventListener("focusin", () => nav.classList.remove("is-hidden"));

  /* ---------------------------------------------------------
     Mobile menu
     --------------------------------------------------------- */
  const burger = $(".nav__burger");
  const menu = $(".menu");
  function closeMenu() {
    if (!document.body.classList.contains("menu-open")) return;
    document.body.classList.remove("menu-open");
    burger.setAttribute("aria-expanded", "false");
    menu.setAttribute("aria-hidden", "true");
    lenis && lenis.start();
  }
  burger && burger.addEventListener("click", () => {
    const open = !document.body.classList.contains("menu-open");
    if (!open) return closeMenu();
    document.body.classList.add("menu-open");
    burger.setAttribute("aria-expanded", "true");
    menu.setAttribute("aria-hidden", "false");
    lenis && lenis.stop();
    gsap.fromTo(".menu__links a", { yPercent: 100, autoAlpha: 0 }, { yPercent: 0, autoAlpha: 1, stagger: 0.06, duration: 0.9, ease: "expo", delay: 0.25 });
  });
  $$(".menu__links a").forEach((a) => a.addEventListener("click", closeMenu));

  /* ---------------------------------------------------------
     Custom cursor
     --------------------------------------------------------- */
  if (finePointer) {
    document.documentElement.classList.add("has-cursor");
    const cur = $(".cursor"), dot = $(".cursor-dot"), label = $(".cursor__label");
    gsap.set([cur, dot], { x: -100, y: -100 });
    const cx = gsap.quickTo(cur, "x", { duration: 0.55, ease: "power3" });
    const cy = gsap.quickTo(cur, "y", { duration: 0.55, ease: "power3" });
    const dx = gsap.quickTo(dot, "x", { duration: 0.12, ease: "power3" });
    const dy = gsap.quickTo(dot, "y", { duration: 0.12, ease: "power3" });
    window.addEventListener("pointermove", (e) => { cx(e.clientX); cy(e.clientY); dx(e.clientX); dy(e.clientY); }, { passive: true });
    window.addEventListener("pointerdown", () => cur.classList.add("is-down"));
    window.addEventListener("pointerup", () => cur.classList.remove("is-down"));
    document.addEventListener("pointerleave", () => { cur.classList.add("is-hidden"); dot.classList.add("is-hidden"); });
    document.addEventListener("pointerenter", () => { cur.classList.remove("is-hidden"); dot.classList.remove("is-hidden"); });

    document.addEventListener("pointerover", (e) => {
      const t = e.target.closest("[data-cursor], a, button, summary");
      if (!t) return;
      if (t.dataset.cursor) { label.textContent = t.dataset.cursor; cur.classList.add("is-hover"); }
      else cur.classList.add("is-link");
    });
    document.addEventListener("pointerout", (e) => {
      const t = e.target.closest("[data-cursor], a, button, summary");
      if (!t || (e.relatedTarget && t.contains(e.relatedTarget))) return;
      cur.classList.remove("is-hover", "is-link");
    });
  }

  /* ---------------------------------------------------------
     Magnetic elements
     --------------------------------------------------------- */
  if (finePointer && !reduce) {
    $$("[data-magnetic]").forEach((el) => {
      const strength = parseFloat(el.dataset.magneticStrength || "0.3");
      const xTo = gsap.quickTo(el, "x", { duration: 0.8, ease: "elastic.out(1,.4)" });
      const yTo = gsap.quickTo(el, "y", { duration: 0.8, ease: "elastic.out(1,.4)" });
      el.addEventListener("pointermove", (e) => {
        const r = el.getBoundingClientRect();
        xTo((e.clientX - (r.left + r.width / 2)) * strength);
        yTo((e.clientY - (r.top + r.height / 2)) * strength);
      });
      el.addEventListener("pointerleave", () => { xTo(0); yTo(0); });
    });
  }

  /* ---------------------------------------------------------
     Text scramble on hover
     --------------------------------------------------------- */
  const GLYPHS = "АБВГДЕЖЗИКЛМНОПРСТУФХЦЧШЭЮЯ0123456789#%&*<>/";
  $$("[data-scramble]").forEach((el) => {
    const original = el.textContent;
    let raf = null;
    el.addEventListener("pointerenter", () => {
      if (reduce) return;
      cancelAnimationFrame(raf);
      let frame = 0;
      const len = original.length;
      const run = () => {
        let out = "";
        for (let i = 0; i < len; i++) {
          if (original[i] === " ") { out += " "; continue; }
          out += i < frame / 2 ? original[i] : GLYPHS[(Math.random() * GLYPHS.length) | 0];
        }
        el.textContent = out;
        frame++;
        if (frame / 2 <= len) raf = requestAnimationFrame(run);
        else el.textContent = original;
      };
      run();
    });
  });

  window.addEventListener("load", () => ScrollTrigger.refresh());

  /* ---------------------------------------------------------
     Reviews renderer (data in reviews.js)
     --------------------------------------------------------- */
  function renderReviews() {
    const list = document.querySelector("[data-reviews]");
    const ctaLink = document.querySelector(".reviews__cta");
    if (ctaLink && window.REVIEWS_URL) ctaLink.href = window.REVIEWS_URL;
    if (!list || !Array.isArray(window.REVIEWS)) return;
    const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    list.innerHTML = window.REVIEWS.filter((r) => r && r.text).map((r) => `
      <figure class="review">
        <p>«${esc(r.text)}»</p>
        <footer><span class="review__ava">${esc((r.name || "?").trim().charAt(0).toUpperCase())}</span><span><b>${esc(r.name || "")}</b>${esc(r.role || "")}</span></footer>
      </figure>`).join("");
  }
})();
