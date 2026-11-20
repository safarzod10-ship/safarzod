// App state for the prototype (in memory; a real backend replaces this).
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  CHATS, COMPLAINTS, DEVS, MEMBERS, PROJECTS,
  type Chat, type Complaint, type ComplaintReason, type Member, type Project,
} from './data';
import { haptic } from './tg';

export type Role = 'client' | 'dev';
export type FormState = 'none' | 'review' | 'published';

export interface MyBid { projectId: number; price: number; days: number; text: string }

interface Store {
  role: Role;
  admin: boolean;
  projects: Project[];
  chats: Chat[];
  complaints: Complaint[];
  members: Member[];
  devForm: FormState;
  myBids: MyBid[];
  toast: string | null;
  setRole(r: Role): void;
  setAdmin(a: boolean): void;
  setDevForm(s: FormState): void;
  showToast(t: string): void;
  addProject(p: Omit<Project, 'id' | 'ago' | 'bids' | 'status' | 'clientId'>): number;
  addBid(b: MyBid): void;
  startDeal(projectId: number, devId: string, price: number, days: number): string;
  openChat(devId: string): string;
  send(chatId: string, text: string): void;
  readChat(chatId: string): void;
  addComplaint(c: { againstId: string; dealId?: number; reason: ComplaintReason; text: string; evidence: string[] }): number;
  ban(memberId: string, complaintId?: number): string;
  unban(memberId: string): void;
  rejectComplaint(id: number): void;
  takeComplaint(id: number): void;
}

const Ctx = createContext<Store | null>(null);
const now = () => new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
const in30days = () => new Date(Date.now() + 30 * 864e5).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }).replace('.', '');

