import type { Viewport } from "../state/types";

/** Real-hardware detail for the two frames the mockup simulates: the phone
 * frame ("iPhone 17" per the source spec) gets a Dynamic Island pill floating
 * in the status bar; the tablet frame ("iPad A16") gets the plain circular
 * front-camera cutout iPads use instead — never a notch or island. */
export function DeviceNotch({ viewport }: { viewport: Viewport }) {
  if (viewport === "tablet") {
    return <span className="camera-dot" aria-hidden="true" />;
  }
  return <span className="dynamic-island" aria-hidden="true" />;
}
