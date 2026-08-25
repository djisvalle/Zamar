import { Dialog } from "../../components/Overlays";
import { useStore } from "../../state/store";

export function MicPermissionSheet({ onDone }: { onDone: () => void }) {
  const { dispatch } = useStore();

  const resolve = () => {
    dispatch({ type: "SET_MIC_ASKED" });
    onDone();
  };

  return (
    <Dialog>
      <div className="dialog-title">Let Zamar use the microphone?</div>
      <div className="dialog-body">
        Only to hear the note you play. Audio is analysed on device and never recorded or uploaded.
      </div>
      <div className="btn-row">
        <button className="btn" onClick={resolve}>
          Not now
        </button>
        <button className="btn btn-primary" onClick={resolve}>
          Allow
        </button>
      </div>
    </Dialog>
  );
}
