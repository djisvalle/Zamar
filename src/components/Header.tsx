import { useEffect, useRef, useState, type ReactNode } from "react";
import { useFrame, useNavigator, type Frame } from "../navigation/Navigator";
import { useStore, type AppState } from "../state/store";
import { Icon } from "./Icon";

const SCREEN_TITLES: Partial<Record<Frame["screen"], string>> = {
  "live-stage": "Live Stage",
  library: "Library",
  setlists: "Setlists",
  tuner: "Tuner",
  settings: "Settings",
  appearance: "Appearance",
  export: "Export set",
};

/** iOS labels the back button with the previous screen's title, falling
 * back to "Back" when that title is unknown or too long to fit. */
function previousTitle(frame: Frame | undefined, state: AppState): string {
  if (!frame) return "Back";
  const title =
    frame.screen === "setlist-detail"
      ? state.setlists.find((s) => s.id === frame.params?.setlistId)?.name
      : SCREEN_TITLES[frame.screen];
  return title && title.length <= 14 ? title : "Back";
}

export function Header({
  title,
  tinted,
  right,
  onBack,
  backLabel,
  large,
}: {
  title: string;
  tinted?: boolean;
  right?: ReactNode;
  onBack?: () => void;
  /** Overrides the back button's label, for a back that returns to an
   * earlier step of the same screen rather than to the previous frame. */
  backLabel?: string;
  /** iOS Large Title: the screen renders `<LargeTitle>` at the top of its
   * scroll area, and the bar shows `title` small only once that has
   * scrolled under it. */
  large?: boolean;
}) {
  const nav = useNavigator();
  const own = useFrame();
  const { state } = useStore();
  const ref = useRef<HTMLDivElement>(null);
  const depth = useScrollDepth(ref);
  const collapsed = large ? depth === 2 : false;
  const scrolled = large ? collapsed : depth > 0;
  const showBack = Boolean(onBack) || own.canPop;
  const label = backLabel ?? previousTitle(own.previous, state);
  const backButton = showBack ? (
    <button className="hdr-back" onClick={onBack ?? nav.pop} aria-label={`Back to ${label}`}>
      <Icon name="chevron-left" size={24} strokeWidth={2.4} />
      <span>{label}</span>
    </button>
  ) : (
    <span />
  );

  return (
    <div
      ref={ref}
      className={"hdr" + (tinted ? " tinted" : "") + (scrolled ? " scrolled" : "") + (collapsed ? " collapsed" : "")}
    >
      {backButton}
      <div className={"hdr-title" + (large ? " hdr-title--collapsible" : "")} aria-hidden={large && !collapsed}>
        {title}
      </div>
      <div className="hdr-right">{right}</div>
    </div>
  );
}

/** How far the header's screen has scrolled: 0 at the top, 1 once content
 * is under the bar (iOS gives it its material and hairline), 2 once a large
 * title (41pt plus padding) has gone under it and collapses into the bar.
 * Scroll events don't bubble, so this listens in the capture phase. */
function useScrollDepth(ref: React.RefObject<HTMLElement>) {
  const [depth, setDepth] = useState<0 | 1 | 2>(0);
  useEffect(() => {
    const screen = ref.current?.closest(".screen");
    if (!screen) return;
    const onScroll = (e: Event) => {
      const target = e.target as HTMLElement;
      // Only the screen's own scroll areas, not ones inside sheets/popovers
      // or sideways chip rows.
      if (!(target instanceof HTMLElement) || target.closest(".backdrop, .popover, .chip-row")) return;
      const top = target.scrollTop;
      setDepth(top > 44 ? 2 : top > 0 ? 1 : 0);
    };
    screen.addEventListener("scroll", onScroll, true);
    return () => screen.removeEventListener("scroll", onScroll, true);
  }, [ref]);
  return depth;
}
