export type HeroId = 'technik' | 'tank' | 'sprinter' | 'sniper' | 'medic';
export type RoleIcon = 'crosshair' | 'shield' | 'speed' | 'scope' | 'cross';

export interface Hero {
  id: HeroId;
  model: string;
  name: string;
  role: string;
  roleIcon: RoleIcon;
  text: string;
  abilities: [string, string];
  card: string;
  menu: string;
  color: string;
  runSpeed: number;
}

export const HEROES: Hero[] = [
  {
    id: 'technik', model: 'USER_HERO_Technik', name: 'Техник', role: 'Контроль', roleIcon: 'crosshair',
    text: 'Гаджет-специалист. Держит круг турелью, стреляет очередями.',
    abilities: ['Пистолет-пулемёт: очереди, перегревается', 'Турель: мини-танк сам стреляет 8 с'],
    card: 'ui/card_technik.jpg', menu: 'ui/menu_technik.jpg', color: '#f07a1e', runSpeed: 2.52,
  },
  {
    id: 'tank', model: 'USER_HERO_Tank', name: 'Танк', role: 'Защита', roleIcon: 'shield',
    text: 'Держит удар и прикрывает команду. Врывается тараном.',
    abilities: ['Кулаки: мощный удар, каждый 3-й отбрасывает', 'Таран: рывок вперёд, оглушает врагов'],
    card: 'ui/card_tank.jpg', menu: 'ui/menu_tank.jpg', color: '#9aa649', runSpeed: 1.94,
  },
  {
    id: 'sprinter', model: 'USER_HERO_Sprinter', name: 'Спринтер', role: 'Скорость', roleIcon: 'speed',
    text: 'Быстрая и юркая. Врывается в бой, наносит урон и уходит.',
    abilities: ['Пластинки: две сразу, отскакивают от стен', 'Спурт: три рывка, бьёт всех на пути'],
    card: 'ui/card_sprinter.jpg', menu: 'ui/menu_sprinter.jpg', color: '#e0457b', runSpeed: 3.15,
  },
  {
    id: 'sniper', model: 'USER_HERO_Sniper', name: 'Снайпер', role: 'Дальний бой', roleIcon: 'scope',
    text: 'Бьёт издалека и больно. Пробивает навылет.',
    abilities: ['Винтовка: дальний и сильный выстрел', 'Бронебойный: пуля пробивает всех на линии'],
    card: 'ui/card_sniper.jpg', menu: 'ui/menu_sniper.jpg', color: '#8d7a4f', runSpeed: 2.5,
  },
  {
    id: 'medic', model: 'USER_HERO_Medic', name: 'Медик', role: 'Поддержка', roleIcon: 'cross',
    text: 'Лечит команду и держит её в бою. Без неё круг не удержать.',
    abilities: ['Шприцы: быстрые броски на среднюю дистанцию', 'Аптечка: лечит себя и всех рядом'],
    card: 'ui/card_medic.jpg', menu: 'ui/menu_medic.jpg', color: '#d8382c', runSpeed: 2.89,
  },
];

export const heroById = (id: string): Hero => HEROES.find((h) => h.id === id) ?? HEROES[0];
