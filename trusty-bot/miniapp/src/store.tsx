// App state. Live mode (inside Telegram) talks to the Trusty API; demo mode (a normal browser tab) uses example data.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api, ApiError, live } from './api';
import {
  ADMINS, CHATS, CLIENTS, COMPLAINTS, DEVS, MEMBERS, PROJECTS,
  type Chat, type Client, type Complaint, type ComplaintReason, type Dev, type Member, type Project,
} from './data';
import { haptic, tgUser } from './tg';

export type Role = 'client' | 'dev';
export type FormState = 'none' | 'review' | 'published' | 'rejected';
export interface MyBid { projectId: number; price: number; days: number; text: string }
export interface Me { id: string; name: string; username?: string | null; role: Role; isAdmin: boolean; devForm: FormState; profile: Dev | null; moderationNote?: string | null }
export interface DevFormData { categories: string[]; years: number; stack: string[]; rate: number; status: 'free' | 'busy'; about: string; github: string; links: string[] }
export interface NewComplaint { againstId: string; againstName?: string; dealId?: number; reason: ComplaintReason; text: string; files: File[]; previews: string[] }
type NewProject = Omit<Project, 'id' | 'ago' | 'bids' | 'status' | 'clientId'>;

interface Bootstrap { me: Me; devs: Dev[]; projects: Project[]; chats: Chat[]; myComplaints: Complaint[]; admins: { name: string; handle: string }[] }
interface Overview { members: Member[]; complaints: Complaint[]; profiles: Dev[]; admins: { name: string; handle: string }[] }

interface Store {
  live: boolean;
  ready: boolean;
  error: string | null;
  banned: { until: string | null } | null;
  me: Me;
  role: Role;
  admin: boolean;
  devs: Dev[];
  projects: Project[];
  chats: Chat[];
  complaints: Complaint[];
  myComplaints: Complaint[];
  members: Member[];
  profiles: Dev[];
  admins: { name: string; handle: string }[];
  devForm: FormState;
  toast: string | null;
  isMe(id: string): boolean;
  clientOf(p: Project): Client | undefined;
  devById(id: string): Dev | undefined;
  myBidFor(projectId: number): MyBid | undefined;
  reload(): Promise<void>;
  setRole(r: Role): Promise<void>;
  setAdmin(a: boolean): void;
  submitDevForm(d: DevFormData): Promise<void>;
  showToast(t: string): void;
  addProject(p: NewProject): Promise<number>;
  loadProject(id: number): Promise<void>;
  addBid(b: MyBid): Promise<void>;
  startDeal(projectId: number, devId: string, price: number, days: number): Promise<string>;
  openChat(userId: string): Promise<string>;
  loadChat(id: string): Promise<void>;
  refreshChats(): Promise<void>;
  send(chatId: string, text: string): Promise<void>;
  readChat(chatId: string): void;
  addComplaint(c: NewComplaint): Promise<number>;
  loadAdmin(): Promise<void>;
  ban(memberId: string, complaintId?: number): Promise<string>;
  unban(memberId: string): Promise<void>;
  rejectComplaint(id: number): Promise<void>;
  takeComplaint(id: number): Promise<void>;
  moderate(uid: string, approve: boolean, note?: string): Promise<void>;
  fetchDev(id: string): Promise<Dev | undefined>;
}

const Ctx = createContext<Store | null>(null);
const now = () => new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
const shortDate = (ms: number) => new Date(ms).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }).replace('.', '');
const demoName = tgUser ? [tgUser.first_name, tgUser.last_name].filter(Boolean).join(' ') : 'Гость';

