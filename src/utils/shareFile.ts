import { Capacitor } from "@capacitor/core";

function toBase64(bytes: Uint8Array): string {
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(bin);
}

/** Hands a generated file to the OS share sheet — on iOS that's where Save
 * to Files, Mail, AirDrop and Print live; on Android it's the system
 * chooser. On native the file is first written to the app's cache folder,
 * since the share plugins take a file URI. In a browser it uses the Web
 * Share API where it can share files, else downloads the file. Resolves
 * false if the person dismissed the sheet. */
export async function shareFile(file: { name: string; mime: string; bytes: Uint8Array }): Promise<boolean> {
  if (Capacitor.isNativePlatform()) {
    const { Filesystem, Directory } = await import("@capacitor/filesystem");
    const { Share } = await import("@capacitor/share");
    const { uri } = await Filesystem.writeFile({ path: file.name, data: toBase64(file.bytes), directory: Directory.Cache });
    try {
      await Share.share({ title: file.name, files: [uri] });
      return true;
    } catch (err) {
      // Both plugins reject with "Share canceled" when the sheet is dismissed.
      if (/cancel/i.test(String((err as Error)?.message ?? err))) return false;
      throw err;
    }
  }

  const blob = new Blob([file.bytes as BlobPart], { type: file.mime });
  const shareable = new File([blob], file.name, { type: file.mime });
  if (navigator.canShare?.({ files: [shareable] })) {
    try {
      await navigator.share({ files: [shareable], title: file.name });
      return true;
    } catch (err) {
      if ((err as Error)?.name === "AbortError") return false;
      // Anything else (e.g. no user gesture left) falls through to download.
    }
  }
  downloadFile(file.name, blob);
  return true;
}

/** Saves the file through the browser's download flow. Browser dev only —
 * a native web view has no download manager. */
export function downloadFile(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
