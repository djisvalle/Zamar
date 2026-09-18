/** The seam a real image/PDF OMR engine plugs into.
 *
 * There is no way to derive notation from pixels with plain code — this
 * needs a trained recognition model (Audiveris, oemer, or a commercial API).
 * AudiverisOmrEngine below shells out to a locally-installed Audiveris CLI
 * (https://github.com/Audiveris/audiveris), chosen because, unlike most
 * open-source alternatives, it exports .mxl directly. It fails loudly when
 * unconfigured rather than fabricating output, so the pipeline stays honest
 * about what it can and can't do yet. */

export interface OmrEngine {
  /** Returns MusicXML text recognized from the given file. */
  recognize(fileBuffer: Buffer, kind: "pdf" | "photo"): Promise<string>;
}

export class OmrEngineNotConfiguredError extends Error {}

export class AudiverisOmrEngine implements OmrEngine {
  async recognize(_fileBuffer: Buffer, _kind: "pdf" | "photo"): Promise<string> {
    const jarPath = process.env.AUDIVERIS_JAR_PATH;
    if (!jarPath) {
      throw new OmrEngineNotConfiguredError(
        "No OMR engine configured on this server. Set AUDIVERIS_JAR_PATH to a local Audiveris " +
          "installation (see server/omr/README.md) to enable PDF/photo recognition. MusicXML " +
          "import doesn't need this."
      );
    }

    // TODO(real integration): write fileBuffer to a temp input file, then run
    // Audiveris in batch mode and read back its output, e.g.:
    //
    //   const { execFile } = require("node:child_process");
    //   await execFile("java", ["-jar", jarPath, "-batch", "-export", "-output", tmpOutDir, tmpInputFile]);
    //   const mxl = await fs.readFile(path.join(tmpOutDir, `${baseName}.mxl`));
    //   return resolveMusicXmlText(mxl);
    //
    // Left unimplemented here: Audiveris bundles ~300MB of trained OMR models
    // that can't be installed in this environment, and wiring the exact CLI
    // flags/output layout without a real installation to verify against would
    // be guesswork rather than a working integration.
    throw new OmrEngineNotConfiguredError(
      "AUDIVERIS_JAR_PATH is set, but the Audiveris CLI integration itself is not yet implemented — see the TODO in engine/omrEngine.ts."
    );
  }
}

export function getOmrEngine(): OmrEngine {
  return new AudiverisOmrEngine();
}
