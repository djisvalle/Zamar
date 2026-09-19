import type { ReactNode } from "react";
import { useNavigator } from "../navigation/Navigator";
import { Icon } from "./Icon";

export function Header({
  title,
  tinted,
  right,
  onBack,
}: {
  title: string;
  tinted?: boolean;
  right?: ReactNode;
  onBack?: () => void;
}) {
  const nav = useNavigator();
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
