import { KeyChips } from "../../components/KeyChips";
import { Icon, type IconName } from "../../components/Icon";
import { useStore } from "../../state/store";
import type { ScoreInstrument } from "../../components/MxlScore";
import type { ChartView } from "../../state/types";

export function MusicToolbar({
  view,
  hasChords,
  instruments,
  hiddenParts,
  onToggleInstrument,
  onAnnotate,
}: {
  view: ChartView;
  hasChords: boolean;
  instruments: ScoreInstrument[];
  hiddenParts: ReadonlySet<string>;
  onToggleInstrument: (id: string) => void;
  onAnnotate: () => void;
}) {
  const { state, dispatch } = useStore();
  const { stage } = state;
  const key = stage.dispKey ?? "C";
  // The key-transpose row always applies (it shifts real notated pitches in
  // sheet view, chord letters in chord view). The second row's controls
  // (capo, lyrics-only, zoom, annotate) are chord-chart-specific and don't
  // mean anything against real engraving, so sheet view swaps it for a
  // per-instrument show/hide row instead — and only offers that row at all
  // once there's more than one part to choose between.
  const showSecondRow = view === "chords" ? hasChords : instruments.length > 1;

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
      {showSecondRow && (
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
      )}

      <div style={{ padding: "2px 14px 10px" }}>
        <KeyChips active={key} onSelect={(k) => dispatch({ type: "STAGE_SET_KEY", key: k })} />
      </div>

      {showSecondRow && stage.toolbarExpanded && view === "chords" && (
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
          <ToolbarIcon icon="annotate" label="Annotate" onClick={onAnnotate} />
        </div>
      )}

      {showSecondRow && stage.toolbarExpanded && view === "sheet" && (
        <div
          style={{
            padding: "9px 14px 12px",
            display: "flex",
            flexWrap: "wrap",
            gap: 6,
            borderTop: "1px solid var(--line)",
          }}
        >
          {instruments.map((inst) => (
            <button
              key={inst.id}
              className={"chip" + (hiddenParts.has(inst.id) ? "" : " active")}
              onClick={() => onToggleInstrument(inst.id)}
            >
              {inst.name}
            </button>
          ))}
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
  icon,
  label,
  onClick,
  active,
}: {
  glyph?: string;
  icon?: IconName;
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
        gap: 3,
        flex: 1,
        background: "none",
        border: "none",
      }}
    >
      <span style={{ fontSize: 19, lineHeight: 1, display: "flex", color: active ? "var(--acc-deep)" : "var(--acc)" }}>
        {icon ? <Icon name={icon} size={19} strokeWidth={1.8} /> : glyph}
      </span>
      <span style={{ fontSize: 10, fontWeight: 600, color: "var(--mut)" }}>{label}</span>
    </button>
  );
}
