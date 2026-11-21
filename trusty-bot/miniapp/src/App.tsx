import { useCallback, useEffect, useRef, useState, type ComponentType } from 'react';
import Coach, { tipsSeen } from './Coach';
import { Icon, type IconName } from './icons';
import { NavProvider, useNav, type Tab } from './nav';
import Admin, { ComplaintAdmin, MemberAdmin, MyComplaints, ProfileReview } from './screens/Admin';
import Chats, { ChatView } from './screens/Chats';
import Complaint from './screens/Complaint';
import DealView, { DealsList, Finance } from './screens/Deal';
import DevForm from './screens/DevForm';
import DevProfile from './screens/DevProfile';
import Devs from './screens/Devs';
import Guide from './screens/Guide';
import Home from './screens/Home';
import Onboarding from './screens/Onboarding';
import Portfolio from './screens/Portfolio';
import Pro from './screens/Pro';
import Profile from './screens/Profile';
import { BidForm, Choose, ProjectNew } from './screens/ProjectForms';
import Projects from './screens/Projects';
import ProjectView from './screens/ProjectView';
import { StoreProvider, useStore } from './store';
import { haptic, hideSplash, tg } from './tg';
import { Cell, Done, IconTile, MARK_LO, MARK_UP, MARK_WAVE, Sheet } from './ui';

const SCREENS: Record<string, ComponentType<any>> = {
  home: Home, devs: Devs, dev: DevProfile, projects: Projects, project: ProjectView, 'project-new': ProjectNew,
  bid: BidForm, choose: Choose, chats: Chats, chat: ChatView, profile: Profile, 'dev-form': DevForm,
  complaint: Complaint, guide: Guide, admin: Admin, 'complaint-admin': ComplaintAdmin, member: MemberAdmin,
  'my-complaints': MyComplaints, 'profile-review': ProfileReview, deal: DealView, deals: DealsList, finance: Finance,
  portfolio: Portfolio, pro: Pro,
};

type TabItem = { key: Tab; label: string; icon: IconName };
const tabsFor = (role: 'client' | 'dev'): TabItem[] => [
  { key: 'home', label: 'Главная', icon: 'home' },
  role === 'client' ? { key: 'devs', label: 'Исполнители', icon: 'search' } : { key: 'projects', label: 'Проекты', icon: 'projects' },
  { key: 'chats', label: 'Чаты', icon: 'chats' },
  { key: 'profile', label: 'Профиль', icon: 'profile' },
];

function Island() {
  const nav = useNav();
  const { chats, role } = useStore();
  const [menu, setMenu] = useState(false);
  const [drag, setDrag] = useState<number | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const unread = chats.reduce((n, c) => n + c.unread + (c.offersWaiting ?? 0), 0);
  const TABS = tabsFor(role);
  const active = nav.tab === 'devs' || nav.tab === 'projects' ? 1 : TABS.findIndex((t) => t.key === nav.tab);
  const shown = drag ?? active;
  const go = (fn: () => void) => { setMenu(false); fn(); };
  const at = (x: number) => {
    const r = box.current!.getBoundingClientRect();
    return Math.max(0, Math.min(TABS.length - 1, Math.floor(((x - r.left - 6) / (r.width - 12)) * TABS.length)));
  };
  const open = (i: number) => nav.setTab(TABS[i].key);
  return (
    <>
      <nav className="nav" aria-label="Разделы">
        <div className="nav-in">
          <div ref={box} className={`island ${drag !== null ? 'dragging' : ''}`}
            onPointerDown={(e) => { box.current!.setPointerCapture(e.pointerId); setDrag(at(e.clientX)); }}
            onPointerMove={(e) => { if (drag === null) return; const i = at(e.clientX); if (i !== drag) { haptic.select(); setDrag(i); } }}
            onPointerUp={(e) => { if (drag === null) return; const i = at(e.clientX); setDrag(null); open(i); }}
            onPointerCancel={() => setDrag(null)}>
            <span className="glow" style={{ left: `calc(6px + (100% - 12px) / 4 * ${shown} + ((100% - 12px) / 4 - 48px) / 2)` }} />
            {TABS.map((t, i) => (
              <button key={t.key} className={`tab ${i === shown ? 'on' : ''}`} onClick={(e) => { if (e.detail === 0) open(i); }}
                aria-current={i === active ? 'page' : undefined} aria-label={t.label}>
                <Icon name={t.icon} size={23} strokeWidth={i === shown ? 2.1 : 1.75} />
                {t.key === 'chats' && unread > 0 && <span className="badge num">{unread}</span>}
              </button>
            ))}
          </div>
          <button className={`fab ${menu ? 'open' : ''}`} aria-label="Создать" aria-expanded={menu} onClick={() => { haptic.tap(); setMenu((m) => !m); }}>
            <Icon name="plus" size={28} strokeWidth={2.2} />
          </button>
        </div>
      </nav>
      <Sheet open={menu} onClose={() => setMenu(false)} title="Что сделать?">
        <div className="group mt-s">
          {role === 'client' ? (
            <>
              <Cell icon lead={<IconTile name="projects" />} title="Опубликовать проект" chevron
                onClick={() => go(() => nav.open('home', 'project-new'))} />
              <Cell icon lead={<IconTile name="search" />} title="Найти исполнителя" chevron
                onClick={() => go(() => nav.setTab('devs'))} />
            </>
          ) : (
            <>
              <Cell icon lead={<IconTile name="projects" />} title="Найти проект" chevron
                onClick={() => go(() => nav.setTab('projects'))} />
              <Cell icon lead={<IconTile name="doc" />} title="Моя анкета" chevron
                onClick={() => go(() => nav.open('profile', 'dev-form'))} />
              <Cell icon lead={<IconTile name="crown" />} title="IT Trusty Pro" chevron
                onClick={() => go(() => nav.open('profile', 'pro'))} />
            </>
          )}
          <Cell icon lead={<IconTile name="shield" />} title="Как работает гарант" chevron onClick={() => go(() => nav.open('home', 'guide'))} />
        </div>
      </Sheet>
    </>
  );
}

