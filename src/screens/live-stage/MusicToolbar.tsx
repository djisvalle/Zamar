import { KeyChips } from "../../components/KeyChips";
import { useStore } from "../../state/store";

export function MusicToolbar({ onAnnotate }: { onAnnotate: () => void }) {
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
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <button
        onClick={() => dispatch({ type: "STAGE_TOGGLE_TOOLBAR" })}
        style={{
          width: "100%",
          border: "none",
          background: "none",
          padding: "4px 0 2px",
          fontSize: 16,
          color: stage.toolbarExpanded ? "var(--acc)" : "var(--mut)",
        }}
      >
        {stage.toolbarExpanded ? "﹀" : "︿"}
      </button>

      <div style={{ padding: "2px 14px 10px" }}>
        <KeyChips active={key} onSelect={(k) => dispatch({ type: "STAGE_SET_KEY", key: k })} />
      </div>

      {stage.toolbarExpanded && (
        <div
          style={{
            padding: "9px 10px 12px",
            display: "flex",
            alignItems: "center",
            borderTop: "1px solid var(--line)",
            gap: 2,
          }}
        >
          <ToolbarStepper
            label="Capo"
            value={stage.capo}
            onDec={() => dispatch({ type: "STAGE_SET_CAPO", capo: stage.capo - 1 })}
            onInc={() => dispatch({ type: "STAGE_SET_CAPO", capo: stage.capo + 1 })}
          />
          <ToolbarIcon
            glyph="Aa"
            label="Lyrics"
            active={stage.lyricsOnly}
            onClick={() => dispatch({ type: "STAGE_TOGGLE_LYRICS_ONLY" })}
          />
          <ToolbarIcon glyph="－" label="Zoom−" onClick={() => dispatch({ type: "STAGE_SET_ZOOM", zoom: stage.zoom - 10 })} />
          <ToolbarIcon glyph="＋" label="Zoom+" onClick={() => dispatch({ type: "STAGE_SET_ZOOM", zoom: stage.zoom + 10 })} />
          <ToolbarIcon glyph="✎" label="Annotate" onClick={onAnnotate} />
        </div>
      )}
    </div>
  );
}

function ToolbarStepper({
  label,
  value,
  onDec,
  onInc,
}: {
  label: string;
  value: number;
  onDec: () => void;
  onInc: () => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2, flex: 1 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
        <button
          onClick={onDec}
          style={{
            width: 30,
            height: 30,
            borderRadius: 8,
            border: "1.5px solid var(--acc)",
            color: "var(--acc)",
            background: "none",
            fontSize: 15,
            fontWeight: 600,
          }}
        >
          −
        </button>
        <span style={{ fontSize: 15, fontWeight: 700, color: "var(--acc)", minWidth: 16, textAlign: "center" }}>{value}</span>
        <button
          onClick={onInc}
          style={{
            width: 30,
            height: 30,
            borderRadius: 8,
            border: "1.5px solid var(--acc)",
            color: "var(--acc)",
            background: "none",
            fontSize: 15,
            fontWeight: 600,
          }}
        >
          +
        </button>
      </div>
      <span style={{ fontSize: 10, fontWeight: 600, color: "var(--mut)" }}>{label}</span>
    </div>
  );
}

function ToolbarIcon({
  glyph,
  label,
  onClick,
  active,
}: {
  glyph: string;
  label: string;
  onClick: () => void;
  active?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 2,
        flex: 1,
        background: "none",
        border: "none",
      }}
    >
      <span style={{ fontSize: 19, color: active ? "var(--acc-deep)" : "var(--acc)" }}>{glyph}</span>
      <span style={{ fontSize: 10, fontWeight: 600, color: "var(--mut)" }}>{label}</span>
    </button>
  );
}
