import JSZip from "jszip";

/** .mxl is MusicXML's compressed container: a zip with META-INF/container.xml
 * pointing at the real score file inside. Plain .musicxml/.xml files are
 * passed through unchanged (detected by the "PK" zip signature). */
export async function resolveMusicXmlText(buffer: Buffer): Promise<string> {
  const isZip = buffer.length > 2 && buffer[0] === 0x50 && buffer[1] === 0x4b; // "PK"
  if (!isZip) return buffer.toString("utf8");

  const zip = await JSZip.loadAsync(buffer);
  const containerXml = await zip.file("META-INF/container.xml")?.async("string");
  if (containerXml) {
    const match = containerXml.match(/full-path="([^"]+)"/);
    const rootfilePath = match?.[1];
    if (rootfilePath && zip.file(rootfilePath)) {
      return zip.file(rootfilePath)!.async("string");
    }
  }

  const fallback = Object.values(zip.files).find(
    (f) => !f.dir && f.name.toLowerCase().endsWith(".xml") && !f.name.toLowerCase().includes("container")
  );
  if (!fallback) throw new Error("Couldn't find a MusicXML file inside this .mxl archive.");
  return fallback.async("string");
}
