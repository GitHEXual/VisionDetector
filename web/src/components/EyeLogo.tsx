import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import "./EyeLogo.css";

const PALETTE = "   ...:::---+++***◦◦••▢▣";
const CELL = 14;
const COLS = 26;
const ROWS = 16;

type EyeLogoProps = {
  to?: string;
  label?: string;
  size?: "md" | "sm";
};

function field(c: number, r: number, t: number) {
  const n =
    (Math.sin(c * 0.38 + t) +
      Math.sin(r * 0.52 - t * 0.7) +
      Math.sin((c + r) * 0.24 + t * 0.45) +
      Math.sin(Math.hypot(c - COLS * 0.5, r - ROWS * 0.5) * 0.22 - t * 0.5)) /
    4;
  return (n + 1) / 2;
}

function put(
  ctx: CanvasRenderingContext2D,
  ch: string,
  c: number,
  r: number,
  color: string,
) {
  ctx.fillStyle = color;
  ctx.fillText(ch, c * CELL, r * CELL);
}

export function EyeLogo({ to = "/", label = "Око", size = "md" }: EyeLogoProps) {
  const rootRef = useRef<HTMLAnchorElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    const canvas = canvasRef.current;
    if (!root || !canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = COLS * CELL;
    const height = ROWS * CELL;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.font = `500 12px ${getComputedStyle(document.documentElement).getPropertyValue("--mono") || "JetBrains Mono, monospace"}`;
    ctx.textBaseline = "top";

    let tx = 0;
    let ty = 0;
    let lx = 0;
    let ly = 0;
    let blinkUntil = 0;
    let nextBlink = performance.now() + 2800;
    let raf = 0;
    let alive = true;

    const onMove = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      const ox = rect.left + rect.width / 2;
      const oy = rect.top + rect.height / 2;
      const dx = event.clientX - ox;
      const dy = event.clientY - oy;
      const dist = Math.hypot(dx, dy) || 1;
      const max = 2.1;
      const pull = Math.min(max, dist / 80);
      tx = (dx / dist) * pull;
      ty = (dy / dist) * pull * 0.52;
    };

    const draw = (now: number) => {
      const t = reduce ? 1.1 : (now / 1000) * 0.55;
      lx += (tx - lx) * 0.18;
      ly += (ty - ly) * 0.18;

      if (!reduce && now >= nextBlink) {
        blinkUntil = now + 150;
        nextBlink = now + 3400 + Math.random() * 3800;
      }
      const blinking = !reduce && now < blinkUntil;
      const midC = (COLS - 1) / 2;
      const midR = (ROWS - 1) / 2;

      ctx.clearRect(0, 0, width, height);

      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          const nx = (c - midC) / (COLS / 2.1);
          const ny = (r - midR) / (ROWS / 2.15);
          const eye = (nx * nx) / 0.92 + (ny * ny) / 0.62;
          if (eye > 1.16) continue;

          // upper / lower lid arcs
          const lidTop = eye > 0.84 && eye <= 1.06 && ny < -0.1;
          const lidBot = eye > 0.84 && eye <= 1.06 && ny > 0.14;
          if (lidTop) {
            put(ctx, ny < -0.55 ? "`" : "-", c, r, "rgba(250,246,235,0.78)");
            continue;
          }
          if (lidBot) {
            put(ctx, ny > 0.58 ? "," : "-", c, r, "rgba(250,246,235,0.55)");
            continue;
          }

          if (eye > 1) continue;

          // tear duct / outer corners
          if (eye > 0.9 && Math.abs(ny) < 0.22) {
            put(ctx, nx < 0 ? "<" : ">", c, r, "#ff6b35");
            continue;
          }

          if (blinking) {
            if (Math.abs(r - midR) <= 0.7 && eye < 0.95) {
              put(ctx, "═", c, r, "rgba(250,246,235,0.92)");
            }
            continue;
          }

          // hard outline of the eye opening
          if (eye > 0.78) {
            put(ctx, "+", c, r, "#ff6b35");
            continue;
          }

          const px = c - (midC + lx);
          const py = r - (midR + ly);
          const pupil = Math.hypot(px, py);
          const iris = Math.hypot(px * 0.98, py * 1.02);

          // pupil core
          if (pupil < 1.15) {
            put(ctx, "▣", c, r, "#ff6b35");
            continue;
          }
          // pupil rim
          if (pupil < 1.7) {
            put(ctx, "▢", c, r, "rgba(255,107,53,0.9)");
            continue;
          }
          // iris rings
          if (iris < 2.45) {
            put(ctx, "◦", c, r, "rgba(255,176,138,0.95)");
            continue;
          }
          if (iris < 3.2) {
            put(ctx, "*", c, r, "rgba(255,107,53,0.72)");
            continue;
          }
          if (iris < 3.85) {
            put(ctx, "+", c, r, "rgba(255,107,53,0.45)");
            continue;
          }

          // specular highlight on sclera/iris edge
          const hx = px + 1.5;
          const hy = py + 1.2;
          if (Math.hypot(hx, hy) < 0.85) {
            put(ctx, "•", c, r, "rgba(250,246,235,0.95)");
            continue;
          }

          // sclera texture — same language as the page bg, denser
          const v = field(c, r, t);
          if (v < 0.18) {
            put(ctx, ".", c, r, "rgba(250,246,235,0.28)");
            continue;
          }
          const index = Math.min(PALETTE.length - 1, Math.floor(v * PALETTE.length));
          const ch = PALETTE[index];
          if (ch === " ") {
            put(ctx, ".", c, r, "rgba(250,246,235,0.22)");
            continue;
          }
          put(ctx, ch, c, r, `rgba(250,246,235,${(0.42 + (v - 0.18) * 0.55).toFixed(3)})`);
        }
      }
    };

    const tick = (now: number) => {
      if (!alive) return;
      draw(now);
      if (!reduce) raf = requestAnimationFrame(tick);
    };

    window.addEventListener("pointermove", onMove, { passive: true });
    raf = requestAnimationFrame(tick);

    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", onMove);
    };
  }, []);

  return (
    <Link
      ref={rootRef}
      to={to}
      className={`eyeLogo${size === "sm" ? " eyeLogo--sm" : ""}`}
      aria-label={label}
    >
      <canvas ref={canvasRef} className="eyeLogoMark" />
    </Link>
  );
}
