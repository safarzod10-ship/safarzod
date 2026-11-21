import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { haptic, tg } from './tg';

export type Tab = 'home' | 'devs' | 'projects' | 'chats' | 'profile';
export interface Route {
  name: string;
  params?: Record<string, unknown>;
  key: number;
}

interface Nav {
  tab: Tab;
  route: Route;
  depth: number;
  push(name: string, params?: Record<string, unknown>): void;
  replace(name: string, params?: Record<string, unknown>): void;
  pop(): void;
  popWith(params: Record<string, unknown>): void;
  setTab(t: Tab): void;
  open(t: Tab, name: string, params?: Record<string, unknown>): void;
}

const ROOTS: Record<Tab, string> = { home: 'home', devs: 'devs', projects: 'projects', chats: 'chats', profile: 'profile' };
let seq = 1;
const mk = (name: string, params?: Record<string, unknown>): Route => ({ name, params, key: seq++ });

const Ctx = createContext<Nav | null>(null);

export function NavProvider({ children }: { children: ReactNode }) {
  const [tab, setTabState] = useState<Tab>('home');
  const [stacks, setStacks] = useState<Record<Tab, Route[]>>(() => ({
    home: [mk('home')], devs: [mk('devs')], projects: [mk('projects')], chats: [mk('chats')], profile: [mk('profile')],
  }));
  const stack = stacks[tab];

  const push = useCallback((name: string, params?: Record<string, unknown>) => {
    haptic.tap();
    setStacks((s) => ({ ...s, [tab]: [...s[tab], mk(name, params)] }));
    window.scrollTo(0, 0);
  }, [tab]);

  const replace = useCallback((name: string, params?: Record<string, unknown>) => {
    setStacks((s) => ({ ...s, [tab]: [...s[tab].slice(0, -1), mk(name, params)] }));
    window.scrollTo(0, 0);
  }, [tab]);

  const pop = useCallback(() => {
    setStacks((s) => (s[tab].length > 1 ? { ...s, [tab]: s[tab].slice(0, -1) } : s));
  }, [tab]);

  const popWith = useCallback((params: Record<string, unknown>) => {
    setStacks((s) => {
      if (s[tab].length < 2) return s;
      const st = s[tab].slice(0, -1);
      const top = st[st.length - 1];
      st[st.length - 1] = mk(top.name, { ...top.params, ...params });
      return { ...s, [tab]: st };
    });
  }, [tab]);

  const setTab = useCallback((t: Tab) => {
    haptic.select();
    if (t === tab) setStacks((s) => ({ ...s, [t]: [s[t][0]] }));
    setTabState(t);
    window.scrollTo(0, 0);
  }, [tab]);

  const open = useCallback((t: Tab, name: string, params?: Record<string, unknown>) => {
    haptic.tap();
    setStacks((s) => ({ ...s, [t]: [mk(ROOTS[t]), mk(name, params)] }));
    setTabState(t);
    window.scrollTo(0, 0);
  }, []);

  useEffect(() => {
    if (!tg) return;
    if (stack.length > 1) {
      tg.BackButton.show();
      tg.BackButton.onClick(pop);
      return () => tg!.BackButton.offClick(pop);
    }
    tg.BackButton.hide();
  }, [stack.length, pop]);

  const value = useMemo<Nav>(() => ({ tab, route: stack[stack.length - 1], depth: stack.length, push, replace, pop, popWith, setTab, open }),
    [tab, stack, push, replace, pop, popWith, setTab, open]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useNav() {
  const n = useContext(Ctx);
  if (!n) throw new Error('useNav outside NavProvider');
  return n;
}
