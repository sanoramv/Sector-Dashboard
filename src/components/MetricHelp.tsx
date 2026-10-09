import { useEffect, useId, useRef, useState } from "react";

export interface MetricHelpContent {
  title: string;
  formula?: string;
  explanation: string;
  example: string;
}

/** A "?" icon that reveals a formula + plain-English explanation + worked example on click. Keyboard- and screen-reader-accessible. */
export function MetricHelp({ content }: { content: MetricHelpContent }) {
  const [open, setOpen] = useState(false);
  const popoverId = useId();
  const containerRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <span ref={containerRef} style={{ position: "relative", display: "inline-flex" }}>
      <button
        type="button"
        className="help-icon-btn"
        aria-expanded={open}
        aria-describedby={open ? popoverId : undefined}
        aria-label={`What is ${content.title}?`}
        onClick={() => setOpen((v) => !v)}
      >
        ?
      </button>
      {open && (
        <div
          id={popoverId}
          role="dialog"
          aria-label={content.title}
          className="card"
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            left: 0,
            zIndex: 50,
            width: 280,
            padding: 12,
            fontSize: 12.5,
            fontWeight: 400,
            lineHeight: 1.5,
          }}
        >
          <div style={{ fontWeight: 700, marginBottom: 4 }}>{content.title}</div>
          {content.formula && (
            <div className="num text-muted" style={{ marginBottom: 6, fontSize: 12 }}>
              {content.formula}
            </div>
          )}
          <div style={{ marginBottom: 6 }}>{content.explanation}</div>
          <div className="text-muted">
            <strong>Example: </strong>
            {content.example}
          </div>
        </div>
      )}
    </span>
  );
}
