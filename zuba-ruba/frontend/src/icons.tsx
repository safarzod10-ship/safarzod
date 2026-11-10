import type { ReactNode } from "react";

function Svg({ children, size = 24 }: { children: ReactNode; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

export const IconHome = ({ size }: { size?: number }) => (
  <Svg size={size}>
    <path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-4.5v-6h-5v6H5a1 1 0 0 1-1-1z" />
  </Svg>
);

export const IconTasks = ({ size }: { size?: number }) => (
  <Svg size={size}>
    <path d="M9 6h11M9 12h11M9 18h11" />
    <path d="m3.5 6 1.2 1.2L6.8 5M3.5 12l1.2 1.2 2.1-2.2M3.5 18l1.2 1.2 2.1-2.2" />
  </Svg>
);

export const IconCase = ({ size }: { size?: number }) => (
  <Svg size={size}>
    <path d="M3.5 9h17v10a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1z" />
    <path d="M2.5 5.5a1 1 0 0 1 1-1h17a1 1 0 0 1 1 1V9h-19z" />
    <path d="M10 13h4" />
  </Svg>
);

export const IconUser = ({ size }: { size?: number }) => (
  <Svg size={size}>
    <circle cx="12" cy="8" r="4" />
    <path d="M4 20.5c1.4-3.6 4.4-5.5 8-5.5s6.6 1.9 8 5.5" />
  </Svg>
);

export const IconBell = ({ size }: { size?: number }) => (
  <Svg size={size}>
    <path d="M6 16.5V11a6 6 0 1 1 12 0v5.5l1.5 2h-15z" />
    <path d="M10 20.5a2.2 2.2 0 0 0 4 0" />
  </Svg>
);

export const IconChevron = ({ size = 20 }: { size?: number }) => (
  <Svg size={size}>
    <path d="m9 5 7 7-7 7" />
  </Svg>
);

export const IconCopy = ({ size = 20 }: { size?: number }) => (
  <Svg size={size}>
    <rect x="8" y="8" width="12" height="12" rx="2" />
    <path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3" />
  </Svg>
);

export const IconCheck = ({ size = 20 }: { size?: number }) => (
  <Svg size={size}>
    <path d="m5 12.5 4.5 4.5L19 7.5" />
  </Svg>
);

export const IconRefresh = ({ size = 20 }: { size?: number }) => (
  <Svg size={size}>
    <path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3" />
    <path d="M19.5 4.5v4h-4" />
  </Svg>
);

export const IconExternal = ({ size = 16 }: { size?: number }) => (
  <Svg size={size}>
    <path d="M14 5h5v5M19 5l-8 8" />
    <path d="M18 14v4a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h4" />
  </Svg>
);

export const IconShare = ({ size = 20 }: { size?: number }) => (
  <Svg size={size}>
    <path d="M12 15V4M8 8l4-4 4 4" />
    <path d="M5 12v7a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-7" />
  </Svg>
);

export const IconGift = ({ size }: { size?: number }) => (
  <Svg size={size}>
    <path d="M4 11h16v9a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1zM3 7h18v4H3zM12 7v14" />
    <path d="M12 7c-1.5-3.5-5.5-3.5-5.5-1S10 7 12 7c2 0 5.5.5 5.5-1s-4-2.5-5.5 1" />
  </Svg>
);

export const IconChannel = ({ size }: { size?: number }) => (
  <Svg size={size}>
    <path d="M4 12.5 20 5l-3.5 14.5-5-4.5-2.5 3.5v-5.2L20 5" />
  </Svg>
);

export const IconBot = ({ size }: { size?: number }) => (
  <Svg size={size}>
    <rect x="4.5" y="8" width="15" height="11.5" rx="3.5" />
    <path d="M12 8V4.5M9.5 13.5h.01M14.5 13.5h.01M2.5 13v2M21.5 13v2" />
  </Svg>
);

export const IconBolt = ({ size }: { size?: number }) => (
  <Svg size={size}>
    <path d="M13 3 5.5 13.5H11L10 21l7.5-10.5H12z" />
  </Svg>
);

export const IconSearch = ({ size }: { size?: number }) => (
  <Svg size={size}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m20 20-4.2-4.2" />
  </Svg>
);

export const IconArrowDown = ({ size }: { size?: number }) => (
  <Svg size={size}>
    <path d="M12 5v14M6 13l6 6 6-6" />
  </Svg>
);

export const IconArrowUp = ({ size }: { size?: number }) => (
  <Svg size={size}>
    <path d="M12 19V5M6 11l6-6 6 6" />
  </Svg>
);

export const IconUndo = ({ size }: { size?: number }) => (
  <Svg size={size}>
    <path d="M9 14 4 9l5-5" />
    <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
  </Svg>
);

export const IconUsers = ({ size }: { size?: number }) => (
  <Svg size={size}>
    <circle cx="9" cy="8.5" r="3.5" />
    <path d="M2.5 20c.6-3.4 3.2-5.5 6.5-5.5s5.9 2.1 6.5 5.5M16 5.2a3.5 3.5 0 0 1 0 6.6M18 14.8c1.9.8 3.1 2.6 3.5 5.2" />
  </Svg>
);

export const IconBook = ({ size }: { size?: number }) => (
  <Svg size={size}>
    <path d="M5 4.5A1.5 1.5 0 0 1 6.5 3H19v15H6.5A1.5 1.5 0 0 0 5 19.5zM5 19.5A1.5 1.5 0 0 0 6.5 21H19M9 7h6" />
  </Svg>
);

export const IconChat = ({ size }: { size?: number }) => (
  <Svg size={size}>
    <path d="M20 12a8 8 0 0 1-11.6 7.1L4 20l1-4A8 8 0 1 1 20 12z" />
  </Svg>
);

export const IconClock = ({ size }: { size?: number }) => (
  <Svg size={size}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5V12l3 2" />
  </Svg>
);

export const IconShield = ({ size }: { size?: number }) => (
  <Svg size={size}>
    <path d="M12 3 5 6v5.5c0 4.3 2.9 8 7 9.5 4.1-1.5 7-5.2 7-9.5V6z" />
  </Svg>
);

export const IconStarLine = ({ size }: { size?: number }) => (
  <Svg size={size}>
    <path d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z" />
  </Svg>
);

export const IconPlus = ({ size }: { size?: number }) => (
  <Svg size={size}>
    <path d="M12 5v14M5 12h14" />
  </Svg>
);
