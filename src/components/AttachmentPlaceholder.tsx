import type { AttachmentDataStatus } from "../data/attachmentData";

/** Stands in for an attachment whose file is still being read from storage,
 * worded like the score and PDF renderers' own loading and error lines. */
export function AttachmentPlaceholder({ status }: { status: AttachmentDataStatus }) {
  return (
    <div className="muted" style={{ fontSize: 13, padding: "20px 0", textAlign: "center" }}>
      {status === "error" ? "Couldn't read this file." : "Loading…"}
    </div>
  );
}
