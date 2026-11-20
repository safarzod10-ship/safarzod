import type { ComponentType } from 'react';
import { Icon, type IconName } from './icons';
import { NavProvider, useNav, type Tab } from './nav';
import Admin, { ComplaintAdmin, MemberAdmin, MyComplaints } from './screens/Admin';
import Chats, { ChatView } from './screens/Chats';
import Complaint from './screens/Complaint';
import DevForm from './screens/DevForm';
import DevProfile from './screens/DevProfile';
import Devs from './screens/Devs';
import Guide from './screens/Guide';
import Home from './screens/Home';
import Profile from './screens/Profile';
import { BidForm, Choose, ProjectNew } from './screens/ProjectForms';
import Projects from './screens/Projects';
import ProjectView from './screens/ProjectView';
import { StoreProvider, useStore } from './store';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const SCREENS: Record<string, ComponentType<any>> = {
  home: Home, devs: Devs, dev: DevProfile, projects: Projects, project: ProjectView, 'project-new': ProjectNew,
  bid: BidForm, choose: Choose, chats: Chats, chat: ChatView, profile: Profile, 'dev-form': DevForm,
  complaint: Complaint, guide: Guide, admin: Admin, 'complaint-admin': ComplaintAdmin, member: MemberAdmin,
  'my-complaints': MyComplaints,
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
        <div className="app"><Screen /></div>
      </NavProvider>
    </StoreProvider>
  );
}
