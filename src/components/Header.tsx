import type { ReactNode } from "react";
import { useNavigator } from "../navigation/Navigator";
import { Icon } from "./Icon";

export function Header({
  title,
  tinted,
  right,
  onBack,
  large,
}: {
  title: string;
  tinted?: boolean;
  right?: ReactNode;
  onBack?: () => void;
  /** iOS-style Large Title: the small bar carries only the back/action
   * controls, and `title` renders as a big bold line beneath it. */
  large?: boolean;
}) {
  const nav = useNavigator();
  const showBack = Boolean(onBack) || nav.canPop;
  const backButton = showBack ? (
    <button className="hdr-btn" onClick={onBack ?? nav.pop} aria-label="Back">
      <Icon name="chevron-left" size={20} strokeWidth={2} />
    </button>
  ) : (
    // Reserves the same box the back button would occupy, so tab-root
    // screens (no back target) don't shift title/action alignment.
    <div className="hdr-btn" aria-hidden="true" />
  );

  if (large) {
    return (
      <div className={"hdr-large-wrap" + (tinted ? " tinted" : "")}>
        <div className="hdr">
          {backButton}
          <div className="flex-1" />
          {right}
        </div>
        <div className="hdr-large-title">{title}</div>
      </div>
    );
  }
  return (
    <div className={"hdr" + (tinted ? " tinted" : "")}>
      {backButton}
      <div className="hdr-title">{title}</div>
      {right}
    </div>
  );
}
