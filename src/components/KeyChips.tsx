import { useEffect, useRef } from "react";
import { CHROMATIC } from "../utils/chordpro";

export function KeyChips({ active, onSelect }: { active: string | null; onSelect: (key: string) => void }) {
  const activeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    activeRef.current?.scrollIntoView({ inline: "center", block: "nearest" });
  }, [active]);

  return (
    <div className="key-row">
      {CHROMATIC.map((k) => {
        const isActive = k === active;
        return (
          <button
            key={k}
            ref={isActive ? activeRef : undefined}
            className={"key-row-btn" + (isActive ? " active" : "")}
            onClick={() => onSelect(k)}
          >
            {k}
          </button>
        );
      })}
    </div>
  );
}
