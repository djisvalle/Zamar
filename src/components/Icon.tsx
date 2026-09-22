export type IconName =
  | "menu"
  | "chevron-left"
  | "chevron-right"
  | "close"
  | "search"
  | "star"
  | "check"
  | "more"
  | "import"
  | "share"
  | "edit"
  | "annotate"
  | "music"
  | "list"
  | "tuner"
  | "settings"
  | "note"
  | "grip"
  | "home"
  | "play"
  | "stop"
  | "eraser"
  | "square"
  | "plus"
  | "cursor"
  | "highlighter"
  | "text"
  | "shapes"
  | "duplicate"
  | "trash"
  | "fermata"
  | "bow-up"
  | "bow-down";

/**
 * One small, hand-drawn icon set (Feather-style: 24x24 grid, round caps/joins)
 * so every glyph in the app shares the same stroke weight and optical size —
 * replaces the mix of Unicode dingbats (☰ ♪ ▤ 〰 ⚙ ✎ ⇩ …) that previously stood
 * in for icons and rendered inconsistently across fonts/platforms.
 */
export function Icon({
  name,
  size = 18,
  strokeWidth = 1.75,
  filled = false,
}: {
  name: IconName;
  size?: number;
  strokeWidth?: number;
  /** Fills the star (favourite) glyph instead of outlining it. */
  filled?: boolean;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ display: "block", flexShrink: 0 }}
      aria-hidden="true"
    >
      {name === "star" ? (
        <polygon
          points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"
          fill={filled ? "currentColor" : "none"}
        />
      ) : (
        ICON_PATHS[name]
      )}
    </svg>
  );
}

const ICON_PATHS: Record<IconName, JSX.Element> = {
  menu: (
    <>
      <line x1="3" y1="6" x2="21" y2="6" />
      <line x1="3" y1="12" x2="21" y2="12" />
      <line x1="3" y1="18" x2="21" y2="18" />
    </>
  ),
  "chevron-left": <polyline points="15 18 9 12 15 6" />,
  "chevron-right": <polyline points="9 18 15 12 9 6" />,
  close: (
    <>
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <line x1="21" y1="21" x2="16.2" y2="16.2" />
    </>
  ),
  star: <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />,
  check: <polyline points="20 6 9 17 4 12" />,
  more: (
    <g fill="currentColor" stroke="none">
      <circle cx="5" cy="12" r="1.6" />
      <circle cx="12" cy="12" r="1.6" />
      <circle cx="19" cy="12" r="1.6" />
    </g>
  ),
  import: (
    <>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </>
  ),
  share: (
    <>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </>
  ),
  edit: <path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />,
  annotate: (
    <>
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
      <line x1="12" y1="20" x2="21" y2="20" />
    </>
  ),
  music: (
    <>
      <path d="M9 18V5l12-2v13" />
      <circle cx="6" cy="18" r="3" />
      <circle cx="18" cy="16" r="3" />
    </>
  ),
  list: (
    <>
      <line x1="8" y1="6" x2="21" y2="6" />
      <line x1="8" y1="12" x2="21" y2="12" />
      <line x1="8" y1="18" x2="21" y2="18" />
      <line x1="3" y1="6" x2="3.01" y2="6" />
      <line x1="3" y1="12" x2="3.01" y2="12" />
      <line x1="3" y1="18" x2="3.01" y2="18" />
    </>
  ),
  tuner: <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />,
  settings: (
    <>
      <circle cx="12" cy="12" r="3.2" />
      <line x1="12" y1="4" x2="12" y2="1.5" />
      <line x1="18.9" y1="8" x2="21.1" y2="6.7" />
      <line x1="18.9" y1="16" x2="21.1" y2="17.3" />
      <line x1="12" y1="20" x2="12" y2="22.5" />
      <line x1="5.1" y1="16" x2="2.9" y2="17.3" />
      <line x1="5.1" y1="8" x2="2.9" y2="6.7" />
    </>
  ),
  note: <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />,
  grip: (
    <g fill="currentColor" stroke="none">
      <circle cx="9" cy="5" r="1.5" />
      <circle cx="15" cy="5" r="1.5" />
      <circle cx="9" cy="12" r="1.5" />
      <circle cx="15" cy="12" r="1.5" />
      <circle cx="9" cy="19" r="1.5" />
      <circle cx="15" cy="19" r="1.5" />
    </g>
  ),
  home: (
    <>
      <path d="M3 10.5 12 3l9 7.5" />
      <path d="M5 9.5V20a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V9.5" />
    </>
  ),
  play: <polygon points="5 3 19 12 5 21 5 3" fill="currentColor" stroke="none" />,
  stop: <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" stroke="none" />,
  eraser: (
    <g transform="rotate(45 12 12)">
      <rect x="5.5" y="8.5" width="13" height="7" rx="1.5" />
      <line x1="5.5" y1="12" x2="18.5" y2="12" />
    </g>
  ),
  square: <rect x="5" y="5" width="14" height="14" rx="2" />,
  plus: (
    <>
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </>
  ),
  cursor: <polygon points="5 3 5 19 9.5 15.5 12.5 21 15 19.5 12 14 17.5 13.5" fill="currentColor" stroke="none" />,
  highlighter: (
    <>
      <path d="M6.5 14.5 15 6l3 3-8.5 8.5H6.5v-3z" />
      <line x1="4" y1="21" x2="10.5" y2="21" />
    </>
  ),
  text: (
    <>
      <polyline points="4 6.5 4 4 20 4 20 6.5" />
      <line x1="12" y1="4" x2="12" y2="20" />
      <line x1="8.5" y1="20" x2="15.5" y2="20" />
    </>
  ),
  shapes: (
    <>
      <rect x="3.5" y="3.5" width="10.5" height="10.5" rx="2" />
      <circle cx="16.5" cy="16.5" r="5.5" />
    </>
  ),
  duplicate: (
    <>
      <rect x="8" y="8" width="13" height="13" rx="2" />
      <path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3" />
    </>
  ),
  trash: (
    <>
      <polyline points="4 7 20 7" />
      <path d="M6 7l1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13" />
      <path d="M9.5 7V4.5a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1V7" />
    </>
  ),
  fermata: (
    <>
      <path d="M4 15a8 8 0 0 1 16 0" />
      <circle cx="12" cy="11.5" r="1.1" fill="currentColor" stroke="none" />
    </>
  ),
  "bow-up": <polyline points="6 8 12 17 18 8" />,
  "bow-down": <polyline points="6 8 6 15 18 15 18 8" />,
};
