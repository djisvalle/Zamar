import { Dialog } from "../../components/Overlays";
import { useStore } from "../../state/store";

/** A pre-prompt shown before the OS permission dialog, so the first thing the
 * person sees is why Zamar wants the mic. "Allow" hands over to the real
 * system prompt (triggered by the Tuner opening the mic); "Not now" leaves
 * the mic off until they turn it on from the Tuner. */
export function MicPermissionSheet({ onDone }: { onDone: (allowed: boolean) => void }) {
  const { dispatch } = useStore();

  const resolve = (allowed: boolean) => {
    dispatch({ type: "SET_MIC_ASKED" });
    onDone(allowed);
  };

  return (
    <Dialog>
      <div className="dialog-title">Let Zamar use the microphone?</div>
      <div className="dialog-body">
        Only to hear the note you play. Audio is analysed on device and never recorded or uploaded.
      </div>
      <div className="btn-row">
        <button className="btn" onClick={() => resolve(false)}>
          Not now
        </button>
        <button className="btn btn-primary" onClick={() => resolve(true)}>
          Allow
        </button>
      </div>
    </Dialog>
  );
}
