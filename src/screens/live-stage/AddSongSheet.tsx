import { useStore } from "../../state/store";
import { SongPickerSheet } from "../../components/SongPickerSheet";
import { Icon } from "../../components/Icon";

export function AddSongSheet({ onClose }: { onClose: () => void }) {
  const { state, dispatch } = useStore();
  const setlist = state.setlists.find((sl) => sl.id === state.stage.setlistId);

  const playNow = (songId: string) => {
    dispatch({ type: "STAGE_LOAD", songId, setlistId: state.stage.setlistId, setlistIndex: state.stage.setlistIndex });
    onClose();
  };

  const upNext = (songId: string) => {
    if (!setlist) return;
    const lastSection = setlist.sections[setlist.sections.length - 1];
    dispatch({
      type: "ADD_ITEM",
      setlistId: setlist.id,
      sectionId: lastSection.id,
      item: { id: `${songId}-queued-${Date.now()}`, kind: "song", songId },
    });
    onClose();
  };

  return (
    <SongPickerSheet
      title="Add to Setlist"
      onClose={onClose}
      subtitle={setlist ? `Queues at the end of ${setlist.name}` : "No setlist on stage"}
      trailing={(s) => (
        <>
          <button
            className="row-icon-btn"
            title={setlist ? "Add to setlist" : "No active setlist"}
            aria-label={`Queue ${s.title} in the setlist`}
            disabled={!setlist}
            onClick={() => upNext(s.id)}
          >
            <Icon name="queue" size={16} strokeWidth={2} />
          </button>
          <button className="row-icon-btn row-icon-btn--filled" onClick={() => playNow(s.id)} aria-label={`Load ${s.title} on stage`}>
            <Icon name="play" size={13} />
          </button>
        </>
      )}
    />
  );
}
