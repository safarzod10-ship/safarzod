// App state. Live mode (inside Telegram) talks to the Trusty API; demo mode (a normal browser tab) uses example data.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api, ApiError, live } from './api';
import {
  ADMINS, CHATS, CLIENTS, COMPLAINTS, DEMO_DEALS, DEVS, MEMBERS, PROJECTS,
  type Chat, type Client, type Complaint, type ComplaintReason, type Deal, type Dev, type Member, type Msg, type Offer, type PayConfig, type Project, type Work,
} from './data';
import { haptic, onReturn, openTg, payInvoice, tgUser } from './tg';

export type Role = 'client' | 'dev';
export type FormState = 'none' | 'review' | 'published' | 'rejected';
export interface MyBid { projectId: number; price: number; days: number; text: string }
export interface ProPlan { key: '1m' | '3m'; days: number; stars: number; usdt: string; discount: number }
export interface ProInfo { active: boolean; until: string | null; alerts: boolean; plans: ProPlan[]; crypto: boolean; stars: boolean }
export interface Me { id: string; name: string; username?: string | null; role: Role; isAdmin: boolean; devForm: FormState; profile: Dev | null; moderationNote?: string | null; onboarded?: boolean; pro?: ProInfo }
export interface DevFormData { categories: string[]; years: number; stack: string[]; rate: number; status: 'free' | 'busy'; about: string; github: string; links: string[] }
export interface NewComplaint { againstId: string; againstName?: string; dealId?: number; reason: ComplaintReason; text: string; files: File[]; previews: string[] }
type NewProject = Omit<Project, 'id' | 'ago' | 'bids' | 'status' | 'clientId'>;

interface Bootstrap { me: Me; devs: Dev[]; projects: Project[]; chats: Chat[]; myComplaints: Complaint[]; admins: { name: string; handle: string }[]; deals?: Deal[]; payments?: PayConfig }
export interface FinancePayment { id: number; dealId: number; kind: 'invoice' | 'payout' | 'refund'; amount: string; status: string; user: string; error?: string | null; attempts: number; at: string }
export interface Finance { enabled: boolean; asset: string; feePercent: number; balance: { asset: string; available: string; onhold: string }[]; error?: string | null; held: string; disputes: Deal[]; payments: FinancePayment[] }
export type DealAction = 'submit' | 'accept' | 'dispute' | 'cancel' | 'review';
export interface OfferDraft { projectId?: number; amount: number; days: number; ttlHours: number; asRole?: Role }
export interface CounterDraft { amount: number; days: number; ttlHours: number }
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
  /** first-run intro finished with a role choice */
  completeOnboarding(r: Role): Promise<void>;
  onboarded: boolean;
  setAdmin(a: boolean): void;
  submitDevForm(d: DevFormData): Promise<void>;
  showToast(t: string): void;
  addProject(p: NewProject): Promise<number>;
  loadProject(id: number): Promise<void>;
  addBid(b: MyBid): Promise<void>;
  /** creates the deal for a chosen bid and returns its id */
  startDeal(projectId: number, devId: string, price: number, days: number): Promise<number>;
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
  deals: Deal[];
  payCfg: PayConfig;
  finance: Finance | null;
  loadDeal(id: number): Promise<Deal | undefined>;
  /** submit {note} | accept | dispute {reason} | cancel | review {rating, text} */
  dealAct(id: number, action: DealAction, body?: Record<string, unknown>): Promise<Deal>;
  /** opens the Crypto Bot invoice; the deal is re-checked when the user comes back */
  payDeal(id: number): Promise<void>;
  checkDeal(id: number): Promise<Deal | undefined>;
  loadFinance(): Promise<void>;
  resolveDeal(id: number, devShare: number, note: string): Promise<Deal>;
  retryPayment(id: number): Promise<void>;
  proposeOffer(chatId: string, d: OfferDraft): Promise<void>;
  counterOffer(chatId: string, offerId: number, d: CounterDraft): Promise<void>;
  /** accepts an offer and returns the id of the new deal */
  acceptOffer(chatId: string, offerId: number): Promise<number>;
  declineOffer(chatId: string, offerId: number): Promise<void>;
  withdrawOffer(chatId: string, offerId: number): Promise<void>;
  typing(chatId: string): void;
  /** removes the chat from my list (the other side keeps it) */
  deleteChat(chatId: string): Promise<void>;
  /** files (and an optional caption) into a chat */
  sendFiles(chatId: string, files: File[], text?: string): Promise<void>;
  uploadWorkImage(file: File): Promise<{ imageId: string; url: string }>;
  savePortfolio(items: Work[]): Promise<void>;
  invite(projectId: number, devId: string): Promise<void>;
  loadMatches(projectId: number): Promise<Dev[]>;
  proInfo: ProInfo;
  /** pays for Pro; resolves true when Pro is on */
  buyPro(method: 'stars' | 'crypto', plan: '1m' | '3m'): Promise<boolean>;
  checkPro(): Promise<boolean>;
  setAlerts(on: boolean): Promise<void>;
}

