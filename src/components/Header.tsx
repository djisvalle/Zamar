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
  if (large) {
    return (
      <div className={"hdr-large-wrap" + (tinted ? " tinted" : "")}>
        <div className="hdr">
          <button className="hdr-btn" onClick={onBack ?? nav.pop} aria-label="Back">
            <Icon name="chevron-left" size={20} strokeWidth={2} />
          </button>
          <div className="flex-1" />
          {right}
        </div>
        <div className="hdr-large-title">{title}</div>
      </div>
    );
  }
  return (
    <div className={"hdr" + (tinted ? " tinted" : "")}>
      <button className="hdr-btn" onClick={onBack ?? nav.pop} aria-label="Back">
        <Icon name="chevron-left" size={20} strokeWidth={2} />
      </button>
      <div className="hdr-title">{title}</div>
      {right}
    </div>
  );
}
