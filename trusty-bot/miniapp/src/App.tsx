import { useEffect, useRef, type ComponentType } from 'react';
import { Icon, type IconName } from './icons';
import { NavProvider, useNav, type Tab } from './nav';
import Admin, { ComplaintAdmin, MemberAdmin, MyComplaints, ProfileReview } from './screens/Admin';
import Chats, { ChatView } from './screens/Chats';
import Complaint from './screens/Complaint';
import DevForm from './screens/DevForm';
import DevProfile from './screens/DevProfile';
import Devs from './screens/Devs';
import Guide from './screens/Guide';
import Home from './screens/Home';
import Onboarding from './screens/Onboarding';
import Profile from './screens/Profile';
import { BidForm, Choose, ProjectNew } from './screens/ProjectForms';
import Projects from './screens/Projects';
import ProjectView from './screens/ProjectView';
import { StoreProvider, useStore } from './store';
import { hideSplash, tg } from './tg';
import { Done } from './ui';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const SCREENS: Record<string, ComponentType<any>> = {
  home: Home, devs: Devs, dev: DevProfile, projects: Projects, project: ProjectView, 'project-new': ProjectNew,
  bid: BidForm, choose: Choose, chats: Chats, chat: ChatView, profile: Profile, 'dev-form': DevForm,
  complaint: Complaint, guide: Guide, admin: Admin, 'complaint-admin': ComplaintAdmin, member: MemberAdmin,
  'my-complaints': MyComplaints, 'profile-review': ProfileReview,
};

const TABS: { key: Tab; label: string; icon: IconName }[] = [
  { key: 'home', label: 'Главная', icon: 'home' },
  { key: 'devs', label: 'Разработчики', icon: 'devs' },
  { key: 'projects', label: 'Проекты', icon: 'projects' },
  { key: 'chats', label: 'Чаты', icon: 'chats' },
  { key: 'profile', label: 'Профиль', icon: 'profile' },
];

function TabBar() {
  const nav = useNav();
  const { chats } = useStore();
  const unread = chats.reduce((n, c) => n + c.unread, 0);
  return (
    <nav className="tabbar" aria-label="Разделы">
      <div className="tabbar-in">
        {TABS.map((t) => (
          <button key={t.key} className={`tab ${nav.tab === t.key ? 'on' : ''}`} onClick={() => nav.setTab(t.key)}
            aria-current={nav.tab === t.key ? 'page' : undefined}>
            <Icon name={t.icon} size={24} />
            {t.label}
            {t.key === 'chats' && unread > 0 && <span className="badge num">{unread}</span>}
          </button>
        ))}
      </div>
    </nav>
  );
}

function Toast() {
  const { toast } = useStore();
  const nav = useNav();
  if (!toast) return null;
  return (
    <div className="toast" role="status" style={nav.depth > 1 ? { bottom: 'calc(84px + var(--safe-b))' } : undefined}>
      <Icon name="check" size={18} />{toast}
    </div>
  );
}

/** opens the screen a bot button or a t.me/...?startapp= link points to */
function useDeepLink(ready: boolean) {
  const nav = useNav();
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
    else if (screen === 'dev' && id) nav.open('devs', 'dev', { id });
    else if (screen === 'project' && id) nav.open('projects', 'project', { id: Number(id) });
    else if (screen === 'chat' && id) nav.open('chats', 'chat', { id });
    else if (screen === 'admin') nav.open('profile', 'admin');
    else if (screen === 'complaint-admin' && id) nav.open('profile', 'complaint-admin', { id: Number(id) });
    else if (screen === 'dev-form') nav.open('profile', 'dev-form');
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
        <div className="done"><h1>Не удалось загрузить Trusty</h1><p>{s.error}</p>
          <button className="btn primary mt" style={{ width: 'auto' }} onClick={() => s.reload()}>Повторить</button></div>
      </div>
    );
  }
  return <Screen />;
}

function Screen() {
  const { route, depth } = useNav();
  const C = SCREENS[route.name] ?? Home;
  return (
    <>
      <C key={route.key} {...route.params} />
      {depth === 1 && <TabBar />}
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
