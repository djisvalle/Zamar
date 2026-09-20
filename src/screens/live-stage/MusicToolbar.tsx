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
  transposeLocked,
  chordsLocked,
  instrumentsLocked,
}: {
  view: ChartView;
  hasChords: boolean;
  instruments: ScoreInstrument[];
  hiddenParts: ReadonlySet<string>;
  onToggleInstrument: (id: string) => void;
  /** Disables the key-transpose row — locked once either the "chords" or
   * "musicxml" annotation layer has strokes, since both views share the
   * same `stage.dispKey`. */
  transposeLocked: boolean;
  /** Disables capo/lyrics-only/zoom — locked once the "chords" annotation
   * layer has strokes. */
  chordsLocked: boolean;
  /** Disables the instrument show/hide chips — locked once the "musicxml"
   * annotation layer has strokes. */
  instrumentsLocked: boolean;
}) {
  const { state, dispatch } = useStore();
  const { stage } = state;
  const key = stage.dispKey ?? "C";
  // The key-transpose row always applies (it shifts real notated pitches in
  // sheet view, chord letters in chord view). The second row's controls
  // (capo, lyrics-only, zoom) are chord-chart-specific and don't
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
        <KeyChips active={key} onSelect={(k) => dispatch({ type: "STAGE_SET_KEY", key: k })} disabled={transposeLocked} />
        {transposeLocked && (
          <div style={{ fontSize: 11, color: "var(--mut)", marginTop: 4 }}>Clear marks in Annotate to change key.</div>
        )}
      </div>

      {showSecondRow && stage.toolbarExpanded && view === "chords" && (
        <div style={{ borderTop: "1px solid var(--line)" }}>
          <div
            style={{
              padding: "9px 10px 12px",
              display: "flex",
              alignItems: "center",
              gap: 2,
              opacity: chordsLocked ? 0.4 : 1,
            }}
          >
            <ToolbarStepper
              label="Capo"
              value={stage.capo}
              disabled={chordsLocked}
              onDec={() => dispatch({ type: "STAGE_SET_CAPO", capo: stage.capo - 1 })}
              onInc={() => dispatch({ type: "STAGE_SET_CAPO", capo: stage.capo + 1 })}
            />
            <ToolbarIcon
              glyph="Aa"
              label="Lyrics"
              active={stage.lyricsOnly}
              disabled={chordsLocked}
              onClick={() => dispatch({ type: "STAGE_TOGGLE_LYRICS_ONLY" })}
            />
            <ToolbarIcon
              glyph="－"
              label="Zoom−"
              disabled={chordsLocked}
              onClick={() => dispatch({ type: "STAGE_SET_ZOOM", zoom: stage.zoom - 10 })}
            />
            <ToolbarIcon
              glyph="＋"
              label="Zoom+"
              disabled={chordsLocked}
              onClick={() => dispatch({ type: "STAGE_SET_ZOOM", zoom: stage.zoom + 10 })}
            />
          </div>
          {chordsLocked && (
            <div style={{ padding: "0 14px 10px", fontSize: 11, color: "var(--mut)" }}>
              Clear marks in Annotate to change these controls.
            </div>
          )}
        </div>
      )}

      {showSecondRow && stage.toolbarExpanded && view === "sheet" && (
        <div style={{ borderTop: "1px solid var(--line)" }}>
          <div
            style={{
              padding: "9px 14px 12px",
              display: "flex",
              flexWrap: "wrap",
              gap: 6,
            }}
          >
            {instruments.map((inst) => (
              <button
                key={inst.id}
                className={"chip" + (hiddenParts.has(inst.id) ? "" : " active")}
                disabled={instrumentsLocked}
                style={{ opacity: instrumentsLocked ? 0.4 : 1 }}
                onClick={() => onToggleInstrument(inst.id)}
              >
                {inst.name}
              </button>
            ))}
          </div>
          {instrumentsLocked && (
            <div style={{ padding: "0 14px 10px", fontSize: 11, color: "var(--mut)" }}>
              Clear marks in Annotate to show/hide parts.
            </div>
          )}
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
  disabled = false,
}: {
  label: string;
  value: number;
  onDec: () => void;
  onInc: () => void;
  disabled?: boolean;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2, flex: 1 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
        <button
          onClick={onDec}
          disabled={disabled}
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
          disabled={disabled}
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
  disabled = false,
}: {
  glyph?: string;
  icon?: IconName;
  label: string;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
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