function Toast() {
  const { toast } = useStore();
  const [shown, setShown] = useState<string | null>(null);
  const [out, setOut] = useState(false);
  useEffect(() => {
    if (toast) { setShown(toast); setOut(false); return; }
    if (!shown) return;
    setOut(true);
    const t = window.setTimeout(() => setShown(null), 300);
    return () => window.clearTimeout(t);
  }, [toast]);
  if (!shown) return null;
  return (
    <div className={`toast ${out ? 'out' : ''}`} role="status">
      <span className="tick"><Icon name="check" size={16} strokeWidth={3} /></span>{shown}
    </div>
  );
}

function usePull(enabled: boolean, onRefresh: () => Promise<unknown>) {
  const [pull, setPull] = useState(0);
  const [busy, setBusy] = useState(false);
  const start = useRef<number | null>(null);
  useEffect(() => {
    if (!enabled) return;
    const down = (e: TouchEvent) => { start.current = window.scrollY <= 0 && !busy ? e.touches[0].clientY : null; };
    const move = (e: TouchEvent) => {
      if (start.current === null) return;
      const dy = e.touches[0].clientY - start.current;
      setPull(dy > 0 ? Math.min(120, dy * 0.5) : 0);
    };
    const up = () => {
      if (start.current === null) return;
      start.current = null;
      setPull((p) => {
        if (p >= 70) {
          setBusy(true);
          haptic.tap();
          onRefresh().finally(() => { setBusy(false); haptic.success(); });
          return 56;
        }
        return 0;
      });
    };
    window.addEventListener('touchstart', down, { passive: true });
    window.addEventListener('touchmove', move, { passive: true });
    window.addEventListener('touchend', up);
    return () => { window.removeEventListener('touchstart', down); window.removeEventListener('touchmove', move); window.removeEventListener('touchend', up); };
  }, [enabled, onRefresh, busy]);
  useEffect(() => { if (!busy && pull === 56) setPull(0); }, [busy]);
  return { pull, busy };
}

function PullMark({ pull, busy }: { pull: number; busy: boolean }) {
  if (!pull && !busy) return null;
  const p = busy ? 0 : Math.min(1, pull / 70);
  return (
    <div className="ptr" aria-hidden="true" style={{ opacity: busy ? 1 : Math.min(1, pull / 30) }}>
      <svg viewBox="250 200 760 900" width="38" height="45" className={`split ${busy ? 'run' : ''}`}>
        <path className="up" fill="#f2f3f5" d={MARK_UP} style={busy ? undefined : { transform: `translateY(${-72 * p}px)` }} />
        <path className="lo" fill="#f2f3f5" d={MARK_LO} style={busy ? undefined : { transform: `translateY(${72 * p}px)` }} />
        <path className="wave" d={MARK_WAVE} style={busy ? undefined : { strokeDashoffset: 770 * (1 - p) }} />
      </svg>
    </div>
  );
}

