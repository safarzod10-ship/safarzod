// DOM overlay on top of the Phaser canvas: crisp, phone-readable text for the stream.
import type { Level, PublicState } from '../../shared/types.js';
import { getLevel, LEVEL_COUNT } from '../../shared/levels/campaign.js';
import { hintFor } from '../../shared/engine.js';

const $ = <T extends HTMLElement = HTMLElement>(sel: string): T => document.querySelector(sel) as T;

function el(tag: string, cls?: string, text?: string): HTMLElement {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

const HEART = '<svg viewBox="0 0 24 22"><path d="M12 21s-9-5.6-9-12a5 5 0 0 1 9-3 5 5 0 0 1 9 3c0 6.4-9 12-9 12z"/></svg>';
const SHIELD = '<svg viewBox="0 0 24 24"><path d="M12 2l8 3v6c0 5-3.5 9.5-8 11-4.5-1.5-8-6-8-11V5z"/></svg>';

export class Hud {
  private cache = new Map<string, string>();
  private noticeSeen = new Set<number>();
  private exhibitUrl: (lvl: Level) => string;
  private lastPhaseKey = '';

  constructor(exhibitUrl: (lvl: Level) => string) {
    this.exhibitUrl = exhibitUrl;
  }

  private set(id: string, html: string): void {
    if (this.cache.get(id) === html) return;
    this.cache.set(id, html);
    $(id).innerHTML = html;
  }
  private text(id: string, t: string): void {
    if (this.cache.get(id) === t) return;
    this.cache.set(id, t);
    $(id).textContent = t;
  }
  private show(id: string, on: boolean): void {
    $(id).classList.toggle('hidden', !on);
  }

  render(s: PublicState, now: number, connected: boolean): void {
    const lvl = getLevel(s.level);
    // ---- top bar
    this.text('#lvl-num', `LEVEL ${s.level}/${LEVEL_COUNT}`);
    this.text('#lvl-title', lvl.title);
    const beat = lvl.beats[Math.min(s.beatIndex, lvl.beats.length - 1)]!;
    const phases = ['infiltrate', 'steal', 'escape'] as const;
    const curPhase = s.phase === 'levelComplete' || s.phase === 'campaignComplete' ? 'done' : beat.phase;
    const track = phases
      .map((p) => {
        const beats = lvl.beats.map((b, i) => ({ b, i })).filter((x) => x.b.phase === p);
        const dots = beats
          .map(({ i }) => `<i class="dot ${i < s.beatIndex || curPhase === 'done' ? 'done' : i === s.beatIndex ? 'now' : ''}"></i>`)
          .join('');
        return `<div class="ph ${p === curPhase ? 'on' : ''}"><b>${p.toUpperCase()}</b><span>${dots}</span></div>`;
      })
      .join('<em>›</em>');
    this.set('#track', track);
    const hearts = Array.from({ length: s.run.maxHp }, (_, i) => `<span class="heart ${i < s.run.hp ? '' : 'lost'}">${HEART}</span>`).join('');
    this.set('#hearts', hearts + (s.shield ? `<span class="shield">${SHIELD}</span>` : ''));
    const alert = Array.from({ length: 3 }, (_, i) => `<i class="${i < s.run.alarm ? 'on' : ''}"></i>`).join('');
    this.set('#alert', `<b>ALERT</b>${alert}`);
    this.text('#stats', `TRY #${s.attempt} · HEISTS ${s.heists}${s.cycle > 1 ? ` · CYCLE ${s.cycle}` : ''}`);
    const inv = [s.run.items.includes('keycard') ? '<span class="inv">KEYCARD</span>' : '', s.run.items.includes('decoy') ? '<span class="inv">DECOY</span>' : '', s.run.flags.includes('powerCut') && beat.phase !== 'escape' ? '<span class="inv dark">POWER OFF</span>' : '', s.run.carrying ? '<span class="inv gold">LOOT</span>' : ''].join('');
    this.set('#inv', inv);

    // ---- auto mode / connection / pause
    this.show('#auto', s.autoMode);
    this.set('#auto', `AUTO MODE<small>${escapeHtml(s.autoReason)}</small>`);
    this.show('#conn', !connected);
    this.show('#paused', s.paused);

    // ---- hint
    const voting = s.phase === 'vote' && !!s.vote;
    const blackout = voting && s.vote!.chaos?.kind === 'blackout' && now < s.vote!.chaos.until;
    this.show('#hint', voting);
    if (voting) {
      this.text('#hint-text', blackout ? 'BLACKOUT! The hint is dark... read the room!' : hintFor(beat, s.run));
      $('#hint').classList.toggle('dark', blackout);
    }

    // ---- vote panel
    this.show('#vote', voting);
    if (voting) this.renderVote(s, lvl, now);

    // ---- resolution banner
    const res = s.phase === 'resolve' && s.resolution ? s.resolution : null;
    this.show('#result', !!res);
    if (res) {
      const opt = lvl.beats[res.beatIndex]!.options.find((o) => o.id === res.optionId)!;
      const who = res.mode === 'chat' ? `CHAT CHOSE #${res.number}` : res.mode === 'tie' ? `TIE! COIN FLIP PICKED #${res.number}` : `AUTO MODE PICKED #${res.number}`;
      this.set('#result', `<div class="who">${who}</div><div class="what">${escapeHtml(opt.label)}</div><div class="out ${res.outcome.ok ? 'ok' : 'bad'}">${escapeHtml(res.outcome.text)}</div>`);
      $('#result').classList.toggle('late', now - res.startedAt > 2600);
    }

    // ---- center cards
    const key = `${s.phase}-${s.level}-${s.attempt}-${s.cycle}`;
    if (key !== this.lastPhaseKey) {
      this.lastPhaseKey = key;
      this.renderCard(s, lvl);
    }
    if (s.phase === 'defeat') {
      const left = Math.max(0, Math.ceil((s.phaseEndsAt - now) / 1000));
      this.text('#card-timer', s.reviveUsed ? `Retrying level in ${left}s` : `REVIVE window ${left}s · then retry`);
    } else if (s.phase === 'intro') {
      const left = Math.max(0, Math.ceil((s.phaseEndsAt - now) / 1000));
      this.text('#card-timer', `Starting in ${left}s`);
    } else this.text('#card-timer', '');

    // ---- notices & queue
    this.renderNotices(s, now);
    const q = s.queue.slice(0, 3).map((x) => `<span>${x.type}${x.test ? ' (TEST)' : ''} · ${escapeHtml(x.wait)}</span>`).join('');
    this.set('#queue', q ? `<b>QUEUED</b>${q}` : '');
    this.show('#queue', !!q);
  }

  private renderVote(s: PublicState, lvl: Level, now: number): void {
    const v = s.vote!;
    const beat = lvl.beats[v.beatIndex]!;
    const n = v.order.length;
    const left = Math.max(0, v.endsAt - now);
    const secs = Math.ceil(left / 1000);
    this.text('#vote-cta', `TYPE ${v.order.map((_, i) => i + 1).join(', ').replace(/, (\d)$/, ' OR $1')} IN CHAT`);
    this.text('#vote-secs', String(secs));
    const ring = $('#ring-fg') as unknown as SVGCircleElement;
    const total = v.endsAt - v.openedAt;
    ring.style.strokeDashoffset = String(176 * (1 - left / Math.max(1, total)));
    $('#vote-timer').classList.toggle('urgent', secs <= 5);
    const max = Math.max(1, ...Object.values(v.tally.counts));
    const remembered = s.memory[v.beatIndex] ?? [];
    const cards = v.order
      .map((id, i) => {
        const opt = beat.options.find((o) => o.id === id)!;
        const count = v.tally.counts[id] ?? 0;
        const scan = v.scan?.info[id];
        const scanHtml = scan ? `<span class="scan ${scan.damage > 0 ? 'bad' : scan.ok ? 'ok' : 'warn'}">${scan.note}</span>` : '';
        const mem = remembered.includes(id) ? '<span class="mem">FAILED BEFORE</span>' : '';
        return `<div class="opt" style="--w:${(count / max) * 100}%"><div class="num">${i + 1}</div><div class="lbl">${escapeHtml(opt.label)}${scanHtml}${mem}</div><div class="cnt">${count}</div><div class="bar"></div></div>`;
      })
      .join('');
    this.set('#opts', cards);
    $('#opts').style.setProperty('--n', String(n));
    const recent = v.recent.map((r) => `<span>${escapeHtml(r.name)} → ${r.n}</span>`).join('');
    this.set('#recent', v.tally.voters ? `${v.tally.voters} VOTER${v.tally.voters === 1 ? '' : 'S'} ${recent}` : 'NO VOTES YET · IF NOBODY VOTES, AUTO MODE PICKS');
    const chaos = v.chaos && now < v.chaos.until ? `CHAOS: ${v.chaos.kind.toUpperCase()} by ${escapeHtml(v.chaos.by)}` : '';
    const scanBy = v.scan ? `SCAN by ${escapeHtml(v.scan.by)}` : '';
    const rev = v.revoted ? 'REVOTE!' : '';
    this.set('#vote-tags', [chaos, scanBy, rev].filter(Boolean).map((t) => `<span>${t}</span>`).join(''));
  }

  private renderCard(s: PublicState, lvl: Level): void {
    const card = $('#card');
    let html = '';
    if (s.phase === 'intro') {
      html = `<div class="kicker">${escapeHtml(lvl.wing.toUpperCase())}${s.attempt > 1 ? ` · ATTEMPT ${s.attempt}` : ''}</div>
        <div class="title">LEVEL ${s.level}: ${escapeHtml(lvl.title)}</div>
        <img class="ex" src="${this.exhibitUrl(lvl)}" alt="">
        <div class="sub">Target: <b>${escapeHtml(lvl.exhibit.name)}</b></div>
        <div class="brief">${escapeHtml(lvl.briefing)} · ${lvl.beats.length} decisions</div>
        <div class="how">Vote by typing the option NUMBER in chat. One vote per viewer, you can change it.</div>`;
    } else if (s.phase === 'levelComplete') {
      html = `<div class="kicker">HEIST COMPLETE</div><div class="title">${escapeHtml(lvl.exhibit.name)}</div>
        <img class="ex" src="${this.exhibitUrl(lvl)}" alt=""><div class="sub">Stolen on attempt ${s.attempt} · ${s.heists} heists total</div>
        <div class="brief">${s.level < LEVEL_COUNT ? `Next: Level ${s.level + 1} - ${escapeHtml(getLevel(s.level + 1).title)}` : 'The final vault is next... the whole museum!'}</div>`;
    } else if (s.phase === 'defeat') {
      html = `<div class="kicker bad">KNOCKED OUT</div><div class="title">The robot needs a reboot</div>
        <div class="sub">Level ${s.level} restarts. Completed levels stay saved.</div>`;
    } else if (s.phase === 'campaignComplete') {
      html = `<div class="kicker">CAMPAIGN COMPLETE</div><div class="title">All 30 treasures stolen!</div>
        <div class="sub">${s.heists} heists so far. A new cycle begins - the museum upgraded its security.</div>`;
    }
    card.innerHTML = html ? `${html}<div class="timer" id="card-timer"></div>` : '<div id="card-timer"></div>';
    this.cache.delete('#card-timer');
    card.classList.toggle('hidden', !html);
    card.classList.toggle('defeat', s.phase === 'defeat');
  }

  private renderNotices(s: PublicState, now: number): void {
    const box = $('#notices');
    for (const n of [...s.notices].reverse()) {
      if (this.noticeSeen.has(n.id)) continue;
      this.noticeSeen.add(n.id);
      if (now - n.at > 20000) continue;
      const t = el('div', `notice ${n.kind}${n.test ? ' test' : ''}`, n.text);
      box.prepend(t);
      setTimeout(() => t.classList.add('out'), 7000);
      setTimeout(() => t.remove(), 7800);
      while (box.children.length > 4) box.lastElementChild?.remove();
    }
  }
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
