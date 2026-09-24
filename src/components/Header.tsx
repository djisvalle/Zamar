import { useEffect, useRef, useState, type ReactNode } from "react";
import { useNavigator, type Frame } from "../navigation/Navigator";
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
  /** iOS-style Large Title: the small bar carries only the back/action
   * controls, and `title` renders as a big bold line beneath it. */
  large?: boolean;
}) {
  const nav = useNavigator();
  const { state } = useStore();
  const ref = useRef<HTMLDivElement>(null);
  const scrolled = useScrolledUnder(ref);
  const showBack = Boolean(onBack) || nav.canPop;
  const label = backLabel ?? previousTitle(nav.stack[nav.stack.length - 2], state);
  const backButton = showBack ? (
    <button className="hdr-back" onClick={onBack ?? nav.pop} aria-label={`Back to ${label}`}>
      <Icon name="chevron-left" size={24} strokeWidth={2.4} />
      <span>{label}</span>
    </button>
  ) : (
    <span />
  );
  const classes = (base: string) => base + (tinted ? " tinted" : "") + (scrolled ? " scrolled" : "");

  if (large) {
    return (
      <div ref={ref} className={classes("hdr-large-wrap")}>
        <div className="hdr">
          {backButton}
          <div className="hdr-right">{right}</div>
        </div>
        <div className="hdr-large-title">{title}</div>
      </div>
    );
  }
  return (
    <div ref={ref} className={classes("hdr")}>
      {backButton}
      <div className="hdr-title">{title}</div>
      <div className="hdr-right">{right}</div>
    </div>
  );
}

/** True once any scroll area on the header's screen has scrolled away from
 * the top, which is when iOS gives the nav bar its material and hairline.
 * Scroll events don't bubble, so this listens in the capture phase. */
function useScrolledUnder(ref: React.RefObject<HTMLElement>) {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const screen = ref.current?.closest(".screen");
    if (!screen) return;
    const onScroll = (e: Event) => {
      const target = e.target as HTMLElement;
      // Only the screen's own scroll areas, not ones inside sheets/popovers.
      if (!(target instanceof HTMLElement) || target.closest(".backdrop, .popover")) return;
      setScrolled(target.scrollTop > 0);
    };
    screen.addEventListener("scroll", onScroll, true);
    return () => screen.removeEventListener("scroll", onScroll, true);
  }, [ref]);
  return scrolled;
}
