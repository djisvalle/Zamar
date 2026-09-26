import { useEffect, useState } from "react";
import { useStore } from "../../state/store";
import { useNavigator } from "../../navigation/Navigator";
import { Header } from "../../components/Header";
import { Sheet, Dialog } from "../../components/Overlays";
import { Icon } from "../../components/Icon";
import { flattenSetlist } from "../../utils/setlistCalc";
import { AddToSetSheet } from "./AddToSetSheet";
import { Section } from "../../components/List";
import { SlotDetailSheet } from "./SlotDetailSheet";
import { SetDetailsSheet } from "./SetDetailsSheet";
import { useDragReorder } from "../../components/useDragReorder";
import type { SetlistItem, SetlistSection, Song } from "../../state/types";

export function SetlistDetail({ setlistId }: { setlistId: string }) {
  const { state, dispatch } = useStore();
  const nav = useNavigator();
  const setlist = state.setlists.find((sl) => sl.id === setlistId);
  const [menuOpen, setMenuOpen] = useState(false);
  // Which section "Add songs" targets; undefined means the set's last section.
  const [addFor, setAddFor] = useState<{ sectionId?: string } | null>(null);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(Boolean((nav.top.params as any)?.openDetails));
  // openDetails is a one-shot request from "New setlist": drop it from the
  // frame so coming back to this screen (from Export, or another tab)
  // doesn't open Set details again.
  useEffect(() => {
    if ((nav.top.params as any)?.openDetails) nav.replace("setlist-detail", { setlistId });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [slot, setSlot] = useState<{ item: SetlistItem; song: Song; index: number } | null>(null);
  const [addSectionOpen, setAddSectionOpen] = useState(false);
  const [sectionName, setSectionName] = useState("");
  const [sectionSheetFor, setSectionSheetFor] = useState<SetlistSection | null>(null);
  const [renameSectionFor, setRenameSectionFor] = useState<SetlistSection | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [confirmDeleteSection, setConfirmDeleteSection] = useState<SetlistSection | null>(null);
  const [confirmDeleteSet, setConfirmDeleteSet] = useState(false);
  const drag = useDragReorder((itemId, to) =>
    dispatch({ type: "MOVE_ITEM", setlistId, itemId, toSectionId: to.group, toIndex: to.index })
  );
  const sectionDrag = useDragReorder(
    (sectionId, to) => dispatch({ type: "MOVE_SECTION", setlistId, sectionId, toIndex: to.index }),
    "section-drag"
  );

  if (!setlist) {
    return (
      <div className="screen">
        <Header title="Setlist" onBack={nav.pop} />
        <div className="empty">
          <div className="empty-title">Setlist not found</div>
        </div>
      </div>
    );
  }

  const flat = flattenSetlist(setlist, state.songs);
  const songEntries = flat.filter((e) => e.song);
  const startSong = () => {
    if (songEntries.length === 0) return;
    dispatch({ type: "STAGE_LOAD", songId: songEntries[0].song!.id, setlistId: setlist.id, setlistIndex: 0 });
    nav.resetTab("live-stage");
  };
  // This set is the one loaded on Live Stage: go back to where it left off
  // rather than starting over from the first song.
  const isLive = state.stage.setlistId === setlist.id;
  const resumeSet = () => nav.resetTab("live-stage");
  const moveSection = (sectionId: string, toIndex: number) =>
    dispatch({ type: "MOVE_SECTION", setlistId: setlist.id, sectionId, toIndex });

  let songSlotIndex = -1;

  return (
    <div className="screen screen--grouped">
      <Header
        title={setlist.name}
        onBack={nav.pop}
        right={
          <button className="hdr-btn" onClick={() => setMenuOpen(true)} aria-label="Setlist options">
            <Icon name="more" size={20} strokeWidth={2} />
          </button>
        }
      />

      <div className="ios-list">
        <div className="row-sub" style={{ padding: "0 16px", whiteSpace: "normal" }}>
          {[setlist.date, setlist.time, setlist.description].filter(Boolean).join(" · ")}
        </div>

        {setlist.sections.map((section, si) => (
          <Section
            key={section.id}
            tight={si === 0}
            header={section.label}
            rootProps={sectionDrag.rowProps(section.id, "sections", si, setlist.sections.length)}
            headerLeading={
              setlist.sections.length > 1 && (
                <span
                  className="list-section-grip"
                  {...sectionDrag.handleProps(section.id)}
                  aria-label={`Reorder ${section.label}`}
                >
                  <Icon name="grip" size={18} strokeWidth={1.8} />
                </span>
              )
            }
            headerAccessory={
              <button onClick={() => setSectionSheetFor(section)} aria-label={`${section.label} options`}>
                <Icon name="more" size={18} strokeWidth={2} />
              </button>
            }
          >
            {section.items.length === 0 && (
              <button
                {...drag.emptyGroupProps(section.id)}
                className={"sheet-row action sheet-row--lead " + (drag.emptyGroupProps(section.id).className ?? "")}
                onClick={() => setAddFor({ sectionId: section.id })}
              >
                <span className="row-lead">
                  <Icon name="plus" size={18} strokeWidth={2.2} />
                </span>
                <span>Add songs here</span>
              </button>
            )}
            {section.items.map((item, i) => {
              const entry = flat.find((e) => e.item.id === item.id)!;
              const dp = drag.rowProps(item.id, section.id, i, section.items.length);
              if (item.kind === "note") {
                return (
                  <div key={item.id} {...dp} className={"sheet-row sheet-row--lead " + dp.className}>
                    <span className="row-lead" {...drag.handleProps(item.id)} style={{ ...drag.handleProps(item.id).style, color: "var(--mut)" }} aria-label={`Reorder ${item.label}`}>
                      <Icon name="note" size={18} strokeWidth={1.8} />
                    </span>
                    <div className="row-main">
                      <div className="row-title">
                        <span>{item.label}</span>
                      </div>
                      {item.note && <div className="row-sub">{item.note}</div>}
                    </div>
                  </div>
                );
              }
              const song = entry.song!;
              songSlotIndex += 1;
              const idx = songSlotIndex;
              return (
                <button key={item.id} {...dp} className={"sheet-row sheet-row--lead " + dp.className} onClick={() => setSlot({ item, song, index: idx })}>
                  <span className="row-lead" {...drag.handleProps(item.id)} style={{ ...drag.handleProps(item.id).style, color: "var(--tertiary)" }} aria-label={`Reorder ${song.title}`}>
                    <Icon name="grip" size={18} strokeWidth={1.8} />
                  </span>
                  <div className="row-main">
                    <div className="row-title">
                      <span>{song.title}</span>
                    </div>
                    <div className="row-sub">
                      {song.artist} · {song.tempo} BPM · {song.timeSig}
                    </div>
                    {item.note && (
                      <div className="row-note">
                        <Icon name="edit" size={12} strokeWidth={2} />
                        <span>{item.note}</span>
                      </div>
                    )}
                  </div>
                  <span className="key-chip">{item.keyOverride ?? song.defaultKey}</span>
                </button>
              );
            })}
          </Section>
        ))}
      </div>

      {/* Adding lives in the toolbar, not at the end of the list, so it stays
          in reach however long the set gets. */}
      <div className="toolbar">
        <button className="btn" style={{ width: 44, padding: 0 }} onClick={() => setAddMenuOpen(true)} aria-label="Add songs or a section">
          <Icon name="plus" size={18} strokeWidth={2.2} />
        </button>
        <button
          className="btn btn-primary"
          style={{ flex: 1 }}
          onClick={isLive ? resumeSet : startSong}
          disabled={songEntries.length === 0}
        >
          <Icon name="play" size={14} />
          {isLive ? "Resume Set" : "Start Set"}
        </button>
        <button className="btn" style={{ width: 44, padding: 0 }} onClick={() => nav.push("export", { setlistId })} aria-label="Export setlist">
          <Icon name="share" size={18} strokeWidth={2} />
        </button>
      </div>

      {addMenuOpen && (
        <Sheet onClose={() => setAddMenuOpen(false)}>
          <div className="sheet-group">
          {setlist.sections.length > 0 && (
            <button
              className="sheet-row"
              onClick={() => {
                setAddMenuOpen(false);
                setAddFor({});
              }}
            >
              Add songs
            </button>
          )}
          <button
            className="sheet-row"
            onClick={() => {
              setAddMenuOpen(false);
              setAddSectionOpen(true);
            }}
          >
            Add section
          </button>
          </div>
        </Sheet>
      )}
      {menuOpen && (
        <Sheet onClose={() => setMenuOpen(false)}>
          {isLive && (
            <div className="sheet-group">
            <button
              className="sheet-row"
              onClick={() => {
                setMenuOpen(false);
                startSong();
              }}
            >
              Restart set from the top
            </button>
            <button
              className="sheet-row destructive"
              onClick={() => {
                setMenuOpen(false);
                dispatch({ type: "STAGE_EXIT" });
              }}
            >
              Stop set
            </button>
            </div>
          )}
          <div className="sheet-group">
          <button
            className="sheet-row"
            onClick={() => {
              setMenuOpen(false);
              setDetailsOpen(true);
            }}
          >
            Set details
          </button>
          <button
            className="sheet-row"
            onClick={() => {
              setMenuOpen(false);
              nav.push("export", { setlistId });
            }}
          >
            Export set
          </button>
          </div>
          <div className="sheet-group">
          <button
            className="sheet-row destructive"
            onClick={() => {
              setMenuOpen(false);
              setConfirmDeleteSet(true);
            }}
          >
            Delete set
          </button>
          </div>
        </Sheet>
      )}
      {addFor && <AddToSetSheet setlist={setlist} sectionId={addFor.sectionId} onClose={() => setAddFor(null)} />}
      {detailsOpen && <SetDetailsSheet setlist={setlist} onClose={() => setDetailsOpen(false)} />}
      {slot && (
        <SlotDetailSheet
          setlistId={setlist.id}
          sections={setlist.sections}
          item={slot.item}
          song={slot.song}
          slotIndex={slot.index}
          onClose={() => setSlot(null)}
        />
      )}
      {sectionSheetFor && (
        <Sheet onClose={() => setSectionSheetFor(null)}>
          <div className="sheet-title">{sectionSheetFor.label}</div>
          <div className="sheet-group">
          <button
            className="sheet-row"
            onClick={() => {
              const sec = sectionSheetFor;
              setSectionSheetFor(null);
              setAddFor({ sectionId: sec.id });
            }}
          >
            <span>Add songs to this section</span>
          </button>
          </div>
          {setlist.sections.length > 1 && (
            <div className="sheet-group">
            {setlist.sections[0].id !== sectionSheetFor.id && (
              <button
                className="sheet-row"
                onClick={() => {
                  const sec = sectionSheetFor;
                  setSectionSheetFor(null);
                  moveSection(sec.id, setlist.sections.findIndex((x) => x.id === sec.id) - 1);
                }}
              >
                <span>Move up</span>
              </button>
            )}
            {setlist.sections[setlist.sections.length - 1].id !== sectionSheetFor.id && (
              <button
                className="sheet-row"
                onClick={() => {
                  const sec = sectionSheetFor;
                  setSectionSheetFor(null);
                  moveSection(sec.id, setlist.sections.findIndex((x) => x.id === sec.id) + 1);
                }}
              >
                <span>Move down</span>
              </button>
            )}
            </div>
          )}
          <div className="sheet-group">
          <button
            className="sheet-row"
            onClick={() => {
              const sec = sectionSheetFor;
              setSectionSheetFor(null);
              setRenameValue(sec.label);
              setRenameSectionFor(sec);
            }}
          >
            <span>Rename section</span>
          </button>
          </div>
          <div className="sheet-group">
          <button
            className="sheet-row destructive"
            onClick={() => {
              const sec = sectionSheetFor;
              setSectionSheetFor(null);
              setConfirmDeleteSection(sec);
            }}
          >
            <span>Delete section</span>
          </button>
          </div>
        </Sheet>
      )}

      {renameSectionFor && (
        <Dialog>
          <div className="dialog-title">Rename section</div>
          <input
            className="alert-input"
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            placeholder="Section name"
            aria-label="Section name"
            autoFocus
          />
          <div className="btn-row" style={{ marginTop: 2 }}>
            <button className="btn" onClick={() => setRenameSectionFor(null)}>
              Cancel
            </button>
            <button
              className={"btn btn-primary" + (!renameValue.trim() ? " is-disabled" : "")}
              disabled={!renameValue.trim()}
              onClick={() => {
                dispatch({ type: "UPDATE_SECTION", setlistId: setlist.id, sectionId: renameSectionFor.id, label: renameValue.trim() });
                setRenameSectionFor(null);
              }}
            >
              Save
            </button>
          </div>
        </Dialog>
      )}

      {confirmDeleteSection && (
        <Dialog>
          <div className="dialog-title">Delete "{confirmDeleteSection.label}"?</div>
          <div className="dialog-body">
            {confirmDeleteSection.items.length > 0
              ? `This removes ${confirmDeleteSection.items.length} item${confirmDeleteSection.items.length > 1 ? "s" : ""} from the set too. This can't be undone.`
              : "This can't be undone."}
          </div>
          <div className="btn-row" style={{ marginTop: 2 }}>
            <button className="btn" onClick={() => setConfirmDeleteSection(null)}>
              Keep
            </button>
            <button
              className="btn btn-danger"
              onClick={() => {
                dispatch({ type: "REMOVE_SECTION", setlistId: setlist.id, sectionId: confirmDeleteSection.id });
                setConfirmDeleteSection(null);
              }}
            >
              Delete
            </button>
          </div>
        </Dialog>
      )}

      {confirmDeleteSet && (
        <Dialog>
          <div className="dialog-title">Delete "{setlist.name}"?</div>
          <div className="dialog-body">This removes the whole setlist. This can't be undone.</div>
          <div className="btn-row" style={{ marginTop: 2 }}>
            <button className="btn" onClick={() => setConfirmDeleteSet(false)}>
              Keep
            </button>
            <button
              className="btn btn-danger"
              onClick={() => {
                dispatch({ type: "DELETE_SETLIST", setlistId: setlist.id });
                setConfirmDeleteSet(false);
                nav.pop();
              }}
            >
              Delete
            </button>
          </div>
        </Dialog>
      )}

      {addSectionOpen && (
        <Dialog>
          <div className="dialog-title">Add section</div>
          <input
            className="alert-input"
            value={sectionName}
            onChange={(e) => setSectionName(e.target.value)}
            placeholder="Section name, e.g. Communion"
            aria-label="Section name"
            autoFocus
          />
          <div className="btn-row" style={{ marginTop: 2 }}>
            <button
              className="btn"
              onClick={() => {
                setAddSectionOpen(false);
                setSectionName("");
              }}
            >
              Cancel
            </button>
            <button
              className={"btn btn-primary" + (!sectionName.trim() ? " is-disabled" : "")}
              disabled={!sectionName.trim()}
              onClick={() => {
                dispatch({ type: "ADD_SECTION", setlistId: setlist.id, label: sectionName.trim() });
                setAddSectionOpen(false);
                setSectionName("");
              }}
            >
              Add
            </button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
