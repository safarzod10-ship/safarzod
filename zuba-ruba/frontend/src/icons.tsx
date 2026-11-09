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
