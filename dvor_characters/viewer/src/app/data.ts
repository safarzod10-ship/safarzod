/**
 * Heroes and profile shown in the Mini App shell.
 * From the customer's mockup: names, Technik's role / text / stats, rank "Серебро II" 1 240,
 * the HP numbers over the heroes in the battle screen.
 * PLACEHOLDERS (not in the mockup, to be set by game design): Tank and Sprinter role names,
 * descriptions and stats.
 */
export type HeroId = 'technik' | 'tank' | 'sprinter';
export type RoleIcon = 'crosshair' | 'shield' | 'speed';

export interface Hero {
  id: HeroId;
  model: string;            // 3D model id (dist/<model>.glb)
  name: string;
  role: string;
  roleIcon: RoleIcon;
  text: string;
  stats: [number, number, number, number, number];   // Здоровье, Урон, Скорость, Защита, Контроль (0..5)
  card: string;             // portrait for the cards / avatars
  detail: string;           // portrait for the info panel
  hp: number;               // shown over the hero in battle
  color: string;
  runSpeed: number;         // m/s, foot-matched (docs/RUN.md)
}

export const STAT_NAMES = ['Здоровье', 'Урон', 'Скорость', 'Защита', 'Контроль'] as const;

export const HEROES: Hero[] = [
  {
    id: 'technik', model: 'USER_CH_Technik', name: 'Техник', role: 'Контроль', roleIcon: 'crosshair',
    text: 'Гаджет-специалист. Держит ситуацию под контролем на средней дистанции.',
    stats: [3, 3, 4, 3, 5], card: 'ui/card_technik.jpg', detail: 'ui/detail_technik.jpg', hp: 4800,
    color: '#f07a1e', runSpeed: 2.35,
  },
  {
    id: 'tank', model: 'USER_CH_Tank', name: 'Танк', role: 'Защита', roleIcon: 'shield',
    text: 'Держит удар и прикрывает команду в ближнем бою.',                      // placeholder
    stats: [5, 3, 2, 5, 2], card: 'ui/card_tank.jpg', detail: 'ui/card_tank.jpg', hp: 5600,   // placeholder stats
    color: '#9aa649', runSpeed: 1.78,
  },
  {
    id: 'sprinter', model: 'USER_CH_Sprinter', name: 'Спринтер', role: 'Скорость', roleIcon: 'speed',
    text: 'Быстрая и юркая. Врывается в бой, наносит урон и уходит.',             // placeholder
    stats: [2, 4, 5, 2, 3], card: 'ui/card_sprinter.jpg', detail: 'ui/card_sprinter.jpg', hp: 4400, // placeholder stats
    color: '#c55be0', runSpeed: 2.72,
  },
];

export const PROFILE = { rank: 'Серебро II', trophies: 1240 };   // from the mockup (placeholder data)

export const heroById = (id: string): Hero => HEROES.find((h) => h.id === id) ?? HEROES[0];