const Ctx = createContext<Store | null>(null);
const now = () => new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
const shortDate = (ms: number) => new Date(ms).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }).replace('.', '');
const OB_KEY = 'trusty.onboarded';
const readOb = () => { try { return localStorage.getItem(OB_KEY) === '1'; } catch { return false; } };
const demoName = tgUser ? [tgUser.first_name, tgUser.last_name].filter(Boolean).join(' ') : 'Гость';

function demoActions(status: Deal['status'], role: Deal['role'], reviewed: boolean): Deal['actions'] {
  // both sides rate each other at the end; `reviewed` means I already did
  return {
    pay: role === 'client' && status === 'awaiting_payment',
    submit: role === 'dev' && status === 'in_work',
    accept: role === 'client' && (status === 'in_work' || status === 'review'),
    dispute: role !== 'admin' && (status === 'in_work' || status === 'review'),
    cancel: status === 'awaiting_payment' || (role === 'dev' && status === 'in_work'),
    review: role !== 'admin' && status === 'done' && !reviewed,
    resolve: role === 'admin' && status === 'dispute',
  };
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(!live);
  const [error, setError] = useState<string | null>(null);
  const [banned, setBanned] = useState<{ until: string | null } | null>(null);
  const [meLive, setMeLive] = useState<Me | null>(null);
  const [roleDemo, setRoleDemo] = useState<Role>('client');
  const [adminDemo, setAdminDemo] = useState(true);
  const [devFormDemo, setDevFormDemo] = useState<FormState>('none');
  const [obDemo, setObDemo] = useState(readOb);
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
  const [deals, setDeals] = useState<Deal[]>(live ? [] : DEMO_DEALS);
  const [payCfg, setPayCfg] = useState<PayConfig>({ enabled: !live, asset: 'USDT', feePercent: 5, reviewDays: 3 });
  const [finance, setFinance] = useState<Finance | null>(null);
  const timer = useRef<number>();
  const [demoWorks, setDemoWorks] = useState<Work[] | null>(null);
  const [proDemo, setProDemo] = useState<ProInfo>({ active: false, until: null, alerts: true, crypto: true, stars: true,
    plans: [{ key: '1m', days: 30, stars: 300, usdt: '5.00', discount: 0 }, { key: '3m', days: 90, stars: 765, usdt: '12.75', discount: 15 }] });

  const me: Me = useMemo(() => meLive ?? {
    id: 'me', name: demoName, username: tgUser?.username, role: roleDemo, isAdmin: adminDemo, devForm: devFormDemo,
    profile: roleDemo === 'dev' ? { ...DEVS[0], portfolio: demoWorks ?? DEVS[0].portfolio, pro: proDemo.active } : null,
    pro: proDemo,
  }, [meLive, roleDemo, adminDemo, devFormDemo, demoWorks, proDemo]);

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
      setDeals(b.deals ?? []);
      if (b.payments) setPayCfg(b.payments);
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

  const completeOnboarding = useCallback(async (r: Role) => {
    if (!live) {
      setRoleDemo(r);
      setObDemo(true);
      try { localStorage.setItem(OB_KEY, '1'); } catch { /* private mode: show again next time */ }
      return;
    }
    setMeLive(await call(() => api<Me>('/me', { method: 'PATCH', body: { role: r, onboarded: true } })));
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

  const replaceDeal = (d: Deal) => setDeals((ds) => (ds.some((x) => x.id === d.id) ? ds.map((x) => (x.id === d.id ? d : x)) : [d, ...ds]));

  const loadDeal = useCallback(async (id: number) => {
    if (!live) return DEMO_DEALS.find((d) => d.id === id);
    try {
      const d = await api<Deal>(`/deals/${id}`);
      replaceDeal(d);
      return d;
    } catch { return undefined; }
  }, []);

  const checkDeal = useCallback(async (id: number) => {
    if (!live) return undefined;
    try {
      const d = await api<Deal>(`/deals/${id}/check`, { method: 'POST' });
      replaceDeal(d);
      return d;
    } catch { return undefined; }
  }, []);

  /** demo mode: the same state machine as the server, without money */
  const demoStep = useCallback((id: number, action: DealAction | 'pay' | 'resolve', body?: Record<string, unknown>) => {
    let out: Deal | undefined;
    setDeals((ds) => ds.map((d) => {
      if (d.id !== id) return d;
      const t = new Date().toISOString();
      let n: Deal = d;
      if (action === 'pay') n = { ...d, status: 'in_work', paidAt: t };
      if (action === 'submit') n = { ...d, status: 'review', submittedAt: t, workNote: String(body?.note ?? '') || null, reviewUntil: new Date(Date.now() + 3 * 864e5).toISOString() };
      if (action === 'accept') n = { ...d, status: 'done', finishedAt: t, result: 'ontime', payments: [{ id: Date.now(), kind: 'payout', amount: String(d.amount), status: 'sent', userId: d.dev.id, at: t }] };
      if (action === 'dispute') n = { ...d, status: 'dispute', disputeReason: String(body?.reason ?? ''), disputeBy: d.role === 'dev' ? 'dev' : 'client' };
      if (action === 'cancel') n = { ...d, status: d.status === 'awaiting_payment' ? 'cancelled' : 'refunded', finishedAt: t };
      if (action === 'review') {
        const r = { rating: Number(body?.rating ?? 5), text: String(body?.text ?? '') };
        n = d.role === 'dev' ? { ...d, clientReview: r } : { ...d, review: r };
      }
      if (action === 'resolve') {
        const share = Number(body?.devShare ?? 50);
        n = { ...d, status: share > 0 ? 'done' : 'refunded', devShare: share, finishedAt: t, resolution: `Арбитр: исполнителю ${share}%, заказчику ${100 - share}%.` };
      }
      n = { ...n, actions: demoActions(n.status, n.role, !!(n.role === 'dev' ? n.clientReview : n.review)) };
      out = n;
      return n;
    }));
    return out;
  }, []);

  const dealAct = useCallback(async (id: number, action: DealAction, body?: Record<string, unknown>) => {
    if (!live) { haptic.success(); return demoStep(id, action, body) ?? DEMO_DEALS[0]; }
    const d = await call(() => api<Deal>(`/deals/${id}/${action}`, { body: body ?? {} }));
    replaceDeal(d);
    haptic.success();
    refreshChats();
    return d;
  }, [call, demoStep]);

  const payDeal = useCallback(async (id: number) => {
    if (!live) { showToast('Демо: оплата сымитирована. В Telegram откроется настоящий счёт @CryptoBot'); demoStep(id, 'pay'); return; }
    const inv = await call(() => api<{ url: string; miniAppUrl?: string; amount: string }>(`/deals/${id}/pay`, { method: 'POST' }));
    openTg(inv.url);
  }, [call, showToast, demoStep]);

  const loadFinance = useCallback(async () => {
    if (!live) {
      setFinance({ enabled: true, asset: 'USDT', feePercent: 5, balance: [{ asset: 'USDT', available: '1240.50', onhold: '0' }], held: '682.50',
        disputes: [], payments: [{ id: 1, dealId: 1017, kind: 'payout', amount: '150.00', status: 'sent', user: 'Тимур Исмаилов', attempts: 1, at: new Date().toISOString() }] });
      return;
    }
    setFinance(await call(() => api<Finance>('/admin/finance')));
  }, [call]);

  const resolveDeal = useCallback(async (id: number, devShare: number, note: string) => {
    if (!live) return demoStep(id, 'resolve', { devShare }) ?? DEMO_DEALS[0];
    const d = await call(() => api<Deal>(`/admin/deals/${id}/resolve`, { body: { devShare, note } }));
    replaceDeal(d);
    haptic.success();
    return d;
  }, [call, demoStep]);

  const retryPayment = useCallback(async (id: number) => {
    if (!live) return;
    const r = await call(() => api<{ status: string; error?: string }>(`/admin/payments/${id}/retry`, { method: 'POST' }));
    showToast(r.status === 'sent' ? 'Выплата отправлена' : r.status === 'check' ? 'Отправлен чек' : `Не прошла: ${r.error ?? ''}`);
    await loadFinance();
  }, [call, showToast, loadFinance]);

  const startDeal = useCallback(async (projectId: number, devId: string, price: number, days: number) => {
    if (live) {
      const r = await call(() => api<{ chatId: string; dealId: number }>(`/projects/${projectId}/choose`, { body: { devId: Number(devId) } }));
      await Promise.all([refreshChats(), loadProject(projectId), loadDeal(r.dealId)]);
      haptic.success();
      return r.dealId;
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
    const fee = Math.round(price * payCfg.feePercent) / 100;
    setDeals((ds) => [{
      id: dealId, title: p.title, category: '', amount: price, fee: fee.toFixed(2), total: (price + fee).toFixed(2), status: 'awaiting_payment', role: 'client',
      client: { id: 'me', name: 'Вы', handle: 'you', hue: 0, lastSeenMin: 0 }, dev: { id: d.id, name: d.name, handle: d.handle, hue: d.hue, lastSeenMin: d.lastSeenMin },
      days, due: shortDate(Date.now() + days * 864e5), dueAt: new Date(Date.now() + days * 864e5).toISOString(), createdAt: new Date().toISOString(),
      chatId: id, projectId, payments: [], actions: demoActions('awaiting_payment', 'client', false),
    }, ...ds]);
    haptic.success();
    return dealId;
  }, [projects, call, refreshChats, loadProject, loadDeal, payCfg]);

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


  // ---------------------------------------------------------------- offers
  const putChat = (c: Chat) => setChats((cs) => (cs.some((x) => x.id === c.id) ? cs.map((x) => (x.id === c.id ? c : x)) : [c, ...cs]));
  const feeOf = useCallback((amount: number) => {
    const fee = Math.round(amount * payCfg.feePercent) / 100;
    return { fee: fee.toFixed(2), total: (amount + fee).toFixed(2) };
  }, [payCfg]);
  const mkOffer = useCallback((o: Omit<Offer, 'fee' | 'total' | 'createdAt' | 'expiresAt'> & { ttlHours: number }): Offer => ({
    ...o, ...feeOf(o.amount), createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + o.ttlHours * 3600e3).toISOString(),
  }), [feeOf]);
  /** demo: patch one chat's messages */
  const patchChat = (chatId: string, fn: (c: Chat) => Chat) => setChats((cs) => cs.map((c) => (c.id === chatId ? fn(c) : c)));
  const setOfferStatus = (chatId: string, offerId: number, status: Offer['status'], extra: Partial<Offer> = {}) =>
    patchChat(chatId, (c) => ({ ...c, offersWaiting: 0, messages: c.messages.map((m) => (m.offer?.id === offerId ? { ...m, offer: { ...m.offer, status, ...extra } } : m)) }));
  const demoTimer = useRef<number>();

  /** demo only: the other side types for a moment, then answers (accepts a fair price or meets halfway) */
  const demoReply = useCallback((chatId: string, mine: Offer) => {
    window.clearTimeout(demoTimer.current);
    patchChat(chatId, (c) => ({ ...c, peerTyping: true }));
    demoTimer.current = window.setTimeout(() => {
      setChats((cs) => cs.map((c) => {
        if (c.id !== chatId) return c;
        const ask = mine.prevAmount ?? mine.amount;
        const fair = mine.myRole === 'client' ? mine.amount >= ask * 0.9 : mine.amount <= ask * 1.1;
        if (fair || !mine.prevAmount) {
          const msgs = c.messages.map((m) => (m.offer?.id === mine.id ? { ...m, offer: { ...m.offer, status: 'accepted' as const, dealId: 1100 + (mine.id % 50) } } : m));
          return { ...c, peerTyping: false, messages: [...msgs, { id: Date.now(), from: 'system' as const, text: `Сделка #${1100 + (mine.id % 50)} создана. Условия зафиксированы: ${mine.amount} USDT, срок ${mine.days} дн. Ожидаем оплату от заказчика.`, time: now() }] };
        }
        const mid = Math.round((mine.amount + ask) / 2 / 5) * 5;
        const reply = mkOffer({ id: Date.now(), title: mine.title, amount: mid, days: mine.days, status: 'pending', mine: false, myRole: mine.myRole, prevAmount: mine.amount, ttlHours: 48 });
        const msgs = c.messages.map((m) => (m.offer?.id === mine.id ? { ...m, offer: { ...m.offer, status: 'countered' as const } } : m));
        return { ...c, peerTyping: false, offersWaiting: 1, messages: [...msgs, { id: Date.now(), from: 'peer' as const, text: `Оффер: ${mid} USDT`, time: now(), offer: reply }] };
      }));
    }, 2600);
  }, [mkOffer]);

  const proposeOffer = useCallback(async (chatId: string, d: OfferDraft) => {
    if (live) {
      putChat(await call(() => api<Chat>(`/chats/${chatId}/offers`, { body: { ...d, asRole: d.asRole ?? null } })));
      haptic.success();
      return;
    }
    const title = projects.find((p) => p.id === d.projectId)?.title ?? 'Проект';
    const o = mkOffer({ id: Date.now(), title, amount: d.amount, days: d.days, status: 'pending', mine: true, myRole: d.asRole ?? roleDemo, prevAmount: null, ttlHours: d.ttlHours });
    const m: Msg = { id: Date.now(), from: 'me', text: `Оффер: ${d.amount} USDT`, time: now(), offer: o };
    patchChat(chatId, (c) => ({ ...c, messages: [...c.messages, m] }));
    haptic.success();
    demoReply(chatId, o);
  }, [call, mkOffer, roleDemo, demoReply, projects]);

  const counterOffer = useCallback(async (chatId: string, offerId: number, d: CounterDraft) => {
    if (live) {
      putChat(await call(() => api<Chat>(`/offers/${offerId}/counter`, { body: d })));
      haptic.success();
      return;
    }
    const prev = chats.find((c) => c.id === chatId)?.messages.find((m) => m.offer?.id === offerId)?.offer;
    if (!prev) return;
    const o = mkOffer({ id: Date.now(), title: prev.title, amount: d.amount, days: d.days, status: 'pending', mine: true, myRole: prev.myRole, prevAmount: prev.amount, ttlHours: d.ttlHours });
    setOfferStatus(chatId, offerId, 'countered');
    patchChat(chatId, (c) => ({ ...c, messages: [...c.messages, { id: Date.now(), from: 'me', text: `Оффер: ${d.amount} USDT`, time: now(), offer: o }] }));
    haptic.success();
    demoReply(chatId, o);
  }, [call, chats, mkOffer, demoReply]);

  const acceptOffer = useCallback(async (chatId: string, offerId: number) => {
    if (live) {
      const r = await call(() => api<{ chat: Chat; deal: Deal }>(`/offers/${offerId}/accept`, { method: 'POST' }));
      putChat(r.chat);
      replaceDeal(r.deal);
      haptic.success();
      return r.deal.id;
    }
    const c = chats.find((x) => x.id === chatId)!;
    const o = c.messages.find((m) => m.offer?.id === offerId)!.offer!;
    const dealId = 1060 + (offerId % 30);
    setOfferStatus(chatId, offerId, 'accepted', { dealId });
    patchChat(chatId, (x) => ({ ...x, deal: { id: dealId, title: o.title, amount: o.amount, status: 'awaiting_payment', due: shortDate(Date.now() + o.days * 864e5) },
      messages: [...x.messages, { id: Date.now(), from: 'system', text: `Сделка #${dealId} создана. Условия зафиксированы: ${o.amount} USDT, срок ${o.days} дн. Ожидаем оплату от заказчика.`, time: now() }] }));
    const d = DEVS.find((x) => x.id === c.peer.refId) ?? DEVS[0];
    const client = o.myRole === 'client';
    setDeals((ds) => [{
      id: dealId, title: o.title, category: '', amount: o.amount, fee: o.fee, total: o.total, status: 'awaiting_payment', role: o.myRole,
      client: client ? { id: 'me', name: 'Вы', handle: 'you', hue: 0, lastSeenMin: 0 } : { id: c.peer.refId, name: c.peer.name, handle: '', hue: c.peer.hue, lastSeenMin: c.peer.lastSeenMin },
      dev: client ? { id: d.id, name: d.name, handle: d.handle, hue: d.hue, lastSeenMin: d.lastSeenMin } : { id: 'me', name: 'Вы', handle: 'you', hue: 0, lastSeenMin: 0 },
      days: o.days, due: shortDate(Date.now() + o.days * 864e5), dueAt: new Date(Date.now() + o.days * 864e5).toISOString(), createdAt: new Date().toISOString(),
      chatId, payments: [], actions: demoActions('awaiting_payment', o.myRole, false),
    }, ...ds.filter((x) => x.id !== dealId)]);
    haptic.success();
    return dealId;
  }, [call, chats]);

  const declineOffer = useCallback(async (chatId: string, offerId: number) => {
    if (live) { putChat(await call(() => api<Chat>(`/offers/${offerId}/decline`, { method: 'POST' }))); return; }
    setOfferStatus(chatId, offerId, 'declined');
  }, [call]);

  const withdrawOffer = useCallback(async (chatId: string, offerId: number) => {
    if (live) { putChat(await call(() => api<Chat>(`/offers/${offerId}/withdraw`, { method: 'POST' }))); return; }
    window.clearTimeout(demoTimer.current);
    patchChat(chatId, (c) => ({ ...c, peerTyping: false }));
    setOfferStatus(chatId, offerId, 'withdrawn');
  }, [call]);

  const typing = useCallback((chatId: string) => {
    if (live) api(`/chats/${chatId}/typing`, { method: 'POST' }).catch(() => {});
  }, []);

  // ---------------------------------------------------------------- files, portfolio, invitations, Pro
  const sendFiles = useCallback(async (chatId: string, files: File[], text = '') => {
    if (live) {
      const f = new FormData();
      f.append('text', text);
      files.forEach((x) => f.append('files', x));
      putChat(await call(() => api<Chat>(`/chats/${chatId}/files`, { form: f })));
      return;
    }
    const att = files.map((x, i) => ({ id: Date.now() + i, name: x.name, size: x.size, mime: x.type, image: x.type.startsWith('image/'), url: URL.createObjectURL(x) }));
    patchChat(chatId, (c) => ({ ...c, messages: [...c.messages, { id: Date.now(), from: 'me', text, time: now(), files: att }] }));
  }, [call]);

  const uploadWorkImage = useCallback(async (file: File) => {
    if (live) {
      const f = new FormData();
      f.append('file', file);
      return call(() => api<{ imageId: string; url: string }>('/portfolio/image', { form: f }));
    }
    return { imageId: `demo-${Date.now()}`, url: URL.createObjectURL(file) };
  }, [call]);

  const savePortfolio = useCallback(async (items: Work[]) => {
    if (live) {
      setMeLive(await call(() => api<Me>('/portfolio', { method: 'PUT', body: { items: items.map((w) => ({ title: w.title, text: w.text, url: w.url || null, imageId: w.imageId || null })) } })));
    } else setDemoWorks(items);
    haptic.success();
  }, [call]);

  const invite = useCallback(async (projectId: number, devId: string) => {
    if (live) replaceProject(await call(() => api<Project>(`/projects/${projectId}/invite`, { body: { devId: Number(devId) } })));
    else setProjects((ps) => ps.map((p) => (p.id === projectId ? { ...p, invitedIds: [...(p.invitedIds ?? []), devId] } : p)));
    haptic.success();
    showToast('Приглашение отправлено');
  }, [call, showToast]);

  const loadMatches = useCallback(async (projectId: number) => {
    if (!live) {
      const p = projects.find((x) => x.id === projectId);
      return DEVS.filter((d) => p && (d.categories.includes(p.category) || d.stack.some((s) => p.stack.includes(s)))).slice(0, 5)
        .sort((a, b) => Number(!!b.pro) - Number(!!a.pro));
    }
    try { return await api<Dev[]>(`/projects/${projectId}/matches`); } catch { return []; }
  }, [projects]);

  const proInfo: ProInfo = (live ? meLive?.pro : proDemo) ?? proDemo;

  const checkPro = useCallback(async () => {
    if (!live) return proDemo.active;
    const info = await api<ProInfo>('/pro/check', { method: 'POST' }).catch(() => null);
    if (info) setMeLive((m) => (m ? { ...m, pro: info } : m));
    return !!info?.active;
  }, [proDemo]);

  const buyPro = useCallback(async (method: 'stars' | 'crypto', plan: '1m' | '3m') => {
    if (!live) {
      const days = plan === '3m' ? 90 : 30;
      setProDemo((p) => ({ ...p, active: true, until: new Date(Date.now() + days * 864e5).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }).replace('.', '') }));
      showToast(`Демо: Pro подключён, в Telegram откроется оплата ${method === 'stars' ? 'звёздами' : 'в USDT'}`);
      return true;
    }
    const { url } = await call(() => api<{ url: string }>(`/pro/${method}`, { body: { plan } }));
    if (method === 'stars') {
      const st = await payInvoice(url);
      if (st === 'paid') {
        // the bot confirms the payment a moment later
        for (let i = 0; i < 10; i++) { await new Promise((r) => setTimeout(r, 1200)); if (await checkPro()) return true; }
      }
      return false;
    }
    openTg(url);
    return new Promise<boolean>((resolve) => {
      let n = 0;
      const stop = onReturn(async () => { if (await checkPro()) { stop(); window.clearInterval(t); resolve(true); } });
      const t = window.setInterval(async () => {
        if (++n > 60 || await checkPro()) { stop(); window.clearInterval(t); resolve(n <= 60); }
      }, 3000);
    });
  }, [call, checkPro, showToast]);

  const setAlerts = useCallback(async (on: boolean) => {
    if (!live) { setProDemo((p) => ({ ...p, alerts: on })); return; }
    setMeLive(await call(() => api<Me>('/me', { method: 'PATCH', body: { alerts: on } })));
  }, [call]);

  const deleteChat = useCallback(async (chatId: string) => {
    if (live) await call(() => api(`/chats/${chatId}/delete`, { method: 'POST' }));
    setChats((cs) => cs.filter((c) => c.id !== chatId));
    haptic.success();
    showToast('Чат удалён');
  }, [call, showToast]);

  const value = useMemo<Store>(() => ({
    live, ready, error, banned, me, role: me.role, admin: me.isAdmin, onboarded: live ? !!me.onboarded : obDemo, completeOnboarding, devs, projects, chats, complaints, myComplaints, members,
    profiles, admins, devForm: me.devForm, toast,
    isMe, clientOf, devById, myBidFor, reload, setRole, setAdmin: setAdminDemo, submitDevForm, showToast, addProject, loadProject,
    addBid, startDeal, openChat, loadChat, refreshChats, send, readChat, addComplaint, loadAdmin, ban, unban, rejectComplaint,
    takeComplaint, moderate, fetchDev, deals, payCfg, finance, loadDeal, dealAct, payDeal, checkDeal, loadFinance, resolveDeal, retryPayment,
    proposeOffer, counterOffer, acceptOffer, declineOffer, withdrawOffer, typing, deleteChat,
    sendFiles, uploadWorkImage, savePortfolio, invite, loadMatches, proInfo, buyPro, checkPro, setAlerts,
  }), [sendFiles, uploadWorkImage, savePortfolio, invite, loadMatches, proInfo, buyPro, checkPro, setAlerts, deleteChat, proposeOffer, counterOffer, acceptOffer, declineOffer, withdrawOffer, typing, deals, payCfg, finance, loadDeal, dealAct, payDeal, checkDeal, loadFinance, resolveDeal, retryPayment, ready, error, banned, me, obDemo, completeOnboarding, devs, projects, chats, complaints, myComplaints, members, profiles, admins, toast, isMe, clientOf,
    devById, myBidFor, reload, setRole, submitDevForm, showToast, addProject, loadProject, addBid, startDeal, openChat, loadChat,
    refreshChats, send, readChat, addComplaint, loadAdmin, ban, unban, rejectComplaint, takeComplaint, moderate, fetchDev]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore() {
  const s = useContext(Ctx);
  if (!s) throw new Error('useStore outside StoreProvider');
  return s;
}
