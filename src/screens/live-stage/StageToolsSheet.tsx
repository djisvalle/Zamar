import { useState } from "react";
import { Sheet } from "../../components/Overlays";
import { Icon, type IconName } from "../../components/Icon";
import { useStore } from "../../state/store";
import type { ScoreInstrument } from "../../components/MxlScore";
import type { AttachmentKind, ChartView, Song } from "../../state/types";
import { ATTACHMENT_LABEL, selectedVersion } from "../../utils/attachments";

export function StageToolsSheet({
  song,
  view,
  hasChords,
  availableKinds,
  activeKind,
  activeVersionId,
  onSelectChords,
  onSelectSheet,
  instruments,
  hiddenParts,
  onToggleInstrument,
  chordsLocked,
  instrumentsLocked,
  onAddSong,
  onQuickEdit,
  onAnnotate,
  onClose,
}: {
  song: Song;
  view: ChartView;
  hasChords: boolean;
  availableKinds: AttachmentKind[];
  activeKind: AttachmentKind | undefined;
  activeVersionId: string | undefined;
  onSelectChords: () => void;
  onSelectSheet: (kind: AttachmentKind, versionId?: string) => void;
  instruments: ScoreInstrument[];
  hiddenParts: ReadonlySet<string>;
  onToggleInstrument: (id: string) => void;
  /** Disables lyrics-only/zoom — locked once the "chords" annotation
   * layer has strokes. */
  chordsLocked: boolean;
  /** Disables the instrument show/hide chips — locked once the "musicxml"
   * annotation layer has strokes. */
  instrumentsLocked: boolean;
  onAddSong: () => void;
  onQuickEdit: () => void;
  onAnnotate: () => void;
  onClose: () => void;
}) {
  const { state, dispatch } = useStore();
  const { stage } = state;
  const [expandedKind, setExpandedKind] = useState<AttachmentKind | null>(null);

  // Nothing to switch between — a song with chords and no attachments (or
  // vice versa) doesn't need a picker at all.
  // Also show when the current sheet view has become unsatisfiable (its only
  // attachment was removed while this song stayed loaded on stage) — the
  // picker is the only way back to Chords/Lyrics in that case.
  const stranded = view === "sheet" && availableKinds.length === 0 && hasChords;
  const showViewPicker = (hasChords ? 1 : 0) + availableKinds.length > 1 || stranded;
  // Same condition MusicToolbar's old expanded second row used: chord view
  // always has something to configure once there are chords; sheet view
  // only does once there's more than one instrument part.
  const showSecondRow = view === "chords" ? hasChords : instruments.length > 1;

  const run = (action: () => void) => () => {
    onClose();
    action();
  };

  return (
    <Sheet onClose={onClose}>
      <div className="sheet-title">Stage tools</div>

      <div style={{ display: "flex", borderBottom: "1px solid var(--line)" }}>
        <ToolIcon icon="plus" label="Add song" onClick={run(onAddSong)} />
        <ToolIcon icon="edit" label="Quick edit" onClick={run(onQuickEdit)} />
        <ToolIcon icon="annotate" label="Annotate" onClick={run(onAnnotate)} />
      </div>

      {showViewPicker && (
        <div className="sheet-group">
          {hasChords && (
            <button className="sheet-row" onClick={run(onSelectChords)}>
              <span>Chords/Lyrics</span>
              <span className="accent-deep" style={{ opacity: view === "chords" ? 1 : 0, display: "flex" }}>
                <Icon name="check" size={14} strokeWidth={2.2} />
              </span>
            </button>
          )}
          {availableKinds.map((kind) => {
            const bucket = song.attachments[kind]!;
            const isMultiVersion = bucket.versions.length > 1;
            const isActiveKind = view === "sheet" && activeKind === kind;
            const activeVersionLabel = isActiveKind ? bucket.versions.find((v) => v.id === activeVersionId)?.label : undefined;
            const activeLabel = activeVersionLabel ?? selectedVersion(bucket).label;
            return (
              <div key={kind}>
                <button
                  className="sheet-row"
                  onClick={
                    isMultiVersion
                      ? () => setExpandedKind(expandedKind === kind ? null : kind)
                      : run(() => onSelectSheet(kind))
                  }
                >
                  <span>
                    {ATTACHMENT_LABEL[kind]}
                    {isMultiVersion && <span className="muted"> · {activeLabel}</span>}
                  </span>
                  {isMultiVersion ? (
                    <span
                      style={{
                        display: "flex",
                        color: "var(--mut)",
                        transform: expandedKind === kind ? "rotate(90deg)" : undefined,
                        transition: "transform .15s",
                      }}
                    >
                      <Icon name="chevron-right" size={14} strokeWidth={2} />
                    </span>
                  ) : (
                    <span className="accent-deep" style={{ opacity: isActiveKind ? 1 : 0, display: "flex" }}>
                      <Icon name="check" size={14} strokeWidth={2.2} />
                    </span>
                  )}
                </button>
                {isMultiVersion && expandedKind === kind && (
                  <div style={{ paddingLeft: 14 }}>
                    {bucket.versions.map((v) => (
                      <button key={v.id} className="sheet-row" onClick={run(() => onSelectSheet(kind, v.id))}>
                        <span>{v.label}</span>
                        <span className="accent-deep" style={{ opacity: isActiveKind && v.id === activeVersionId ? 1 : 0, display: "flex" }}>
                          <Icon name="check" size={14} strokeWidth={2.2} />
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {showSecondRow && view === "chords" && (
        <div style={{ opacity: chordsLocked ? 0.4 : 1 }}>
          <div style={{ padding: "9px 2px 4px", display: "flex", alignItems: "center", gap: 2 }}>
            <ToolIcon
              glyph="Aa"
              label="Lyrics"
              active={stage.lyricsOnly}
              disabled={chordsLocked}
              onClick={() => dispatch({ type: "STAGE_TOGGLE_LYRICS_ONLY" })}
            />
            <ToolIcon
              glyph="－"
              label="Zoom−"
              disabled={chordsLocked}
              onClick={() => dispatch({ type: "STAGE_SET_ZOOM", zoom: stage.zoom - 10 })}
            />
            <ToolIcon
              glyph="＋"
              label="Zoom+"
              disabled={chordsLocked}
              onClick={() => dispatch({ type: "STAGE_SET_ZOOM", zoom: stage.zoom + 10 })}
            />
          </div>
          {chordsLocked && (
            <div style={{ fontSize: 11, color: "var(--mut)", padding: "0 2px 6px" }}>
              Clear marks in Annotate to change these controls.
            </div>
          )}
        </div>
      )}

      {showSecondRow && view === "sheet" && (
        <div>
          <div style={{ padding: "9px 2px 4px", display: "flex", flexWrap: "wrap", gap: 6 }}>
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
            <div style={{ fontSize: 11, color: "var(--mut)", padding: "0 2px 6px" }}>
              Clear marks in Annotate to show/hide parts.
            </div>
          )}
        </div>
      )}
    </Sheet>
  );
}

function ToolIcon({
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
