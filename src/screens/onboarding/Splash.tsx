import { useEffect } from "react";
import { useNavigator } from "../../navigation/Navigator";

export function Splash() {
  const nav = useNavigator();

  useEffect(() => {
    const t = setTimeout(() => nav.replace("firstrun"), 650);
    return () => clearTimeout(t);
  }, []);

  return (
    <div className="screen">
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 18,
        }}
      >
        <div
          style={{
            width: 72,
            height: 72,
            background: "var(--tint)",
            border: "1px solid var(--line)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontFamily: "var(--font-heading)",
            fontWeight: 700,
            fontSize: 30,
            color: "var(--acc)",
          }}
        >
          Z
        </div>
        <div style={{ fontFamily: "var(--font-wordmark)", fontSize: 50, letterSpacing: "0.02em", lineHeight: 1 }}>
          ZAMAR
        </div>
        <div style={{ width: 96, height: 2, background: "var(--line)", overflow: "hidden" }}>
          <div style={{ width: 46, height: 2, background: "var(--acc)" }} />
        </div>
      </div>
      <div className="text-center muted" style={{ fontSize: 11, paddingBottom: 22 }}>
        Make worship, made easier
      </div>
    </div>
  );
}
