import { useStore } from "../../state/store";
import { useNavigator } from "../../navigation/Navigator";

export function FirstRun() {
  const { dispatch } = useStore();
  const nav = useNavigator();

  return (
    <div className="screen">
      <div style={{ flex: 1, padding: "26px 18px", display: "flex", flexDirection: "column", gap: 14 }}>
        <div>
          <div style={{ fontFamily: "var(--font-heading)", fontWeight: 700, fontSize: 24, lineHeight: 1.15 }}>
            Charts that keep up with the service
          </div>
          <div className="muted" style={{ fontSize: 13, lineHeight: 1.55, marginTop: 8 }}>
            Transpose mid-song, scroll hands-free, and tune without leaving the stage.
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div className="card">
            <div style={{ fontSize: 13, fontWeight: 600 }}>10 sample songs</div>
            <div className="muted" style={{ fontSize: 11, marginTop: 3, lineHeight: 1.45 }}>
              Amazing Grace, Way Maker and 8 more, ready to play.
            </div>
          </div>
          <div className="card">
            <div style={{ fontSize: 13, fontWeight: 600 }}>2 sample setlists</div>
            <div className="muted" style={{ fontSize: 11, marginTop: 3, lineHeight: 1.45 }}>
              Sunday AM and Youth Night, already ordered.
            </div>
          </div>
          <div className="card">
            <div style={{ fontSize: 13, fontWeight: 600 }}>Nothing to set up</div>
            <div className="muted" style={{ fontSize: 11, marginTop: 3, lineHeight: 1.45 }}>
              No account, no sync — everything stays on this device.
            </div>
          </div>
        </div>
        <div style={{ marginTop: "auto", display: "flex", flexDirection: "column", gap: 8 }}>
          <button
            className="btn btn-primary btn-block"
            onClick={() => {
              dispatch({ type: "SEED_SAMPLES" });
              nav.reset("live-stage");
            }}
          >
            Load the samples
          </button>
          <button
            className="btn btn-block"
            onClick={() => {
              dispatch({ type: "START_EMPTY" });
              nav.reset("live-stage");
            }}
          >
            Start empty
          </button>
        </div>
      </div>
    </div>
  );
}