export function StoreProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(!live);
  const [error, setError] = useState<string | null>(null);
  const [banned, setBanned] = useState<{ until: string | null } | null>(null);
  const [meLive, setMeLive] = useState<Me | null>(null);
  const [roleDemo, setRoleDemo] = useState<Role>('client');
  const [adminDemo, setAdminDemo] = useState(true);
  const [devFormDemo, setDevFormDemo] = useState<FormState>('none');
  const [devs, setDevs] = useState<Dev[]>(live ? [] : DEVS);
  const [extraDevs, setExtraDevs] = useState<Record<string, Dev>>({});
  const [projects, setProjects] = useState<Project[]>(live ? [] : PROJECTS);
  const [chats, setChats] = useState<Chat[]>(live ? [] : CHATS);
  const [complaints, setComplaints] = useState<Complaint[]>(live ? [] : COMPLAINTS);
  const [myComplaints, setMyComplaints] = useState<Complaint[]>([]);
  const [members, setMembers] = useState<Member[]>(live ? [] : MEMBERS);
  const [profiles, setProfiles] = useState<Dev[]>([]);
  const [admins, setAdmins] = useState(live ? [] : ADMINS);
  const [myBidsDemo, setMyBidsDemo] = useState<MyBid[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const timer = useRef<number>();

  const me: Me = useMemo(() => meLive ?? {
    id: 'me', name: demoName, username: tgUser?.username, role: roleDemo, isAdmin: adminDemo, devForm: devFormDemo,
    profile: roleDemo === 'dev' ? DEVS[0] : null,
  }, [meLive, roleDemo, adminDemo, devFormDemo]);

  const showToast = useCallback((t: string) => {
    setToast(t);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setToast(null), 2800);
  }, []);

  /** runs an API call; errors become a toast and are re-thrown so the screen can stay put */
  const call = useCallback(async <T,>(fn: () => Promise<T>): Promise<T> => {
    try {
      return await fn();
    } catch (e) {
      const err = e as ApiError;
      if (err.banned) setBanned(err.banned);
      haptic.error();
      showToast(err.message || 'Не получилось');
      throw e;
    }
  }, [showToast]);

  const replaceProject = (p: Project) => setProjects((ps) => (ps.some((x) => x.id === p.id) ? ps.map((x) => (x.id === p.id ? p : x)) : [p, ...ps]));
  const replaceChat = (c: Chat) => setChats((cs) => [c, ...cs.filter((x) => x.id !== c.id)]);

  const reload = useCallback(async () => {
    if (!live) return;
    setError(null);
    try {
      const b = await api<Bootstrap>('/bootstrap');
      setMeLive(b.me); setDevs(b.devs); setProjects(b.projects); setChats(b.chats); setMyComplaints(b.myComplaints); setAdmins(b.admins);
      setReady(true);
    } catch (e) {
      const err = e as ApiError;
      if (err.banned) setBanned(err.banned);
      else setError(err.message);
      setReady(true);
    }
  }, []);

  useEffect(() => { reload(); }, [reload]);

  const isMe = useCallback((id: string) => (live ? id === me.id : id === 'me' || (me.role === 'dev' && id === 'timur')), [me]);
  const clientOf = useCallback((p: Project) => p.client ?? CLIENTS.find((c) => c.id === p.clientId), []);
  const devById = useCallback((id: string) => devs.find((d) => d.id === id) ?? extraDevs[id] ?? (me.profile?.id === id ? me.profile : undefined),
    [devs, extraDevs, me]);
  const myBidFor = useCallback((pid: number) => (live ? projects.find((p) => p.id === pid)?.myBid ?? undefined : myBidsDemo.find((b) => b.projectId === pid)),
    [projects, myBidsDemo]);

  const setRole = useCallback(async (r: Role) => {
    if (!live) { setRoleDemo(r); return; }
    setMeLive(await call(() => api<Me>('/me', { method: 'PATCH', body: { role: r } })));
  }, [call]);

  const submitDevForm = useCallback(async (d: DevFormData) => {
    if (!live) { setDevFormDemo('review'); return; }
    setMeLive(await call(() => api<Me>('/dev-profile', { method: 'PUT', body: { ...d, github: d.github || null } })));
  }, [call]);

  const fetchDev = useCallback(async (id: string) => {
    if (!live) return DEVS.find((d) => d.id === id);
    try {
      const d = await api<Dev>(`/devs/${id}`);
      setExtraDevs((x) => ({ ...x, [id]: d }));
      return d;
    } catch {
      return undefined;
    }
  }, []);

  const addProject = useCallback(async (p: NewProject) => {
    if (live) {
      const created = await call(() => api<Project>('/projects', { body: { ...p, files: p.files.map((f) => f.name) } }));
      replaceProject(created);
      return created.id;
    }
    const id = Math.max(...projects.map((x) => x.id)) + 1;
    setProjects((ps) => [{ ...p, id, ago: 'только что', bids: [], status: 'open', clientId: 'me' }, ...ps]);
    return id;
  }, [projects, call]);

  const loadProject = useCallback(async (id: number) => {
    if (!live) return;
    try { replaceProject(await api<Project>(`/projects/${id}`)); } catch { /* keep cached */ }
  }, []);

  const addBid = useCallback(async (b: MyBid) => {
    if (live) {
      replaceProject(await call(() => api<Project>(`/projects/${b.projectId}/bids`, { body: { price: b.price, days: b.days, text: b.text } })));
      return;
    }
    setMyBidsDemo((bs) => [...bs.filter((x) => x.projectId !== b.projectId), b]);
    setProjects((ps) => ps.map((p) => (p.id === b.projectId
      ? { ...p, bids: [...p.bids.filter((x) => x.devId !== 'timur'), { devId: 'timur', price: b.price, days: b.days, text: b.text, ago: 'только что' }] }
      : p)));
  }, [call]);

  const refreshChats = useCallback(async () => {
    if (!live) return;
    try { setChats(await api<Chat[]>('/chats')); } catch { /* offline: keep */ }
  }, []);

  const loadChat = useCallback(async (id: string) => {
    if (!live) return;
    try {
      const c = await api<Chat>(`/chats/${id}`);
      setChats((cs) => (cs.some((x) => x.id === id) ? cs.map((x) => (x.id === id ? c : x)) : [c, ...cs]));
    } catch { /* keep cached */ }
  }, []);

  const startDeal = useCallback(async (projectId: number, devId: string, price: number, days: number) => {
    if (live) {
      const r = await call(() => api<{ chatId: string; dealId: number }>(`/projects/${projectId}/choose`, { body: { devId: Number(devId) } }));
      await Promise.all([refreshChats(), loadProject(projectId)]);
      haptic.success();
      return r.chatId;
    }
    const p = projects.find((x) => x.id === projectId)!;
    const d = DEVS.find((x) => x.id === devId)!;
    const id = `c-${devId}`;
    const dealId = 1049 + Math.floor(Math.random() * 40);
    setProjects((ps) => ps.map((x) => (x.id === projectId ? { ...x, status: 'in_work' } : x)));
    setChats((cs) => {
      const prev = cs.find((c) => c.id === id);
      return [{
        id, unread: 0,
        peer: { name: d.name, hue: d.hue, lastSeenMin: d.lastSeenMin, role: 'dev', refId: d.id },
        deal: { id: dealId, title: p.title, amount: price, status: 'awaiting_payment', due: shortDate(Date.now() + days * 864e5) },
        messages: [...(prev?.messages ?? []),
          { id: Date.now(), from: 'system', text: `Сделка #${dealId} создана. Условия зафиксированы: ${price} USDT, срок ${days} дн. Ожидаем оплату от заказчика.`, time: now() }],
      }, ...cs.filter((c) => c.id !== id)];
    });
    haptic.success();
    return id;
  }, [projects, call, refreshChats, loadProject]);

  const openChat = useCallback(async (userId: string) => {
    if (live) {
      const c = await call(() => api<Chat>('/chats/open', { body: { userId: Number(userId) } }));
      replaceChat(c);
      return c.id;
    }
    const id = `c-${userId}`;
    setChats((cs) => {
      if (cs.some((c) => c.id === id)) return cs;
      const d = DEVS.find((x) => x.id === userId)!;
      return [{ id, peer: { name: d.name, hue: d.hue, lastSeenMin: d.lastSeenMin, role: 'dev', refId: d.id }, unread: 0, messages: [] }, ...cs];
    });
    return id;
  }, [call]);

  const send = useCallback(async (chatId: string, text: string) => {
    if (live) {
      const c = await call(() => api<Chat>(`/chats/${chatId}/messages`, { body: { text } }));
      setChats((cs) => [c, ...cs.filter((x) => x.id !== chatId)]);
      return;
    }
    setChats((cs) => cs.map((c) => (c.id === chatId ? { ...c, messages: [...c.messages, { id: Date.now(), from: 'me', text, time: now() }] } : c)));
  }, [call]);

  const readChat = useCallback((chatId: string) => {
    setChats((cs) => cs.map((c) => (c.id === chatId && c.unread ? { ...c, unread: 0 } : c)));
    if (live) api(`/chats/${chatId}/read`, { method: 'POST' }).catch(() => {});
  }, []);

  const addComplaint = useCallback(async (c: NewComplaint) => {
    if (live) {
      const f = new FormData();
      f.append('against', c.againstId);
      f.append('reason', c.reason);
      f.append('text', c.text);
      if (c.dealId) f.append('deal', String(c.dealId));
      c.files.forEach((file) => f.append('files', file));
      const created = await call(() => api<Complaint>('/complaints', { form: f }));
      setMyComplaints((x) => [created, ...x]);
      haptic.success();
      return created.id;
    }
    const id = Math.max(...complaints.map((x) => x.id)) + 1;
    const created: Complaint = { id, fromId: 'me', fromName: 'Вы', againstId: c.againstId, againstName: c.againstName ?? 'Пользователь',
      dealId: c.dealId, reason: c.reason, text: c.text, evidence: c.previews, status: 'new', ago: 'только что' };
    setComplaints((cs) => [created, ...cs]);
    setMyComplaints((x) => [created, ...x]);
    haptic.success();
    return id;
  }, [complaints, call]);

  const loadAdmin = useCallback(async () => {
    if (!live) return;
    const o = await call(() => api<Overview>('/admin/overview'));
    setMembers(o.members); setComplaints(o.complaints); setProfiles(o.profiles); setAdmins(o.admins);
  }, [call]);

  // first violation: 30 days; repeated: permanent
  const ban = useCallback(async (memberId: string, complaintId?: number) => {
    if (live) {
      const r = complaintId
        ? await call(() => api<{ message: string }>(`/admin/complaints/${complaintId}/ban`, { method: 'POST' }))
        : await call(() => api<{ message: string }>(`/admin/users/${memberId}/ban`, { method: 'POST' }));
      await loadAdmin();
      haptic.warning();
      return r.message;
    }
    const m = members.find((x) => x.id === memberId)!;
    const permanent = m.strikes >= 1;
    const until = permanent ? null : shortDate(Date.now() + 30 * 864e5);
    setMembers((ms) => ms.map((x) => (x.id === memberId ? { ...x, strikes: x.strikes + 1, ban: { until } } : x)));
    if (complaintId) {
      const decision = permanent ? 'Повторное нарушение: бессрочная блокировка.' : `Первое нарушение: блокировка до ${until}.`;
      setComplaints((cs) => cs.map((c) => (c.id === complaintId ? { ...c, status: 'resolved', decision } : c)));
    }
    haptic.warning();
    return permanent ? 'Заблокирован навсегда' : `Заблокирован до ${until}`;
  }, [members, call, loadAdmin]);

  const unban = useCallback(async (memberId: string) => {
    if (live) { await call(() => api(`/admin/users/${memberId}/unban`, { method: 'POST' })); await loadAdmin(); return; }
    setMembers((ms) => ms.map((x) => (x.id === memberId ? { ...x, ban: undefined } : x)));
    haptic.success();
  }, [call, loadAdmin]);

  const rejectComplaint = useCallback(async (id: number) => {
    if (live) { await call(() => api(`/admin/complaints/${id}/reject`, { method: 'POST' })); await loadAdmin(); return; }
    setComplaints((cs) => cs.map((c) => (c.id === id ? { ...c, status: 'rejected', decision: 'Нарушение не подтвердилось.' } : c)));
  }, [call, loadAdmin]);

  const takeComplaint = useCallback(async (id: number) => {
    if (live) { await call(() => api(`/admin/complaints/${id}/take`, { method: 'POST' })); await loadAdmin(); return; }
    setComplaints((cs) => cs.map((c) => (c.id === id && c.status === 'new' ? { ...c, status: 'review' } : c)));
  }, [call, loadAdmin]);

  const moderate = useCallback(async (uid: string, approve: boolean, note?: string) => {
    if (!live) { setProfiles((ps) => ps.filter((p) => p.id !== uid)); return; }
    await call(() => api(`/admin/profiles/${uid}/${approve ? 'approve' : 'reject'}`, { method: 'POST', body: approve ? undefined : { note: note ?? null } }));
    await Promise.all([loadAdmin(), reload()]);
  }, [call, loadAdmin, reload]);

  const value = useMemo<Store>(() => ({
    live, ready, error, banned, me, role: me.role, admin: me.isAdmin, devs, projects, chats, complaints, myComplaints, members,
    profiles, admins, devForm: me.devForm, toast,
    isMe, clientOf, devById, myBidFor, reload, setRole, setAdmin: setAdminDemo, submitDevForm, showToast, addProject, loadProject,
    addBid, startDeal, openChat, loadChat, refreshChats, send, readChat, addComplaint, loadAdmin, ban, unban, rejectComplaint,
    takeComplaint, moderate, fetchDev,
  }), [ready, error, banned, me, devs, projects, chats, complaints, myComplaints, members, profiles, admins, toast, isMe, clientOf,
    devById, myBidFor, reload, setRole, submitDevForm, showToast, addProject, loadProject, addBid, startDeal, openChat, loadChat,
    refreshChats, send, readChat, addComplaint, loadAdmin, ban, unban, rejectComplaint, takeComplaint, moderate, fetchDev]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore() {
  const s = useContext(Ctx);
  if (!s) throw new Error('useStore outside StoreProvider');
  return s;
}
