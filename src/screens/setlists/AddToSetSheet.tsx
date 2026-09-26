import { useStore } from "../../state/store";
import { SongPickerSheet } from "../../components/SongPickerSheet";
import { Icon } from "../../components/Icon";
import type { Setlist } from "../../state/types";

/** Adds songs to `sectionId`, or to the set's last section when none is given. */
export function AddToSetSheet({ setlist, sectionId, onClose }: { setlist: Setlist; sectionId?: string; onClose: () => void }) {
  const { dispatch } = useStore();

  const inSetIds = new Set(
    setlist.sections.flatMap((sec) => sec.items.filter((i) => i.kind === "song").map((i) => i.songId))
  );
  const target = setlist.sections.find((sec) => sec.id === sectionId) ?? setlist.sections[setlist.sections.length - 1];

  const add = (songId: string) => {
    dispatch({
      type: "ADD_ITEM",
      setlistId: setlist.id,
      sectionId: target.id,
      item: { id: `${songId}-${Date.now()}`, kind: "song", songId },
    });
  };

  return (
    <SongPickerSheet
      title="Add to set"
      onClose={onClose}
      subtitle={`Adds to ${target.label}`}
      trailing={(s) => {
        const inSet = inSetIds.has(s.id);
        return (
          <>
            {inSet && <span className="badge-muted">In set</span>}
            <button
              className="row-icon-btn"
              title={inSet ? "Add again (reprise)" : "Add to set"}
              aria-label={inSet ? `Add ${s.title} again` : `Add ${s.title} to set`}
              onClick={() => add(s.id)}
            >
              <Icon name="plus" size={17} strokeWidth={2.4} />
            </button>
          </>
        );
      }}
    />
  );
}
