import { useEffect, useRef, useState } from "react";
import { detectPitch } from "../../utils/pitch";

export type MicStatus = "idle" | "starting" | "listening" | "denied" | "unavailable";

/** How often the buffer is analysed. The detector costs a few milliseconds
 * per pass, so ~20 Hz keeps the needle lively without pinning the CPU. */
const ANALYSE_MS = 50;
/** Readings kept for the median filter that steadies the needle. */
const SMOOTHING = 5;
/** After this long with no clear pitch, the reading is dropped and the
 * screen goes back to "Listening for a note…". */
const HOLD_MS = 1200;

/** Opens the microphone while `enabled` and reports a smoothed fundamental
 * frequency (null when nothing clear is heard). Audio stays inside a Web
 * Audio graph on the device: nothing is recorded or uploaded. The stream is
 * released on unmount, when `enabled` goes false, and while the app is in
 * the background, so the OS mic indicator never outlives the Tuner. */
export function useMicPitch(enabled: boolean) {
  const [status, setStatus] = useState<MicStatus>("idle");
  const [freq, setFreq] = useState<number | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [hidden, setHidden] = useState(() => typeof document !== "undefined" && document.hidden);
  const recent = useRef<number[]>([]);

  useEffect(() => {
    const onVis = () => setHidden(document.hidden);
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  useEffect(() => {
    if (!enabled || hidden) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus("unavailable");
      return;
    }
    let cancelled = false;
    let stream: MediaStream | null = null;
    let ctx: AudioContext | null = null;
    let interval: ReturnType<typeof setInterval> | null = null;
    setStatus("starting");

    navigator.mediaDevices
      // Echo cancellation, noise suppression and AGC are tuned for speech
      // and smear a sustained instrument tone, so they're all turned off.
      .getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } })
      .then(async (s) => {
        if (cancelled) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        stream = s;
        const Ctor: typeof AudioContext = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        ctx = new Ctor();
        if (ctx.state === "suspended") await ctx.resume().catch(() => {});
        const source = ctx.createMediaStreamSource(s);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 4096;
        source.connect(analyser);
        const buf = new Float32Array(analyser.fftSize);
        let lastHeard = 0;
        setStatus("listening");
        interval = setInterval(() => {
          analyser.getFloatTimeDomainData(buf);
          const reading = detectPitch(buf, ctx!.sampleRate);
          const now = performance.now();
          if (reading) {
            lastHeard = now;
            const r = recent.current;
            // A jump of more than ~a semitone means a new note: restart the
            // median window instead of dragging the old note along.
            if (r.length && Math.abs(Math.log2(reading.freq / r[r.length - 1])) > 1 / 12) r.length = 0;
            r.push(reading.freq);
            if (r.length > SMOOTHING) r.shift();
            const sorted = [...r].sort((a, b) => a - b);
            setFreq(sorted[Math.floor(sorted.length / 2)]);
          } else if (now - lastHeard > HOLD_MS) {
            recent.current = [];
            setFreq(null);
          }
        }, ANALYSE_MS);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const name = (err as { name?: string })?.name;
        setStatus(name === "NotAllowedError" || name === "SecurityError" ? "denied" : "unavailable");
      });

    return () => {
      cancelled = true;
      if (interval) clearInterval(interval);
      stream?.getTracks().forEach((t) => t.stop());
      ctx?.close().catch(() => {});
      recent.current = [];
      setFreq(null);
    };
  }, [enabled, hidden, attempt]);

  return { status, freq, retry: () => setAttempt((a) => a + 1) };
}
