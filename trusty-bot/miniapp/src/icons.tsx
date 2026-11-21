import type { CSSProperties } from 'react';
import {
  ArrowLeftRight, Ban, Copy, Crown, Download, ExternalLink, Image, Lightbulb, Share2, UserPlus, BadgeCheck, Bell, BriefcaseBusiness, Check, ChevronLeft, ChevronRight, Circle, CircleCheck, CircleDot,
  CircleX, Clock3, Coins, Ellipsis, Eye, FileText, Flag, Github, Hammer, Handshake, House, Info, Link, Lock, MessageCircle, Minus,
  Paperclip, Plus, Scale, Search, SendHorizontal, ShieldAlert, ShieldCheck, SlidersHorizontal, Star, Trash2, Undo2, UserRound, Wallet, X, Zap,
  type LucideIcon,
} from 'lucide-react';

const I = {
  home: House, devs: Search, projects: BriefcaseBusiness, chats: MessageCircle, profile: UserRound,
  back: ChevronLeft, chevron: ChevronRight, plus: Plus, minus: Minus, search: Search, star: Star, shield: ShieldCheck,
  clock: Clock3, clip: Paperclip, send: SendHorizontal, flag: Flag, ban: Ban, check: Check, x: X, dots: Ellipsis, link: Link,
  bolt: Zap, coin: Coins, doc: FileText, filter: SlidersHorizontal, admin: ShieldAlert, github: Github, info: Info,
  swap: ArrowLeftRight, handshake: Handshake, hammer: Hammer, eye: Eye, wallet: Wallet, done: CircleCheck, current: CircleDot,
  todo: Circle, failed: CircleX, undo: Undo2, scale: Scale, bell: Bell, lock: Lock, badge: BadgeCheck, trash: Trash2,
  copy: Copy, crown: Crown, download: Download, external: ExternalLink, image: Image, tips: Lightbulb, share: Share2, invite: UserPlus,
} satisfies Record<string, LucideIcon>;

export type IconName = keyof typeof I;

export function Icon({ name, size = 22, strokeWidth = 1.75, style, className }: {
  name: IconName; size?: number; strokeWidth?: number; style?: CSSProperties; className?: string;
}) {
  const C = I[name];
  return strokeWidth === 0
    ? <C size={size} strokeWidth={0} fill="currentColor" aria-hidden="true" style={style} className={className} />
    : <C size={size} strokeWidth={strokeWidth} aria-hidden="true" style={style} className={className} />;
}
