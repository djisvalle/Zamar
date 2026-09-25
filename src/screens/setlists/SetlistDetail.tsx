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
import type { SetlistItem, SetlistSection, Song } from "../../state/types";

export function SetlistDetail({ setlistId }: { setlistId: string }) {
  const { state, dispatch } = useStore();
  const nav = useNavigator();
  const setlist = state.setlists.find((sl) => sl.id === setlistId);
  const [menuOpen, setMenuOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
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
            headerAccessory={
              <button onClick={() => setSectionSheetFor(section)} aria-label={`${section.label} options`}>
                <Icon name="more" size={18} strokeWidth={2} />
              </button>
            }
          >
            {section.items.length === 0 && (
              <div className="sheet-row" style={{ fontSize: 15, color: "var(--mut)" }}>
                No songs in this section yet.
              </div>
            )}
            {section.items.map((item) => {
              const entry = flat.find((e) => e.item.id === item.id)!;
              if (item.kind === "note") {
                return (
                  <div key={item.id} className="sheet-row sheet-row--lead">
                    <span className="row-lead" style={{ color: "var(--mut)" }}>
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
                <button key={item.id} className="sheet-row sheet-row--lead" onClick={() => setSlot({ item, song, index: idx })}>
                  <span className="row-lead" style={{ color: "var(--tertiary)" }}>
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

        <Section>
          <button className="sheet-row action sheet-row--lead" onClick={() => setAddOpen(true)}>
            <span className="row-lead">
              <Icon name="plus" size={18} strokeWidth={2.2} />
            </span>
            <span>Add song or item</span>
          </button>
          <button className="sheet-row action sheet-row--lead" onClick={() => setAddSectionOpen(true)}>
            <span className="row-lead">
              <Icon name="plus" size={18} strokeWidth={2.2} />
            </span>
            <span>Add section</span>
          </button>
        </Section>
      </div>

      <div className="toolbar">
        <button className="btn btn-primary" style={{ flex: 1 }} onClick={startSong} disabled={songEntries.length === 0}>
          <Icon name="play" size={14} />
          Start Set
        </button>
        <button className="btn" style={{ width: 44, padding: 0 }} onClick={() => nav.push("export", { setlistId })} aria-label="Export setlist">
          <Icon name="share" size={18} strokeWidth={2} />
        </button>
      </div>

      {menuOpen && (
        <Sheet onClose={() => setMenuOpen(false)}>
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
      {addOpen && <AddToSetSheet setlist={setlist} onClose={() => setAddOpen(false)} />}
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
