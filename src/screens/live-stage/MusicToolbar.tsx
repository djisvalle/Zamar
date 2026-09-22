import { KeyChips } from "../../components/KeyChips";
import { Icon } from "../../components/Icon";
import { useStore } from "../../state/store";

export function MusicToolbar({ onOpenTools }: { onOpenTools: () => void }) {
  const { state, dispatch } = useStore();
  const { stage } = state;
  const key = stage.dispKey ?? "C";

  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
        borderTop: "1px solid var(--line)",
        background: "var(--surface)",
        zIndex: 6,
        padding: "8px 10px 10px",
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
            width: 36,
            height: 36,
            borderRadius: 9,
            border: "1px solid var(--line)",
            background: "var(--bg)",
            color: "var(--acc)",
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
