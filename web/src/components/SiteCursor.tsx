import { useEffect, useRef } from "react";
import "./siteCursor.css";

type CursorMode = "off" | "idle" | "hover" | "native";

const NATIVE_CURSOR = new Set([
  "text",
  "crosshair",
  "grab",
  "grabbing",
  "move",
  "col-resize",
  "row-resize",
  "ew-resize",
  "ns-resize",
  "nwse-resize",
  "nesw-resize",
  "zoom-in",
  "zoom-out",
  "not-allowed",
  "wait",
  "progress",
]);

const HOVER_SELECTOR =
  'a, button, [role="button"], [role="link"], [role="menuitem"], [role="tab"], [role="option"], summary, label';

function isTextField(el: Element): boolean {
  if (el.closest('[contenteditable="true"]')) return true;
  const field = el.closest("textarea, input");
  if (!(field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement)) return false;
  if (field instanceof HTMLTextAreaElement) return true;
  return !["button", "submit", "reset", "checkbox", "radio", "range", "file", "color"].includes(field.type);
}

function cursorMode(el: Element | null): CursorMode {
  if (!el) return "off";
  if (el.closest("[data-native-cursor]")) return "native";
  if (isTextField(el)) return "native";
  let node: Element | null = el;
  while (node && node !== document.documentElement) {
    const cursorValue: string = getComputedStyle(node).getPropertyValue("cursor");
    if (NATIVE_CURSOR.has(cursorValue)) return "native";
    if (cursorValue === "pointer" || node.matches(HOVER_SELECTOR)) return "hover";
    node = node.parentElement;
  }
  return "idle";
}

export function SiteCursor() {
  const hostRef = useRef<HTMLDivElement>(null);
  const homeRef = useRef<HTMLElement | null>(null);
  const dotRef = useRef<HTMLDivElement>(null);
  const ringRef = useRef<HTMLDivElement>(null);
  const arrowRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const fine = window.matchMedia("(hover: hover) and (pointer: fine)");
    if (!fine.matches) return;

    const root = document.documentElement;
    const host = hostRef.current;
    const dot = dotRef.current;
    const ring = ringRef.current;
    const arrow = arrowRef.current;
    if (!host || !dot || !ring || !arrow) return;

    homeRef.current = host.parentElement;
    let mx = window.innerWidth / 2;
    let my = window.innerHeight / 2;
    let rx = mx;
    let ry = my;
    let mode: CursorMode = "off";
    let raf = 0;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const follow = reduce ? 1 : 0.18;
    const maxLag = 18;

    const syncHost = () => {
      const fs = document.fullscreenElement;
      const home = homeRef.current;
      if (fs instanceof HTMLElement) {
        if (host.parentElement !== fs) fs.appendChild(host);
      } else if (home && host.parentElement !== home) {
        home.appendChild(host);
      }
    };

    const paint = () => {
      rx += (mx - rx) * follow;
      ry += (my - ry) * follow;
      const dx = rx - mx;
      const dy = ry - my;
      const dist = Math.hypot(dx, dy);
      if (dist > maxLag) {
        const scale = maxLag / dist;
        rx = mx + dx * scale;
        ry = my + dy * scale;
      }
      dot.style.transform = `translate3d(${mx}px, ${my}px, 0) translate(-50%, -50%)`;
      ring.style.transform = `translate3d(${rx}px, ${ry}px, 0) translate(-50%, -50%)`;
      arrow.style.transform = `translate3d(${mx}px, ${my}px, 0) translate(-2px, -2px)`;
      raf = requestAnimationFrame(paint);
    };

    const setMode = (next: CursorMode) => {
      if (next === mode) return;
      mode = next;
      root.dataset.appCursor = next;
    };

    const onMove = (event: PointerEvent) => {
      mx = event.clientX;
      my = event.clientY;
      const hit = document.elementFromPoint(event.clientX, event.clientY);
      setMode(cursorMode(hit));
    };

    const onLeave = () => setMode("off");

    root.dataset.appCursor = "off";
    syncHost();
    window.addEventListener("pointermove", onMove, { passive: true });
    document.addEventListener("pointerleave", onLeave);
    document.addEventListener("fullscreenchange", syncHost);
    raf = requestAnimationFrame(paint);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerleave", onLeave);
      document.removeEventListener("fullscreenchange", syncHost);
      delete root.dataset.appCursor;
      const home = homeRef.current;
      if (home && host.parentElement !== home) home.appendChild(host);
    };
  }, []);

  return (
    <div ref={hostRef} className="siteCursorHost" aria-hidden>
      <div ref={ringRef} className="siteCursor siteCursorRing" />
      <div ref={dotRef} className="siteCursor siteCursorDot" />
      <div ref={arrowRef} className="siteCursor siteCursorArrow">
        <svg viewBox="0 0 24 24" fill="#faf6eb" stroke="rgba(42, 35, 24, 0.72)" strokeWidth="1.15" strokeLinejoin="round">
          <path d="M3.688 3.037a.497.497 0 0 0-.651.651l6.5 15.999a.501.501 0 0 0 .947-.062l1.569-6.083a2 2 0 0 1 1.448-1.479l6.124-1.579a.5.5 0 0 0 .063-.947z" />
        </svg>
      </div>
    </div>
  );
}
