/**
 * Heroes shown in the Mini App shell: the customer's five characters (second Tripo set) with their
 * menu art (public/ui/menu_<id>.jpg, cropped from the customer's screens) and a portrait card cut
 * from it. Stats (0..5) are derived from the kit numbers in game/kits.ts.
 */
export type HeroId = 'technik' | 'tank' | 'sprinter' | 'sniper' | 'medic';
export type RoleIcon = 'crosshair' | 'shield' | 'speed' | 'scope' | 'cross';

export interface Hero {
  id: HeroId;
  model: string;            // 3D model id (dist/<model>.glb)
  name: string;
  role: string;
  roleIcon: RoleIcon;
  text: string;
  abilities: [string, string, string];   // attack, ability 1, ability 2 (one line each)
  stats: [number, number, number, number, number];   // Здоровье, Урон, Скорость, Защита, Контроль (0..5)
  card: string;             // portrait for the cards / avatars
  menu: string;             // full menu art (home screen)
  color: string;
  runSpeed: number;         // m/s at which the mocap Run clip keeps the planted foot still
}

export const STAT_NAMES = ['Здоровье', 'Урон', 'Скорость', 'Защита', 'Контроль'] as const;

export const HEROES: Hero[] = [
  {
    id: 'technik', model: 'USER_HERO_Technik', name: 'Техник', role: 'Контроль', roleIcon: 'crosshair',
    text: 'Гаджет-специалист. Держит круг турелью и дымом, стреляет очередями.',
    abilities: ['Пистолет-пулемёт: очереди, перегревается', 'Турель: мини-танк сам стреляет 8 с', 'Дымовая шашка: враги в дыму медленнее'],
    stats: [3, 3, 3, 2, 5], card: 'ui/card_technik.jpg', menu: 'ui/menu_technik.jpg', color: '#f07a1e', runSpeed: 2.52,
  },
  {
    id: 'tank', model: 'USER_HERO_Tank', name: 'Танк', role: 'Защита', roleIcon: 'shield',
    text: 'Держит удар и прикрывает команду. Таранит и закрывает дверью от пуль.',
    abilities: ['Кулаки: мощный удар, каждый 3-й отбрасывает', 'Гаражная дверь: щит от выстрелов спереди', 'Таран: рывок, оглушает врагов'],
    stats: [5, 4, 1, 5, 3], card: 'ui/card_tank.jpg', menu: 'ui/menu_tank.jpg', color: '#9aa649', runSpeed: 1.94,
  },
  {
    id: 'sprinter', model: 'USER_HERO_Sprinter', name: 'Спринтер', role: 'Скорость', roleIcon: 'speed',
    text: 'Быстрая и юркая. Врывается в бой, наносит урон и уходит.',
    abilities: ['Пластинки: две сразу, отскакивают от стен', 'Спурт: три рывка, бьёт на пути', 'На всю громкость: волна отталкивает'],
    stats: [2, 3, 5, 2, 3], card: 'ui/card_sprinter.jpg', menu: 'ui/menu_sprinter.jpg', color: '#e0457b', runSpeed: 3.15,
  },
  {
    id: 'sniper', model: 'USER_HERO_Sniper', name: 'Снайпер', role: 'Дальний бой', roleIcon: 'scope',
    text: 'Бьёт издалека и больно. Ставит растяжки и пробивает навылет.',
    abilities: ['Винтовка: дальний и сильный выстрел', 'Растяжка: мина оглушает и ранит', 'Бронебойный: пуля пробивает всех на линии'],
    stats: [2, 5, 2, 2, 3], card: 'ui/card_sniper.jpg', menu: 'ui/menu_sniper.jpg', color: '#8d7a4f', runSpeed: 2.5,
  },
  {
    id: 'medic', model: 'USER_HERO_Medic', name: 'Медик', role: 'Поддержка', roleIcon: 'cross',
    text: 'Лечит команду и держит её в бою. Без неё круг не удержать.',
    abilities: ['Шприцы: быстрые броски на среднюю дистанцию', 'Аптечка: лечит себя и всех рядом', 'Полевой госпиталь: зона лечения 5 с'],
    stats: [3, 2, 4, 3, 4], card: 'ui/card_medic.jpg', menu: 'ui/menu_medic.jpg', color: '#d8382c', runSpeed: 2.89,
  },
];

export const heroById = (id: string): Hero => HEROES.find((h) => h.id === id) ?? HEROES[0];
