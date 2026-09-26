import type { AttachmentBucket, AttachmentKind, AttachmentVersion, Attachments, Song } from "../state/types";

export const ATTACHMENT_LABEL: Record<AttachmentKind, string> = {
  musicxml: "Sheet Music",
  pdf: "PDF",
  image: "Photo",
};

// A real engraved score is the most authoritative view, then a PDF, then a
// photo — used to pick a default category when a song has more than one and
// nothing else has been chosen yet.
export const CATEGORY_PRIORITY: AttachmentKind[] = ["musicxml", "pdf", "image"];

export function firstAvailableCategory(attachments: Attachments): AttachmentKind | undefined {
  return CATEGORY_PRIORITY.find((kind) => (attachments[kind]?.versions.length ?? 0) > 0);
}

export function selectedVersion(bucket: AttachmentBucket): AttachmentVersion {
  return bucket.versions.find((v) => v.id === bucket.selectedVersionId) ?? bucket.versions[0];
}

/** The attachment a song opens to on stage, if it opens to one: its saved
 * default kind while still attached, else the highest-priority one, and that
 * bucket's default version (as the effect in LiveStage picks). `view` is the
 * song's resolved default view (store.ts's `resolveDefaultView`), passed in
 * so this module doesn't import the store. */
export function openingAttachment(
  song: Song | undefined,
  view: "chords" | "sheet"
): { kind: AttachmentKind; version: AttachmentVersion } | undefined {
  if (!song || view !== "sheet") return undefined;
  const saved = song.defaultView && song.defaultView !== "chords" ? song.defaultView : undefined;
  const kind = saved && song.attachments[saved] ? saved : firstAvailableCategory(song.attachments);
  return kind ? { kind, version: selectedVersion(song.attachments[kind]!) } : undefined;
}

/** Appends `version` to `attachments[kind]` (creating the bucket if it
 * doesn't exist yet) and makes it the bucket's new default. Never mutates
 * its input — every import path stays additive: a second PDF never
 * replaces the first. */
export function addVersion(attachments: Attachments, kind: AttachmentKind, version: AttachmentVersion): Attachments {
  const existing = attachments[kind]?.versions ?? [];
  return {
    ...attachments,
    [kind]: { versions: [...existing, version], selectedVersionId: version.id },
  };
}

/** Removes one version. If it was the bucket's default, a neighboring
 * version becomes the new default. If the bucket becomes empty, the whole
 * kind key is dropped from `attachments`. */
export function removeVersion(attachments: Attachments, kind: AttachmentKind, versionId: string): Attachments {
  const bucket = attachments[kind];
  if (!bucket) return attachments;
  const index = bucket.versions.findIndex((v) => v.id === versionId);
  if (index === -1) return attachments;
  const versions = bucket.versions.filter((v) => v.id !== versionId);
  if (versions.length === 0) {
    const next = { ...attachments };
    delete next[kind];
    return next;
  }
  const selectedVersionId =
    bucket.selectedVersionId === versionId ? versions[Math.min(index, versions.length - 1)].id : bucket.selectedVersionId;
  return { ...attachments, [kind]: { versions, selectedVersionId } };
}

export function renameVersion(attachments: Attachments, kind: AttachmentKind, versionId: string, label: string): Attachments {
  const bucket = attachments[kind];
  if (!bucket) return attachments;
  return {
    ...attachments,
    [kind]: { ...bucket, versions: bucket.versions.map((v) => (v.id === versionId ? { ...v, label } : v)) },
  };
}

/** Moves one version to `toIndex` (counted without it) — the order the
 * version pickers list them in. The default version doesn't change. */
export function moveVersion(attachments: Attachments, kind: AttachmentKind, versionId: string, toIndex: number): Attachments {
  const bucket = attachments[kind];
  if (!bucket) return attachments;
  const version = bucket.versions.find((v) => v.id === versionId);
  if (!version) return attachments;
  const versions = bucket.versions.filter((v) => v.id !== versionId);
  versions.splice(Math.max(0, Math.min(toIndex, versions.length)), 0, version);
  return { ...attachments, [kind]: { ...bucket, versions } };
}

/** Changes which version is the bucket's default — used by Add/Edit Song's
 * "Use this version" action. Live Stage's in-session version switch does
 * NOT call this; it's local view state, not a change to the song. */
export function selectVersion(attachments: Attachments, kind: AttachmentKind, versionId: string): Attachments {
  const bucket = attachments[kind];
  if (!bucket || !bucket.versions.some((v) => v.id === versionId)) return attachments;
  return { ...attachments, [kind]: { ...bucket, selectedVersionId: versionId } };
}
