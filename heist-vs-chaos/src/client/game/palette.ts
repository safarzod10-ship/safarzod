// One art system for everything: cream paper, sage, terracotta, mint, muted gold.
export const C = {
  paper: '#FBF6EA',
  cream: '#F3EAD6',
  creamDeep: '#E8DCC0',
  creamShade: '#D6C7A6',
  sageLight: '#C5D8C1',
  sage: '#8FAE8B',
  sageDark: '#5E7F66',
  sageDeep: '#3F5A4A',
  terracotta: '#C8694E',
  terracottaLight: '#E09A80',
  terracottaDark: '#9E4A35',
  mint: '#8FD3B6',
  mintLight: '#C8EEDD',
  mintGlow: '#B9F5DC',
  gold: '#C9A55A',
  goldLight: '#E6CF95',
  goldDark: '#9C7C38',
  ink: '#2F3B36',
  peach: '#EBC9A5',
  wood: '#B8875A',
  woodDark: '#8A6140',
  night: '#2E4140',
  nightDeep: '#1F2E2E',
  laser: '#E2553D',
  white: '#FFFFFF',
} as const;

export interface WallPalette {
  wall: string;
  wallDark: string;
  trim: string;
  floor: string;
  floorDark: string;
  accent: string;
}

export const WALLS: WallPalette[] = [
  { wall: '#EFE4CB', wallDark: '#DCCDAA', trim: '#8FAE8B', floor: '#C9A87C', floorDark: '#A9875D', accent: '#C8694E' },
  { wall: '#D5E3CF', wallDark: '#B7CDB0', trim: '#5E7F66', floor: '#B79B73', floorDark: '#957A55', accent: '#C9A55A' },
  { wall: '#F0D7C8', wallDark: '#DDB9A5', trim: '#9E4A35', floor: '#A9B79C', floorDark: '#87977A', accent: '#5E7F66' },
  { wall: '#D3ECE0', wallDark: '#B1D6C4', trim: '#3F5A4A', floor: '#C7B08A', floorDark: '#A48D68', accent: '#C8694E' },
  { wall: '#F1E3BD', wallDark: '#DCC995', trim: '#9C7C38', floor: '#9FB39A', floorDark: '#7E9379', accent: '#3F5A4A' },
  { wall: '#C9D6CB', wallDark: '#A9BCAD', trim: '#2F3B36', floor: '#B6967A', floorDark: '#94765B', accent: '#E09A80' },
];

export const hex = (c: string): number => Number.parseInt(c.slice(1), 16);
export const css = (n: number): string => `#${n.toString(16).padStart(6, '0')}`;

/** Geometry shared by renderer and animation code (room-local coordinates, 1280x720 rooms). */
export const G = {
  W: 1280,
  H: 720,
  floorY: 540,
  ledgeY: 318,
  startX: 190,
  exitX: 1180,
  rows: [482, 516, 550, 584],
} as const;