function useDeepLink(ready: boolean) {
  const nav = useNav();
  const { role } = useStore();
  const done = useRef(false);
  useEffect(() => {
    if (!ready || done.current) return;
    done.current = true;
    const q = new URLSearchParams(location.search);
    let screen = q.get('screen');
    let id = q.get('id');
    const start = (tg?.initDataUnsafe as { start_param?: string } | undefined)?.start_param;
    if (!screen && start?.startsWith('dev_')) { screen = 'dev'; id = start.slice(4); }
    const tabs: Record<string, Tab> = { devs: 'devs', projects: 'projects', chats: 'chats', profile: 'profile', home: 'home' };
    if (!screen) return;
    if (tabs[screen]) nav.setTab(tabs[screen]);
    else if (screen === 'dev' && id) nav.open(role === 'dev' ? 'projects' : 'devs', 'dev', { id });
    else if (screen === 'project' && id) nav.open('projects', 'project', { id: Number(id) });
    else if (screen === 'chat' && id) nav.open('chats', 'chat', { id });
    else if (screen === 'admin') nav.open('profile', 'admin');
    else if (screen === 'complaint-admin' && id) nav.open('profile', 'complaint-admin', { id: Number(id) });
    else if (screen === 'dev-form') nav.open('profile', 'dev-form');
    else if (screen === 'deal' && id) nav.open('home', 'deal', { id: Number(id) });
    else if (screen === 'deals') nav.open('home', 'deals');
    else if (screen === 'finance') nav.open('profile', 'finance');
    else if (screen === 'pro') nav.open('profile', 'pro');
    else if (screen === 'portfolio') nav.open('profile', 'portfolio');
  }, [ready, nav]);
}

function Gate() {
  const s = useStore();
  const nav = useNav();
  useDeepLink(s.ready && !s.error && !s.banned);
  useEffect(() => {
    if (s.ready) hideSplash();
  }, [s.ready]);
  if (!s.ready) return null;
  if (s.banned) {
    return (
      <div className="screen no-tabs">
        <Done title="Аккаунт заблокирован" text={s.banned.until ? `Блокировка действует до ${s.banned.until}. Если считаете это ошибкой, напишите администратору.` : 'Блокировка бессрочная за повторное нарушение правил.'} />
      </div>
    );
  }
  if (!s.onboarded && !s.error) {
    return <Onboarding initialRole={null} onDone={async (r) => {
      await s.completeOnboarding(r);
      if (r === 'dev' && !s.me.profile) nav.open('profile', 'dev-form');
    }} />;
  }
  if (s.error) {
    return (
      <div className="screen no-tabs">
        <div className="done"><h1>Не удалось загрузить IT Trusty</h1><p>{s.error}</p>
          <button className="btn primary mt" style={{ width: 'auto' }} onClick={() => s.reload()}>Повторить</button></div>
      </div>
    );
  }
  return <Screen />;
}

function Screen() {
  const { route, depth, tab, setTab } = useNav();
  const { reload, refreshChats, role } = useStore();
  useEffect(() => {
    if (role === 'dev' && tab === 'devs' && depth === 1) setTab('projects');
    if (role === 'client' && tab === 'projects' && depth === 1) setTab('devs');
  }, [role]);
  const C = SCREENS[route.name] ?? Home;
  const [tips, setTips] = useState(false);
  useEffect(() => {
    if (depth === 1 && tab === 'home' && !tipsSeen(role)) { const t = window.setTimeout(() => setTips(true), 500); return () => window.clearTimeout(t); }
  }, [role, tab, depth]);
  useEffect(() => {
    const on = () => { setTab('home'); window.setTimeout(() => setTips(true), 400); };
    window.addEventListener('trusty:tips', on);
    return () => window.removeEventListener('trusty:tips', on);
  }, [setTab]);
  const refresh = useCallback(() => (tab === 'chats' ? refreshChats() : reload()), [tab, reload, refreshChats]);
  const { pull, busy } = usePull(depth === 1 && tab !== 'profile', refresh);
  return (
    <>
      <PullMark pull={pull} busy={busy} />
      <div style={pull ? { transform: `translateY(${pull}px)`, transition: busy ? 'transform .3s' : undefined } : { transition: 'transform .3s' }}>
        <C key={route.key} {...route.params} />
      </div>
      {depth === 1 && <Island />}
      {tips && depth === 1 && <Coach key={role} role={role} onClose={() => setTips(false)} />}
      <Toast />
    </>
  );
}

export default function App() {
  return (
    <StoreProvider>
      <NavProvider>
        <div className="app"><Gate /></div>
      </NavProvider>
    </StoreProvider>
  );
}
