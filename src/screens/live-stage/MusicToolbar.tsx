import { KeyChips } from "../../components/KeyChips";
import { Icon } from "../../components/Icon";
import { useStore } from "../../state/store";

export function MusicToolbar({ onOpenTools }: { onOpenTools: () => void }) {
  const { state, dispatch } = useStore();
  const { stage } = state;
  const key = stage.dispKey ?? "C";

  return (
    <div
      className="glass"
      style={{
        position: "absolute",
        left: 10,
        right: 10,
        // Floats just above the tab bar, which has room reserved as --tab-clear.
        bottom: "max(var(--tab-clear), calc(env(safe-area-inset-bottom, 0px) + 10px))",
        borderRadius: 26,
        zIndex: 6,
        padding: 6,
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <KeyChips active={key} onSelect={(k) => dispatch({ type: "STAGE_SET_KEY", key: k })} />
        </div>
        <button
          onClick={onOpenTools}
          aria-label="Stage tools"
          style={{
            flex: "none",
            width: 38,
            height: 38,
            borderRadius: 999,
            border: "none",
            background: "var(--fill)",
            color: "var(--acc-deep)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Icon name="more" size={18} strokeWidth={1.8} />
        </button>
      </div>
    </div>
  );
}