export function StoreProvider({ children }: { children: ReactNode }) {
  const [role, setRole] = useState<Role>('client');
  const [admin, setAdmin] = useState(true);
  const [projects, setProjects] = useState(PROJECTS);
  const [chats, setChats] = useState(CHATS);
  const [complaints, setComplaints] = useState(COMPLAINTS);
  const [members, setMembers] = useState(MEMBERS);
  const [devForm, setDevForm] = useState<FormState>('none');
  const [myBids, setMyBids] = useState<MyBid[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const timer = useRef<number>();

  const showToast = useCallback((t: string) => {
    setToast(t);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setToast(null), 2600);
  }, []);

  const addProject: Store['addProject'] = useCallback((p) => {
    const id = Math.max(...projects.map((x) => x.id)) + 1;
    setProjects((ps) => [{ ...p, id, ago: 'только что', bids: [], status: 'open', clientId: 'me' }, ...ps]);
    return id;
  }, [projects]);

  const addBid = useCallback((b: MyBid) => {
    setMyBids((bs) => [...bs.filter((x) => x.projectId !== b.projectId), b]);
    setProjects((ps) => ps.map((p) => (p.id === b.projectId
      ? { ...p, bids: [...p.bids.filter((x) => x.devId !== 'timur'), { devId: 'timur', price: b.price, days: b.days, text: b.text, ago: 'только что' }] }
      : p)));
  }, []);

  const openChat = useCallback((devId: string) => {
    const id = `c-${devId}`;
    setChats((cs) => {
      if (cs.some((c) => c.id === id)) return cs;
      const d = DEVS.find((x) => x.id === devId)!;
      return [{ id, peer: { name: d.name, hue: d.hue, lastSeenMin: d.lastSeenMin, role: 'dev', refId: d.id }, unread: 0, messages: [] }, ...cs];
    });
    return id;
  }, []);

  const startDeal = useCallback((projectId: number, devId: string, price: number, days: number) => {
    const p = projects.find((x) => x.id === projectId)!;
    const d = DEVS.find((x) => x.id === devId)!;
    const id = `c-${devId}`;
    const due = new Date(Date.now() + days * 864e5).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }).replace('.', '');
    const dealId = 1049 + Math.floor(Math.random() * 40);
    setProjects((ps) => ps.map((x) => (x.id === projectId ? { ...x, status: 'in_work' } : x)));
    setChats((cs) => {
      const rest = cs.filter((c) => c.id !== id);
      const prev = cs.find((c) => c.id === id);
      return [{
        id, unread: 0,
        peer: { name: d.name, hue: d.hue, lastSeenMin: d.lastSeenMin, role: 'dev', refId: d.id },
        deal: { id: dealId, title: p.title, amount: price, status: 'awaiting_payment', due },
        messages: [...(prev?.messages ?? []),
          { id: Date.now(), from: 'system', text: `Сделка #${dealId} создана. Условия зафиксированы: ${price} USDT, срок ${days} дн. Ожидаем оплату от заказчика.`, time: now() }],
      }, ...rest];
    });
    haptic.success();
    return id;
  }, [projects]);

  const send = useCallback((chatId: string, text: string) => {
    setChats((cs) => cs.map((c) => (c.id === chatId ? { ...c, messages: [...c.messages, { id: Date.now(), from: 'me', text, time: now() }] } : c)));
  }, []);

  const readChat = useCallback((chatId: string) => {
    setChats((cs) => cs.map((c) => (c.id === chatId && c.unread ? { ...c, unread: 0 } : c)));
  }, []);

  const addComplaint: Store['addComplaint'] = useCallback((c) => {
    const id = Math.max(...complaints.map((x) => x.id)) + 1;
    const who = members.find((m) => m.id === c.againstId);
    setComplaints((cs) => [{ id, fromName: 'Вы', againstName: who?.name ?? 'Пользователь', status: 'new', ago: 'только что', ...c }, ...cs]);
    haptic.success();
    return id;
  }, [complaints, members]);

  // first violation: 30 days; repeated: permanent
  const ban = useCallback((memberId: string, complaintId?: number) => {
    const m = members.find((x) => x.id === memberId)!;
    const permanent = m.strikes >= 1;
    const until = permanent ? null : in30days();
    setMembers((ms) => ms.map((x) => (x.id === memberId ? { ...x, strikes: x.strikes + 1, ban: { until } } : x)));
    if (complaintId) {
      const decision = permanent ? 'Повторное нарушение: бессрочная блокировка.' : `Первое нарушение: блокировка до ${until}.`;
      setComplaints((cs) => cs.map((c) => (c.id === complaintId ? { ...c, status: 'resolved', decision } : c)));
    }
    haptic.warning();
    return permanent ? 'Заблокирован навсегда' : `Заблокирован до ${until}`;
  }, [members]);

  const unban = useCallback((memberId: string) => {
    setMembers((ms) => ms.map((x) => (x.id === memberId ? { ...x, ban: undefined } : x)));
    haptic.success();
  }, []);

  const rejectComplaint = useCallback((id: number) => {
    setComplaints((cs) => cs.map((c) => (c.id === id ? { ...c, status: 'rejected', decision: 'Нарушение не подтвердилось.' } : c)));
  }, []);

  const takeComplaint = useCallback((id: number) => {
    setComplaints((cs) => cs.map((c) => (c.id === id && c.status === 'new' ? { ...c, status: 'review' } : c)));
  }, []);

  const value = useMemo<Store>(() => ({
    role, admin, projects, chats, complaints, members, devForm, myBids, toast,
    setRole, setAdmin, setDevForm, showToast, addProject, addBid, startDeal, openChat, send, readChat,
    addComplaint, ban, unban, rejectComplaint, takeComplaint,
  }), [role, admin, projects, chats, complaints, members, devForm, myBids, toast, showToast, addProject, addBid,
    startDeal, openChat, send, readChat, addComplaint, ban, unban, rejectComplaint, takeComplaint]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore() {
  const s = useContext(Ctx);
  if (!s) throw new Error('useStore outside StoreProvider');
  return s;
}
