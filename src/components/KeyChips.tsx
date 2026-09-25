import { useEffect, useRef } from "react";
import { useStore } from "../state/store";
import { KEYS, keySemitoneShift, prettyAccidentals } from "../utils/keys";

function formatOffset(n: number): string {
  if (n === 0) return "0";
  return n > 0 ? `+${n}` : `−${-n}`;
}

/** Every key with a key signature (C# and Db both, and so on), each with
 * its relative minor underneath. The chip picked sets how the chart is
 * spelled. `offsetFrom` is the key the chart is written in; with Settings →
 * Keys "Show key offsets" on, each chip also shows its move from it. */
export function KeyChips({
  active,
  onSelect,
  disabled = false,
  offsetFrom,
}: {
  active: string | null;
  onSelect: (key: string) => void;
  disabled?: boolean;
  offsetFrom?: string;
}) {
  const { state } = useStore();
  const activeRef = useRef<HTMLButtonElement>(null);
  const showOffsets = state.settings.showKeyOffsets && !!offsetFrom && offsetFrom !== "—";

  useEffect(() => {
    activeRef.current?.scrollIntoView({ inline: "center", block: "nearest" });
  }, [active]);

  return (
    <div className="key-row">
      {KEYS.map(({ name, minor }) => {
        const isActive = name === active;
        const offset = showOffsets ? formatOffset(keySemitoneShift(offsetFrom!, name)) : null;
        return (
          <button
            key={name}
            ref={isActive ? activeRef : undefined}
            className={"key-row-btn" + (isActive ? " active" : "")}
            disabled={disabled}
            aria-label={`${prettyAccidentals(name)} major` + (offset ? `, ${offset}` : "")}
            aria-pressed={isActive}
            onClick={() => onSelect(name)}
          >
            {offset !== null && <span className="key-row-offset">{offset}</span>}
            <span className="key-row-key">{prettyAccidentals(name)}</span>
            <span className="key-row-minor">{prettyAccidentals(minor)}</span>
          </button>
        );
      })}
    </div>
  );
}
