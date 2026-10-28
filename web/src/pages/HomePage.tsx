import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Navigate } from "react-router-dom";
import { readSession, writeSession } from "../auth/storage";
import { EyeLogo } from "../components/EyeLogo";
import {
  assets,
  cameraById,
  cameras,
  statusLabel,
  type Camera,
  type CameraStatus,
} from "../data/assets";
import "./dashboard.css";

const PLAYBACK_SPEEDS = [0.5, 1, 2, 4] as const;
type PlaybackSpeed = (typeof PLAYBACK_SPEEDS)[number];

const ARCHIVE_DAYS = 30;
const TIMELINE_DAY_SECONDS = 24 * 3600;
const TIMELINE_SPAN_SECONDS = ARCHIVE_DAYS * TIMELINE_DAY_SECONDS;
const TIMELINE_ZOOM_MIN = 0.15;
const TIMELINE_ZOOM_MAX = 96;
const TIMELINE_RANGE_MIN = 60 / TIMELINE_SPAN_SECONDS;
const TIMELINE_VIEW_PAD = 0.12;

function clampViewStart(start: number, span: number) {
  const pad = Math.max(span * TIMELINE_VIEW_PAD, 0.04);
  const minStart = Math.min(0, 1 - span) - pad;
  const maxStart = Math.max(0, 1 - span) + pad;
  return clamp(start, minStart, maxStart);
}

type TimelineDragMode = "scrub" | "range-start" | "range-end" | "range-move" | "range-create";

type TimelineDragState = {
  mode: TimelineDragMode;
  originProgress: number;
  originStart: number;
  originEnd: number;
  moved: boolean;
};

type StripPanState = {
  originX: number;
  originViewStart: number;
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function archiveOriginMs() {
  const origin = new Date();
  origin.setHours(0, 0, 0, 0);
  origin.setDate(origin.getDate() - (ARCHIVE_DAYS - 1));
  return origin.getTime();
}

function progressToDate(progress: number) {
  return new Date(archiveOriginMs() + progress * TIMELINE_SPAN_SECONDS * 1000);
}

function formatTimelineClock(progress: number, withSeconds = true) {
  const date = progressToDate(progress);
  const hours = date.getHours().toString().padStart(2, "0");
  const minutes = date.getMinutes().toString().padStart(2, "0");
  if (!withSeconds) return `${hours}:${minutes}`;
  const seconds = date.getSeconds().toString().padStart(2, "0");
  return `${hours}:${minutes}:${seconds}`;
}

function formatTimelineDate(progress: number) {
  const date = progressToDate(progress);
  const day = date.getDate().toString().padStart(2, "0");
  const month = (date.getMonth() + 1).toString().padStart(2, "0");
  return `${day}.${month}`;
}

function formatTimelineStamp(progress: number, withSeconds = true) {
  return `${formatTimelineDate(progress)} ${formatTimelineClock(progress, withSeconds)}`;
}

type StripMarkKind = "date" | "time";

type StripMark = {
  key: string;
  progress: number;
  kind: StripMarkKind;
  label: string;
};

const STRIP_STEP_SECONDS = [
  60,
  2 * 60,
  5 * 60,
  10 * 60,
  15 * 60,
  30 * 60,
  60 * 60,
  2 * 3600,
  3 * 3600,
  6 * 3600,
  12 * 3600,
  TIMELINE_DAY_SECONDS,
  2 * TIMELINE_DAY_SECONDS,
  7 * TIMELINE_DAY_SECONDS,
] as const;

const STRIP_TARGET_LABELS = 6;

function chooseStripStepSeconds(viewSpan: number) {
  const visibleSeconds = Math.max(viewSpan * TIMELINE_SPAN_SECONDS, 60);
  const target = visibleSeconds / STRIP_TARGET_LABELS;
  return STRIP_STEP_SECONDS.find((step) => step >= target) ?? STRIP_STEP_SECONDS[STRIP_STEP_SECONDS.length - 1];
}

function alignStripCursor(date: Date, stepSeconds: number) {
  const cursor = new Date(date);
  if (stepSeconds >= TIMELINE_DAY_SECONDS) {
    cursor.setHours(0, 0, 0, 0);
    const dayStep = Math.round(stepSeconds / TIMELINE_DAY_SECONDS);
    if (dayStep >= 7) {
      const mondayOffset = (cursor.getDay() + 6) % 7;
      cursor.setDate(cursor.getDate() - mondayOffset);
    }
    if (cursor.getTime() < date.getTime()) {
      cursor.setDate(cursor.getDate() + dayStep);
    }
    return cursor;
  }

  cursor.setSeconds(0, 0);
  if (stepSeconds >= 3600) {
    const hourStep = Math.max(1, Math.round(stepSeconds / 3600));
    const hour = Math.ceil(cursor.getHours() / hourStep) * hourStep;
    cursor.setMinutes(0, 0, 0);
    cursor.setHours(0, 0, 0, 0);
    cursor.setHours(hour);
    if (cursor.getTime() < date.getTime()) cursor.setHours(hour + hourStep);
    return cursor;
  }

  const minuteStep = Math.max(1, Math.round(stepSeconds / 60));
  const minutes = Math.ceil((cursor.getHours() * 60 + cursor.getMinutes()) / minuteStep) * minuteStep;
  cursor.setHours(0, 0, 0, 0);
  cursor.setMinutes(minutes);
  if (cursor.getTime() < date.getTime()) cursor.setMinutes(minutes + minuteStep);
  return cursor;
}

function formatStripTimeLabel(date: Date, stepSeconds: number) {
  const hours = date.getHours().toString().padStart(2, "0");
  const minutes = date.getMinutes().toString().padStart(2, "0");
  if (stepSeconds < 60) {
    const seconds = date.getSeconds().toString().padStart(2, "0");
    return `${hours}:${minutes}:${seconds}`;
  }
  return `${hours}:${minutes}`;
}

function parseTimelineClock(value: string, fallbackDayProgress?: number) {
  const stamped = value.trim().match(/^(\d{1,2})\.(\d{1,2})(?:\.(\d{2,4}))?\s+(\d{1,2}):([0-5]?\d)(?::([0-5]?\d))?$/);
  if (stamped) {
    const day = Number(stamped[1]);
    const month = Number(stamped[2]) - 1;
    const yearRaw = stamped[3] ? Number(stamped[3]) : progressToDate(fallbackDayProgress ?? 0.5).getFullYear();
    const year = yearRaw < 100 ? 2000 + yearRaw : yearRaw;
    const hours = Number(stamped[4]);
    const minutes = Number(stamped[5]);
    const seconds = Number(stamped[6] ?? 0);
    const date = new Date(year, month, day, hours, minutes, seconds);
    if (Number.isNaN(date.getTime())) return null;
    const progress = (date.getTime() - archiveOriginMs()) / (TIMELINE_SPAN_SECONDS * 1000);
    return clamp(progress, 0, 1);
  }

  const match = value.trim().match(/^(\d{1,2}):([0-5]?\d)(?::([0-5]?\d))?$/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3] ?? 0);
  if (hours > 23) return null;
  const base = progressToDate(fallbackDayProgress ?? 0.5);
  const date = new Date(base.getFullYear(), base.getMonth(), base.getDate(), hours, minutes, seconds);
  const progress = (date.getTime() - archiveOriginMs()) / (TIMELINE_SPAN_SECONDS * 1000);
  return clamp(progress, 0, 1);
}

function snapTimelineProgress(value: number, viewSpan: number) {
  const step =
    viewSpan > 0.35 ? 60 * 60 : viewSpan > 0.12 ? 15 * 60 : viewSpan > 0.05 ? 5 * 60 : viewSpan > 0.02 ? 60 : 15;
  const seconds = Math.round((value * TIMELINE_SPAN_SECONDS) / step) * step;
  return clamp(seconds / TIMELINE_SPAN_SECONDS, 0, 1);
}

function timelineStripMarks(viewStart: number, viewSpan: number): StripMark[] {
  const stepSeconds = chooseStripStepSeconds(viewSpan);
  const startMs = archiveOriginMs() + viewStart * TIMELINE_SPAN_SECONDS * 1000;
  const endMs = archiveOriginMs() + (viewStart + viewSpan) * TIMELINE_SPAN_SECONDS * 1000;
  let cursor = alignStripCursor(new Date(startMs), stepSeconds);
  const marks: StripMark[] = [];
  let guard = 0;
  const dateOnly = stepSeconds >= TIMELINE_DAY_SECONDS;

  while (cursor.getTime() <= endMs + 1 && guard < 24) {
    guard += 1;
    const progress = (cursor.getTime() - archiveOriginMs()) / (TIMELINE_SPAN_SECONDS * 1000);
    const isMidnight = cursor.getHours() === 0 && cursor.getMinutes() === 0 && cursor.getSeconds() === 0;

    if (dateOnly || isMidnight) {
      marks.push({
        key: `date-${cursor.getTime()}`,
        progress,
        kind: "date",
        label: formatTimelineDate(progress),
      });
    } else {
      marks.push({
        key: `time-${cursor.getTime()}`,
        progress,
        kind: "time",
        label: formatStripTimeLabel(cursor, stepSeconds),
      });
    }

    cursor = new Date(cursor.getTime() + stepSeconds * 1000);
  }

  if (marks.length === 0) {
    const progress = viewStart + viewSpan / 2;
    marks.push({
      key: "fallback",
      progress,
      kind: dateOnly ? "date" : "time",
      label: dateOnly ? formatTimelineDate(progress) : formatTimelineClock(progress, false),
    });
  }

  if (marks.length <= 7) return marks;

  const dates = marks.filter((mark) => mark.kind === "date");
  const times = marks.filter((mark) => mark.kind === "time");
  const timeBudget = Math.max(3, 7 - dates.length);
  const stride = Math.max(1, Math.ceil(times.length / timeBudget));
  const thinnedTimes = times.filter((_, index) => index % stride === 0).slice(0, timeBudget);
  return [...dates, ...thinnedTimes].sort((a, b) => a.progress - b.progress);
}

function timelineMarks(viewStart: number, viewSpan: number) {
  const stepSeconds = chooseStripStepSeconds(viewSpan);
  const count = 4;
  return Array.from({ length: count }, (_, index) => {
    const t = viewStart + (viewSpan * index) / (count - 1);
    return {
      key: `${index}-${t.toFixed(5)}`,
      label: stepSeconds >= TIMELINE_DAY_SECONDS ? formatTimelineDate(t) : formatTimelineStamp(t, false),
    };
  });
}

type GridLayout = {
  id: string;
  label: string;
  cols: number;
  rows: number;
};

const GRID_LAYOUTS: GridLayout[] = [
  { id: "1", label: "1 камера", cols: 1, rows: 1 },
  { id: "2x2", label: "2×2", cols: 2, rows: 2 },
  { id: "3x2", label: "3×2", cols: 3, rows: 2 },
  { id: "3x3", label: "3×3", cols: 3, rows: 3 },
  { id: "4x4", label: "4×4", cols: 4, rows: 4 },
  { id: "5x5", label: "5×5", cols: 5, rows: 5 },
];

function statusClass(status: CameraStatus) {
  return `dashStatus dashStatus--${status}`;
}

function pageItems(total: number, current: number): Array<number | "gap"> {
  if (total <= 7) return Array.from({ length: total }, (_, index) => index);

  const items: Array<number | "gap"> = [];
  const push = (value: number | "gap") => {
    if (items[items.length - 1] === value) return;
    items.push(value);
  };

  push(0);
  const start = Math.max(1, current - 1);
  const end = Math.min(total - 2, current + 1);

  if (start > 1) push("gap");
  for (let pageIndex = start; pageIndex <= end; pageIndex++) push(pageIndex);
  if (end < total - 2) push("gap");
  push(total - 1);

  return items;
}

function GridLayoutIcon({ cols, rows }: { cols: number; rows: number }) {
  const size = 20;
  const gap = cols >= 5 || rows >= 5 ? 1 : cols >= 4 || rows >= 4 ? 1.25 : 1.5;
  const cell = Math.min(
    (size - gap * (cols - 1)) / cols,
    (size - gap * (rows - 1)) / rows,
  );
  const gridW = cell * cols + gap * (cols - 1);
  const gridH = cell * rows + gap * (rows - 1);
  const ox = (size - gridW) / 2;
  const oy = (size - gridH) / 2;

  return (
    <svg className="gridIcon" viewBox={`0 0 ${size} ${size}`} width={size} height={size} aria-hidden>
      {Array.from({ length: rows * cols }, (_, index) => {
        const c = index % cols;
        const r = Math.floor(index / cols);
        return (
          <rect
            key={index}
            x={ox + c * (cell + gap)}
            y={oy + r * (cell + gap)}
            width={cell}
            height={cell}
            fill="currentColor"
          />
        );
      })}
    </svg>
  );
}

function CameraTile({ camera }: { camera: Camera }) {
  return (
    <article className={`cameraTile cameraTile--${camera.status}`}>
      <div className="cameraTileFeed" aria-hidden>
        <div className="cameraTileNoise" />
        <div className="cameraTileMark">NO SIGNAL</div>
      </div>
      <footer className="cameraTileMeta">
        <div>
          <div className="cameraTileName">{camera.name}</div>
          <div className="cameraTileCode">
            {camera.code} · {camera.location}
          </div>
        </div>
        <span className={`cameraTileStatus cameraTileStatus--${camera.status}`}>
          <i aria-hidden />
          {statusLabel[camera.status]}
        </span>
      </footer>
    </article>
  );
}

export function HomePage() {
  const session = readSession();
  const mainRef = useRef<HTMLElement>(null);
  const [selectedAssetId, setSelectedAssetId] = useState(assets[0].id);
  const [expandedAssetId, setExpandedAssetId] = useState<string | null>(assets[0].id);
  const [query, setQuery] = useState("");
  const [layoutId, setLayoutId] = useState("3x3");
  const [layoutMenuOpen, setLayoutMenuOpen] = useState(false);
  const [selectedCameraId, setSelectedCameraId] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isLive, setIsLive] = useState(true);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState<PlaybackSpeed>(1);
  const [progress, setProgress] = useState(1);
  const [timelineZoom, setTimelineZoom] = useState(1);
  const [timelineViewStart, setTimelineViewStart] = useState(0);
  const [rangeStart, setRangeStart] = useState(0.82);
  const [rangeEnd, setRangeEnd] = useState(0.9);
  const layoutMenuRef = useRef<HTMLDivElement>(null);
  const timelineRef = useRef<HTMLDivElement>(null);
  const timelineStripRef = useRef<HTMLDivElement>(null);
  const timelineViewRef = useRef({ zoom: TIMELINE_ZOOM_MIN, start: 0 });
  const timelineDragRef = useRef<TimelineDragState | null>(null);
  const stripPanRef = useRef<StripPanState | null>(null);
  const rangeRef = useRef({ start: 0.82, end: 0.9 });
  const layoutBeforeCameraFs = useRef("3x3");
  const pageBeforeCameraFs = useRef(0);
  const restoringFromCameraFs = useRef(false);
  const cameraFullscreen = useRef(false);
  const [rangeStartDraft, setRangeStartDraft] = useState(() => formatTimelineStamp(0.82));
  const [rangeEndDraft, setRangeEndDraft] = useState(() => formatTimelineStamp(0.9));
  const [stripPanning, setStripPanning] = useState(false);
  const [scrubbing, setScrubbing] = useState(false);

  const timelineViewSpan = 1 / timelineZoom;
  const timelineMarksList = useMemo(
    () => timelineMarks(timelineViewStart, timelineViewSpan),
    [timelineViewStart, timelineViewSpan],
  );
  const timelineStripMarksList = useMemo(
    () => timelineStripMarks(timelineViewStart, timelineViewSpan),
    [timelineViewStart, timelineViewSpan],
  );
  const playhead = isLive ? progress : clamp(progress, rangeStart, rangeEnd);
  const thumbInView = (playhead - timelineViewStart) / timelineViewSpan;
  const rangeStartInView = (rangeStart - timelineViewStart) / timelineViewSpan;
  const rangeEndInView = (rangeEnd - timelineViewStart) / timelineViewSpan;
  const fillStartInView = clamp(rangeStartInView, 0, 1);
  const fillEndInView = clamp(thumbInView, 0, 1);
  const fragmentFill =
    !isLive && fillEndInView > fillStartInView
      ? {
          left: fillStartInView * 100,
          width: (fillEndInView - fillStartInView) * 100,
        }
      : null;
  const rangeVisible =
    rangeEndInView > 0 && rangeStartInView < 1
      ? {
          left: clamp(rangeStartInView, 0, 1) * 100,
          right: (1 - clamp(rangeEndInView, 0, 1)) * 100,
        }
      : null;

  const layout = GRID_LAYOUTS.find((item) => item.id === layoutId) ?? GRID_LAYOUTS[3];
  const selectedAsset = assets.find((asset) => asset.id === selectedAssetId) ?? assets[0];
  const capacity = layout.cols * layout.rows;

  const filteredCameras = useMemo(() => {
    const list = selectedAsset.cameraIds
      .map((id) => cameraById(id))
      .filter((camera): camera is Camera => Boolean(camera));
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (camera) =>
        camera.name.toLowerCase().includes(q) ||
        camera.code.toLowerCase().includes(q) ||
        camera.location.toLowerCase().includes(q),
    );
  }, [selectedAsset, query]);

  const totalPages = Math.max(1, Math.ceil(filteredCameras.length / capacity) || 1);
  const safePage = Math.min(page, totalPages - 1);
  const pagerItems = useMemo(() => pageItems(totalPages, safePage), [totalPages, safePage]);

  const visibleCameras = useMemo(() => {
    if (filteredCameras.length === 0) return [];
    const start = safePage * capacity;
    return filteredCameras.slice(start, start + capacity);
  }, [filteredCameras, capacity, safePage]);

  const selectedCamera =
    (selectedCameraId ? cameraById(selectedCameraId) : null) ?? visibleCameras[0] ?? filteredCameras[0] ?? null;

  useEffect(() => {
    setPage(0);
  }, [selectedAssetId, query]);

  useEffect(() => {
    if (cameraFullscreen.current || restoringFromCameraFs.current) return;
    setPage(0);
  }, [layoutId]);

  useEffect(() => {
    if (restoringFromCameraFs.current) {
      restoringFromCameraFs.current = false;
      return;
    }
    if (page !== safePage) setPage(safePage);
  }, [page, safePage]);

  const onlineCount = cameras.filter((camera) => camera.status === "online").length;
  const alarmCount = cameras.filter((camera) => camera.status === "alarm").length;
  const offlineCount = cameras.filter((camera) => camera.status === "offline").length;

  useEffect(() => {
    const onFullscreenChange = () => {
      const active = document.fullscreenElement === mainRef.current;
      setIsFullscreen(active);
      if (!active && cameraFullscreen.current) {
        cameraFullscreen.current = false;
        restoringFromCameraFs.current = true;
        setLayoutId(layoutBeforeCameraFs.current);
        setPage(pageBeforeCameraFs.current);
      }
    };
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, []);

  useEffect(() => {
    if (!layoutMenuOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!layoutMenuRef.current?.contains(event.target as Node)) {
        setLayoutMenuOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setLayoutMenuOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [layoutMenuOpen]);

  const enterFullscreen = async () => {
    const node = mainRef.current;
    if (!node || document.fullscreenElement === node) return;
    try {
      await node.requestFullscreen();
    } catch {
      // Fullscreen can be blocked by the browser; keep UI usable.
    }
  };

  const toggleFullscreen = async () => {
    const node = mainRef.current;
    if (!node) return;
    try {
      if (document.fullscreenElement === node) await document.exitFullscreen();
      else {
        cameraFullscreen.current = false;
        await node.requestFullscreen();
      }
    } catch {
      // Fullscreen can be blocked by the browser; keep UI usable.
    }
  };

  const openCameraFullscreen = (cameraId: string) => {
    setSelectedCameraId(cameraId);
    const cameraIndex = filteredCameras.findIndex((camera) => camera.id === cameraId);
    pageBeforeCameraFs.current = page;
    if (layoutId !== "1") {
      layoutBeforeCameraFs.current = layoutId;
      setLayoutId("1");
      if (cameraIndex >= 0) setPage(cameraIndex);
    } else if (cameraIndex >= 0) {
      setPage(cameraIndex);
    }
    cameraFullscreen.current = true;
    void enterFullscreen();
  };

  const goToPage = (next: number) => {
    setPage(Math.max(0, Math.min(totalPages - 1, next)));
  };

  useEffect(() => {
    timelineViewRef.current = { zoom: timelineZoom, start: timelineViewStart };
  }, [timelineZoom, timelineViewStart]);

  useEffect(() => {
    rangeRef.current = { start: rangeStart, end: rangeEnd };
    if (!timelineDragRef.current) {
      setRangeStartDraft(formatTimelineStamp(rangeStart));
      setRangeEndDraft(formatTimelineStamp(rangeEnd));
    }
  }, [rangeStart, rangeEnd]);

  useEffect(() => {
    if (!isPlaying || isLive) return;
    const timer = window.setInterval(() => {
      const { start, end } = rangeRef.current;
      setProgress((value) => {
        const next = value + 0.0018 * speed;
        if (next >= end) {
          setIsPlaying(false);
          return end;
        }
        return clamp(next, start, end);
      });
    }, 50);
    return () => window.clearInterval(timer);
  }, [isPlaying, isLive, speed]);

  useEffect(() => {
    if (isLive) return;
    setProgress((value) => clamp(value, rangeStart, rangeEnd));
  }, [rangeStart, rangeEnd, isLive]);

  const focusTimelineOn = (target: number, anchor = 0.82) => {
    const span = 1 / timelineViewRef.current.zoom;
    const safeAnchor = clamp(anchor, 0.05, 0.95);
    setTimelineViewStart(clampViewStart(target - span * safeAnchor, span));
  };

  useEffect(() => {
    const { zoom, start } = timelineViewRef.current;
    const span = 1 / zoom;
    if (isLive) {
      // Keep the live edge at the right end of the viewport.
      const livePos = (1 - start) / span;
      if (livePos < 0.97 || livePos > 1.02) {
        setTimelineViewStart(clampViewStart(1 - span, span));
      }
      return;
    }
    if (progress < start) {
      setTimelineViewStart(clampViewStart(progress, span));
      return;
    }
    if (progress > start + span) {
      setTimelineViewStart(clampViewStart(progress - span, span));
    }
  }, [progress, isLive, timelineZoom]);

  useEffect(() => {
    const zoomAtClientX = (node: HTMLElement, clientX: number, deltaY: number) => {
      const rect = node.getBoundingClientRect();
      if (rect.width <= 0) return;

      const { zoom, start } = timelineViewRef.current;
      const span = 1 / zoom;
      const ratio = clamp((clientX - rect.left) / rect.width, 0, 1);
      const focus = start + ratio * span;
      const factor = deltaY < 0 ? 1.18 : 1 / 1.18;
      const nextZoom = clamp(Number((zoom * factor).toFixed(3)), TIMELINE_ZOOM_MIN, TIMELINE_ZOOM_MAX);
      const nextSpan = 1 / nextZoom;
      const nextStart = clampViewStart(focus - ratio * nextSpan, nextSpan);

      setTimelineZoom(nextZoom);
      setTimelineViewStart(nextStart);
    };

    const track = timelineRef.current;
    const strip = timelineStripRef.current;
    const onTrackWheel = (event: WheelEvent) => {
      event.preventDefault();
      if (!track) return;
      zoomAtClientX(track, event.clientX, event.deltaY);
    };
    const onStripWheel = (event: WheelEvent) => {
      event.preventDefault();
      if (!strip) return;
      zoomAtClientX(strip, event.clientX, event.deltaY);
    };

    track?.addEventListener("wheel", onTrackWheel, { passive: false });
    strip?.addEventListener("wheel", onStripWheel, { passive: false });
    return () => {
      track?.removeEventListener("wheel", onTrackWheel);
      strip?.removeEventListener("wheel", onStripWheel);
    };
  }, []);

  const clientXToProgress = (clientX: number) => {
    const track = timelineRef.current;
    if (!track) return null;
    const rect = track.getBoundingClientRect();
    if (rect.width <= 0) return null;
    const { zoom, start } = timelineViewRef.current;
    const span = 1 / zoom;
    const ratio = clamp((clientX - rect.left) / rect.width, 0, 1);
    return clamp(start + ratio * span, 0, 1);
  };

  const setFragmentRange = (start: number, end: number, opts?: { seekStart?: boolean }) => {
    const nextStart = clamp(start, 0, 1 - TIMELINE_RANGE_MIN);
    const nextEnd = clamp(end, nextStart + TIMELINE_RANGE_MIN, 1);
    setRangeStart(nextStart);
    setRangeEnd(nextEnd);
    rangeRef.current = { start: nextStart, end: nextEnd };
    setIsLive(false);
    setIsPlaying(false);
    if (opts?.seekStart) setProgress(nextStart);
    else setProgress((value) => clamp(value, nextStart, nextEnd));
  };

  const applyTimelineDrag = (clientX: number, snap = false) => {
    const raw = clientXToProgress(clientX);
    const drag = timelineDragRef.current;
    if (raw == null || !drag) return;

    const next = snap ? snapTimelineProgress(raw, timelineViewSpan) : raw;
    if (Math.abs(next - drag.originProgress) > timelineViewSpan * 0.004) drag.moved = true;

    if (drag.mode === "scrub") {
      const { start, end } = rangeRef.current;
      setIsLive(false);
      setProgress(clamp(next, start, end));
      return;
    }

    if (drag.mode === "range-start") {
      const value = clamp(next, 0, drag.originEnd - TIMELINE_RANGE_MIN);
      setFragmentRange(value, drag.originEnd);
      return;
    }

    if (drag.mode === "range-end") {
      const value = clamp(next, drag.originStart + TIMELINE_RANGE_MIN, 1);
      setFragmentRange(drag.originStart, value);
      return;
    }

    if (drag.mode === "range-move") {
      const span = drag.originEnd - drag.originStart;
      const delta = next - drag.originProgress;
      const movedStart = clamp(drag.originStart + delta, 0, 1 - span);
      setFragmentRange(movedStart, movedStart + span);
      return;
    }

    if (drag.mode === "range-create") {
      const a = drag.originProgress;
      const b = next;
      const start = Math.min(a, b);
      const end = Math.max(a, b);
      const viewSpan = 1 / timelineViewRef.current.zoom;
      // Wide enough default on click so both handles are easy to grab.
      const defaultSpan = clamp(viewSpan * 0.22, viewSpan * 0.14, Math.min(viewSpan * 0.4, 0.3));
      if (!drag.moved || end - start < defaultSpan * 0.45) {
        const nextStart = clamp(a - defaultSpan * 0.35, 0, 1 - defaultSpan);
        setFragmentRange(nextStart, nextStart + defaultSpan, { seekStart: true });
        return;
      }
      setFragmentRange(start, end, { seekStart: true });
    }
  };

  const onTimelinePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const target = event.target as HTMLElement;
    const handle = target.dataset.timelineHandle as TimelineDragMode | undefined;
    const at = clientXToProgress(event.clientX);
    if (at == null) return;

    const { start, end } = rangeRef.current;
    let mode: TimelineDragMode = "range-create";
    if (handle === "range-start" || handle === "range-end" || handle === "scrub") {
      mode = handle;
    } else if (handle === "range-move" || (at >= start && at <= end)) {
      mode = event.shiftKey ? "scrub" : "range-move";
    }

    timelineDragRef.current = {
      mode,
      originProgress: at,
      originStart: start,
      originEnd: end,
      moved: false,
    };
    setScrubbing(mode === "scrub");
    event.currentTarget.setPointerCapture(event.pointerId);
    applyTimelineDrag(event.clientX, event.altKey);
  };

  const onTimelinePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    applyTimelineDrag(event.clientX, event.altKey);
  };

  const onTimelinePointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = timelineDragRef.current;
    if (drag && !drag.moved && (drag.mode === "range-move" || drag.mode === "scrub")) {
      const { start, end } = rangeRef.current;
      setIsLive(false);
      setProgress(clamp(drag.originProgress, start, end));
    }
    if (drag && event.altKey) applyTimelineDrag(event.clientX, true);
    timelineDragRef.current = null;
    setScrubbing(false);
    setRangeStartDraft(formatTimelineStamp(rangeRef.current.start));
    setRangeEndDraft(formatTimelineStamp(rangeRef.current.end));
  };

  const onStripPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    stripPanRef.current = {
      originX: event.clientX,
      originViewStart: timelineViewRef.current.start,
    };
    setStripPanning(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onStripPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const pan = stripPanRef.current;
    const strip = timelineStripRef.current;
    if (!pan || !strip || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
    const width = strip.getBoundingClientRect().width;
    if (width <= 0) return;
    const span = 1 / timelineViewRef.current.zoom;
    const delta = ((event.clientX - pan.originX) / width) * span;
    setTimelineViewStart(clampViewStart(pan.originViewStart - delta, span));
  };

  const onStripPointerUp = () => {
    stripPanRef.current = null;
    setStripPanning(false);
  };

  const commitRangeDraft = (edge: "start" | "end") => {
    const fallback = edge === "start" ? rangeStart : rangeEnd;
    const parsed = parseTimelineClock(edge === "start" ? rangeStartDraft : rangeEndDraft, fallback);
    if (parsed == null) {
      setRangeStartDraft(formatTimelineStamp(rangeStart));
      setRangeEndDraft(formatTimelineStamp(rangeEnd));
      return;
    }
    if (edge === "start") setFragmentRange(parsed, rangeEnd, { seekStart: true });
    else setFragmentRange(rangeStart, parsed);
  };

  const nudgeRangeEdge = (edge: "start" | "end", direction: -1 | 1) => {
    const step = Math.max(TIMELINE_RANGE_MIN, timelineViewSpan * 0.02);
    if (edge === "start") setFragmentRange(rangeStart + direction * step, rangeEnd, { seekStart: true });
    else setFragmentRange(rangeStart, rangeEnd + direction * step);
  };

  const fitFragmentInView = () => {
    const span = Math.max(rangeEnd - rangeStart, 1 / TIMELINE_ZOOM_MAX);
    const padded = Math.max(span * 1.35, 1 / TIMELINE_ZOOM_MAX);
    const zoom = clamp(1 / padded, TIMELINE_ZOOM_MIN, TIMELINE_ZOOM_MAX);
    const viewSpan = 1 / zoom;
    const center = (rangeStart + rangeEnd) / 2;
    setTimelineZoom(zoom);
    setTimelineViewStart(clampViewStart(center - viewSpan / 2, viewSpan));
  };

  const stepTimeline = (direction: -1 | 1) => {
    const { start, end } = rangeRef.current;
    setIsLive(false);
    setIsPlaying(false);
    const step = Math.max(0.002, timelineViewSpan * 0.04);
    setProgress((value) => clamp(value + direction * step, start, end));
  };

  const togglePlayFragment = () => {
    if (isPlaying) {
      setIsPlaying(false);
      return;
    }
    const { start, end } = rangeRef.current;
    setIsLive(false);
    // Resume from the current playhead; restart only at the end or outside the fragment.
    setProgress((value) => {
      if (value < start || value >= end - 1e-6) return start;
      return clamp(value, start, end);
    });
    setIsPlaying(true);
  };

  const goLive = () => {
    setIsPlaying(false);
    setIsLive(true);
    setProgress(1);
    // Jump viewport so "now" sits at the right edge of the timeline.
    focusTimelineOn(1, 1);
  };

  const downloadFragment = () => {
    const camera = selectedCamera;
    const payload = {
      type: "visiondetector-archive-fragment",
      exportedAt: new Date().toISOString(),
      camera: camera
        ? {
            id: camera.id,
            name: camera.name,
            code: camera.code,
            location: camera.location,
          }
        : null,
      asset: {
        id: selectedAsset.id,
        name: selectedAsset.name,
      },
      range: {
        start: formatTimelineStamp(rangeStart),
        end: formatTimelineStamp(rangeEnd),
        startProgress: Number(rangeStart.toFixed(6)),
        endProgress: Number(rangeEnd.toFixed(6)),
        durationSeconds: Math.round((rangeEnd - rangeStart) * TIMELINE_SPAN_SECONDS),
      },
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const stamp = formatTimelineStamp(rangeStart).replaceAll(/[.:\s]/g, "");
    link.href = url;
    link.download = `fragment_${camera?.code ?? "cam"}_${stamp}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  if (!session) return <Navigate to="/login" replace />;

  return (
    <main className="dash">
      <header className="dashChrome">
        <div className="dashBrand">
          <EyeLogo to="/" size="sm" />
          <div className="dashBrandMeta">
            <div className="dashKicker">Мониторинг</div>
            <div className="dashTitle">Все камеры</div>
          </div>
        </div>
        <div className="dashChromeRight">
          <div className="dashAccount">
            <div className="dashAccountAvatar" aria-hidden>
              {(session.name.trim().slice(0, 1) || session.login.slice(0, 1) || "?").toUpperCase()}
            </div>
            <div className="dashAccountMeta">
              <span className="dashAccountName">{session.name}</span>
              <span className="dashAccountLogin">@{session.login}</span>
            </div>
            <button
              className="dashLogout"
              type="button"
              onClick={() => {
                writeSession(null);
                window.location.assign("/login");
              }}
            >
              <svg viewBox="0 0 24 24" aria-hidden>
                <path
                  d="M10 5H6.8C5.8 5 5 5.8 5 6.8v10.4C5 18.2 5.8 19 6.8 19H10"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                />
                <path
                  d="M10 12h9m0 0-3.2-3.2M19 12l-3.2 3.2"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              Выйти
            </button>
          </div>
        </div>
      </header>

      <section className="dashBody">
        <aside className="dashSidebar">
          <div className="dashSideHead">
            <div>
              <div className="dashSideEyebrow">Навигация</div>
              <div className="dashSideLabel">Активы</div>
            </div>
            <div className="dashSideCount">{String(assets.length).padStart(2, "0")}</div>
          </div>

          <div className="dashSideSummary">
            <div className="dashSideStat dashSideStat--online">
              <span className="dashSideStatLabel">online</span>
              <strong className="dashSideStatValue">{onlineCount}</strong>
            </div>
            <div className="dashSideStat dashSideStat--alarm">
              <span className="dashSideStatLabel">alarm</span>
              <strong className="dashSideStatValue">{alarmCount}</strong>
            </div>
            <div className="dashSideStat dashSideStat--offline">
              <span className="dashSideStatLabel">off</span>
              <strong className="dashSideStatValue">{offlineCount}</strong>
            </div>
          </div>

          <ul className="assetList">
            {assets.map((asset, index) => {
              const active = asset.id === selectedAssetId;
              const expanded = asset.id === expandedAssetId;
              const alarms = asset.cameraIds.filter((id) => cameraById(id)?.status === "alarm").length;
              const online = asset.cameraIds.filter((id) => cameraById(id)?.status === "online").length;
              return (
                <li key={asset.id} className={`assetGroup${expanded ? " is-open" : ""}${active ? " is-active" : ""}`}>
                  <button
                    type="button"
                    className={`assetItem${active ? " is-active" : ""}${expanded ? " is-expanded" : ""}`}
                    aria-expanded={expanded}
                    onClick={() => {
                      if (expanded) {
                        setExpandedAssetId(null);
                        return;
                      }
                      setSelectedAssetId(asset.id);
                      setExpandedAssetId(asset.id);
                      setSelectedCameraId(null);
                    }}
                  >
                    <span className="assetIndex">{String(index + 1).padStart(2, "0")}</span>
                    <span className="assetItemMain">
                      <span className="assetName">{asset.name}</span>
                      <span className="assetMeta">
                        {asset.cameraIds.length} кам. · {online} online ·{" "}
                        {asset.kind === "site" ? "объект" : "зона"}
                      </span>
                    </span>
                    <span className="assetItemEnd">
                      {alarms > 0 && <span className="assetAlarm">{alarms}</span>}
                      <span className={`assetChevron${expanded ? " is-open" : ""}`} aria-hidden />
                    </span>
                  </button>
                  {expanded && (
                    <ul className="assetCameras">
                      {asset.cameraIds.map((id) => {
                        const camera = cameraById(id);
                        if (!camera) return null;
                        return (
                          <li key={id}>
                            <button
                              type="button"
                              className={`assetCamera${selectedCameraId === id ? " is-active" : ""}`}
                              onClick={() => openCameraFullscreen(id)}
                            >
                              <span className={`assetCamStatus ${statusClass(camera.status)}`} />
                              <span className="assetCamText">
                                <span className="assetCamName">{camera.name}</span>
                                <span className="assetCamCode">{camera.code}</span>
                              </span>
                              <span className={`assetCamBadge ${statusClass(camera.status)}`}>
                                {statusLabel[camera.status]}
                              </span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        </aside>

        <section
          ref={mainRef}
          className={`dashMain${isFullscreen ? " is-fullscreen" : ""}`}
        >
          <div className="dashToolbar">
            <div className="dashToolbarLeft">
              <div className="dashSideLabel">{selectedAsset.name}</div>
              <div className="dashStats">
                <span>
                  <i className="dashStatus dashStatus--online" />
                  {onlineCount}
                </span>
                <span>
                  <i className="dashStatus dashStatus--alarm" />
                  {alarmCount}
                </span>
                <span>
                  <i className="dashStatus dashStatus--offline" />
                  {offlineCount}
                </span>
              </div>
            </div>
            <div className="dashToolbarRight">
              <label className="dashSearch">
                <span>Поиск</span>
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Камера, код, зона"
                  spellCheck={false}
                />
              </label>
              <div className="dashPager" role="navigation" aria-label="Страницы камер">
                <button
                  type="button"
                  className="dashPagerArrow"
                  aria-label="Предыдущая страница"
                  disabled={safePage <= 0}
                  onClick={() => goToPage(safePage - 1)}
                >
                  <svg viewBox="0 0 24 24" aria-hidden>
                    <path d="M14.5 5.5 8 12l6.5 6.5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="square" />
                  </svg>
                </button>
                <div className="dashPagerPages">
                  {pagerItems.map((item, index) =>
                    item === "gap" ? (
                      <span key={`gap-${index}`} className="dashPagerGap" aria-hidden>
                        …
                      </span>
                    ) : (
                      <button
                        key={item}
                        type="button"
                        className={safePage === item ? "is-active" : undefined}
                        aria-label={`Страница ${item + 1}`}
                        aria-current={safePage === item ? "page" : undefined}
                        onClick={() => goToPage(item)}
                      >
                        {item + 1}
                      </button>
                    ),
                  )}
                </div>
                <button
                  type="button"
                  className="dashPagerArrow"
                  aria-label="Следующая страница"
                  disabled={safePage >= totalPages - 1}
                  onClick={() => goToPage(safePage + 1)}
                >
                  <svg viewBox="0 0 24 24" aria-hidden>
                    <path d="M9.5 5.5 16 12l-6.5 6.5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="square" />
                  </svg>
                </button>
              </div>
              <div className={`dashLayoutSelect${layoutMenuOpen ? " is-open" : ""}`} ref={layoutMenuRef}>
                <button
                  type="button"
                  className="dashLayoutTrigger"
                  aria-haspopup="listbox"
                  aria-expanded={layoutMenuOpen}
                  onClick={() => setLayoutMenuOpen((open) => !open)}
                >
                  <GridLayoutIcon cols={layout.cols} rows={layout.rows} />
                  <span>{layout.label}</span>
                  <span className="dashLayoutCaret" aria-hidden />
                </button>
                {layoutMenuOpen && (
                  <ul className="dashLayoutMenu" role="listbox" aria-label="Сетка камер">
                    {GRID_LAYOUTS.map((item) => (
                      <li key={item.id} role="option" aria-selected={layoutId === item.id}>
                        <button
                          type="button"
                          className={layoutId === item.id ? "is-active" : undefined}
                          onClick={() => {
                            setLayoutId(item.id);
                            setLayoutMenuOpen(false);
                          }}
                        >
                          <GridLayoutIcon cols={item.cols} rows={item.rows} />
                          <span>{item.label}</span>
                          <span className="dashLayoutCount">{item.cols * item.rows}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <button
                className={`dashFullscreen${isFullscreen ? " is-active" : ""}`}
                type="button"
                onClick={() => void toggleFullscreen()}
                aria-pressed={isFullscreen}
                aria-label={isFullscreen ? "Выйти из полного экрана" : "Открыть сетку на весь экран"}
                title={isFullscreen ? "Выйти из полного экрана" : "Открыть сетку на весь экран"}
              >
                {isFullscreen ? (
                  <svg viewBox="0 0 24 24" aria-hidden>
                    <path
                      d="M9 9H4M9 9V4M15 9h5M15 9V4M9 15H4M9 15v5M15 15h5M15 15v5"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.7"
                      strokeLinecap="square"
                    />
                  </svg>
                ) : (
                  <svg viewBox="0 0 24 24" aria-hidden>
                    <path
                      d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.7"
                      strokeLinecap="square"
                      strokeLinejoin="miter"
                    />
                  </svg>
                )}
              </button>
            </div>
          </div>

          <div
            className="cameraGrid"
            style={{
              // Cap column width by row height (~5:4) so tiles are less landscape while still filling height.
              gridTemplateColumns: `repeat(${layout.cols}, minmax(0, calc((100cqh - ${(layout.rows - 1)} * var(--camera-gap)) / ${layout.rows} * 1.22)))`,
              gridTemplateRows: `repeat(${layout.rows}, minmax(0, 1fr))`,
            }}
          >
            {filteredCameras.length === 0 ? (
              <div className="cameraEmpty">Нет камер по фильтру</div>
            ) : (
              Array.from({ length: capacity }, (_, index) => {
                const camera = visibleCameras[index];
                if (!camera) {
                  return <div key={`empty-${layout.id}-${index}`} className="cameraSlot cameraSlot--empty" />;
                }
                return (
                  <button
                    key={camera.id}
                    type="button"
                    className={`cameraHit${selectedCameraId === camera.id ? " is-active" : ""}`}
                    onClick={() => openCameraFullscreen(camera.id)}
                  >
                    <CameraTile camera={camera} />
                  </button>
                );
              })
            )}
          </div>

          <div className={`dashTimeline${isLive ? " is-live" : ""}`}>
            <div className="dashTimelineMeta">
              <span className="dashTimelineMode">{isLive ? "Live" : "Архив"}</span>
              <span className="dashTimelineZoom">
                {timelineZoom < 1 ? `${timelineZoom.toFixed(2)}×` : `${Math.round(timelineZoom)}×`}
              </span>
              <span className="dashTimelineClock">{formatTimelineStamp(playhead)}</span>
            </div>

            <div className="dashTimelineRangeBar">
              <div className="dashTimelineRangeEditor" aria-label="Границы фрагмента">
                <button
                  type="button"
                  className="dashTimelineNudge"
                  aria-label="Сдвинуть начало влево"
                  onClick={() => nudgeRangeEdge("start", -1)}
                >
                  ‹
                </button>
                <label className="dashTimelineTimeField">
                  <span>Начало</span>
                  <input
                    value={rangeStartDraft}
                    onChange={(event) => setRangeStartDraft(event.target.value)}
                    onBlur={() => commitRangeDraft("start")}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.currentTarget.blur();
                      }
                    }}
                  />
                </label>
                <button
                  type="button"
                  className="dashTimelineNudge"
                  aria-label="Сдвинуть начало вправо"
                  onClick={() => nudgeRangeEdge("start", 1)}
                >
                  ›
                </button>

                <span className="dashTimelineRangeSep">—</span>

                <button
                  type="button"
                  className="dashTimelineNudge"
                  aria-label="Сдвинуть конец влево"
                  onClick={() => nudgeRangeEdge("end", -1)}
                >
                  ‹
                </button>
                <label className="dashTimelineTimeField">
                  <span>Конец</span>
                  <input
                    value={rangeEndDraft}
                    onChange={(event) => setRangeEndDraft(event.target.value)}
                    onBlur={() => commitRangeDraft("end")}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.currentTarget.blur();
                      }
                    }}
                  />
                </label>
                <button
                  type="button"
                  className="dashTimelineNudge"
                  aria-label="Сдвинуть конец вправо"
                  onClick={() => nudgeRangeEdge("end", 1)}
                >
                  ›
                </button>
              </div>

              <button type="button" className="dashTimelineFit" onClick={fitFragmentInView}>
                Показать фрагмент
              </button>
            </div>

            <div
              ref={timelineStripRef}
              className={`dashTimelineStrip${stripPanning ? " is-panning" : ""}`}
              aria-label="Временная шкала"
              onPointerDown={onStripPointerDown}
              onPointerMove={onStripPointerMove}
              onPointerUp={onStripPointerUp}
              onPointerCancel={onStripPointerUp}
            >
              <div className="dashTimelineStripLegend" aria-hidden>
                <span className="dashTimelineStripLegendDate">дата</span>
                <span className="dashTimelineStripLegendTime">время</span>
              </div>
              <div className="dashTimelineStripTrack">
                {timelineStripMarksList.map((mark) => {
                  const left = ((mark.progress - timelineViewStart) / timelineViewSpan) * 100;
                  if (left < -4 || left > 104) return null;
                  return (
                    <div
                      key={mark.key}
                      className={`dashTimelineStripMark is-${mark.kind}`}
                      style={{ left: `${left}%` }}
                    >
                      <span className="dashTimelineStripLabel">{mark.label}</span>
                      <span className="dashTimelineStripTick" />
                    </div>
                  );
                })}
              </div>
            </div>

            <div
              ref={timelineRef}
              className="dashTimelineTrack"
              style={{
                ["--timeline-ticks" as string]: `${Math.max(4, Math.min(10, Math.round(4 + timelineZoom)))}`,
              }}
              role="slider"
              aria-label="Таймлайн архива"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(playhead * 100)}
              tabIndex={0}
              onPointerDown={onTimelinePointerDown}
              onPointerMove={onTimelinePointerMove}
              onPointerUp={onTimelinePointerUp}
              onPointerCancel={onTimelinePointerUp}
              onKeyDown={(event) => {
                if (event.key === "ArrowLeft") stepTimeline(-1);
                if (event.key === "ArrowRight") stepTimeline(1);
              }}
            >
              <div className="dashTimelineRuler" aria-hidden />
              {rangeVisible ? (
                <div
                  className="dashTimelineRange"
                  style={{ left: `${rangeVisible.left}%`, right: `${rangeVisible.right}%` }}
                  data-timeline-handle="range-move"
                >
                  <div className="dashTimelineRangeBody" data-timeline-handle="range-move" />
                  {rangeStartInView >= -0.05 && rangeStartInView <= 1.05 ? (
                    <button
                      type="button"
                      className="dashTimelineHandle dashTimelineHandle--start"
                      data-timeline-handle="range-start"
                      aria-label="Начало фрагмента"
                    >
                      <span className="dashTimelineHandleLabel">{formatTimelineStamp(rangeStart, false)}</span>
                    </button>
                  ) : null}
                  {rangeEndInView >= -0.05 && rangeEndInView <= 1.05 ? (
                    <button
                      type="button"
                      className="dashTimelineHandle dashTimelineHandle--end"
                      data-timeline-handle="range-end"
                      aria-label="Конец фрагмента"
                    >
                      <span className="dashTimelineHandleLabel">{formatTimelineStamp(rangeEnd, false)}</span>
                    </button>
                  ) : null}
                </div>
              ) : null}
              {fragmentFill ? (
                <div
                  className="dashTimelineFill"
                  style={{ left: `${fragmentFill.left}%`, width: `${fragmentFill.width}%` }}
                />
              ) : null}
              {thumbInView >= -0.02 && thumbInView <= 1.02 ? (
                <button
                  type="button"
                  className={`dashTimelineThumb${isLive ? " is-live" : ""}${scrubbing ? " is-scrubbing" : ""}`}
                  style={{ left: `${clamp(thumbInView, 0, 1) * 100}%` }}
                  data-timeline-handle={isLive ? undefined : "scrub"}
                  aria-label={isLive ? "Текущий момент Live" : "Ползунок воспроизведения"}
                >
                  <span className="dashTimelineHandleLabel dashTimelineThumbLabel">
                    {formatTimelineStamp(playhead, false)}
                  </span>
                </button>
              ) : null}
              <div className="dashTimelineMarks" aria-hidden>
                {timelineMarksList.map((mark) => (
                  <span key={mark.key}>{mark.label}</span>
                ))}
              </div>
            </div>
            <div className="dashTimelineHint">
              Тяните шкалу дат, чтобы двигать таймлайн · края фрагмента · протяните вне выделения для нового · Alt — привязка
            </div>

            <div className="dashTimelineControls">
              <div className="dashTimelineSpeeds" role="group" aria-label="Скорость">
                {PLAYBACK_SPEEDS.map((value) => (
                  <button
                    key={value}
                    type="button"
                    className={speed === value ? "is-active" : undefined}
                    onClick={() => {
                      setSpeed(value);
                      if (!isPlaying) togglePlayFragment();
                      else setIsPlaying(true);
                    }}
                  >
                    {value}×
                  </button>
                ))}
              </div>

              <div className="dashTimelineTransport">
                <button type="button" className="dashTimelineBtn" aria-label="Назад" onClick={() => stepTimeline(-1)}>
                  <svg viewBox="0 0 24 24" aria-hidden>
                    <path d="M14.8 5.5 8.2 12l6.6 6.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="square" />
                    <path d="M7.4 5.8v12.4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="square" />
                  </svg>
                </button>
                <button
                  type="button"
                  className={`dashTimelineBtn dashTimelinePlay${isPlaying ? " is-active" : ""}`}
                  aria-label={isPlaying ? "Пауза" : "Воспроизведение"}
                  onClick={togglePlayFragment}
                >
                  {isPlaying ? (
                    <svg viewBox="0 0 24 24" aria-hidden>
                      <path d="M8 5.5h2.6v13H8zM13.4 5.5H16v13h-2.6z" fill="currentColor" />
                    </svg>
                  ) : (
                    <svg viewBox="0 0 24 24" aria-hidden>
                      <path d="M8.5 5.2v13.6L19 12 8.5 5.2z" fill="currentColor" />
                    </svg>
                  )}
                </button>
                <button type="button" className="dashTimelineBtn" aria-label="Вперёд" onClick={() => stepTimeline(1)}>
                  <svg viewBox="0 0 24 24" aria-hidden>
                    <path d="M9.2 5.5 15.8 12 9.2 18.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="square" />
                    <path d="M16.6 5.8v12.4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="square" />
                  </svg>
                </button>
              </div>

              <div className="dashTimelineActions">
                <button type="button" className="dashTimelineDownload" onClick={downloadFragment}>
                  <svg viewBox="0 0 24 24" aria-hidden>
                    <path
                      d="M12 4v10m0 0 4-4m-4 4-4-4M5 18h14"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.7"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                  Скачать фрагмент
                </button>
                <button
                  type="button"
                  className={`dashTimelineLive${isLive ? " is-active" : ""}`}
                  onClick={goLive}
                >
                  <i className="dashTimelineLiveDot" aria-hidden />
                  Live
                </button>
              </div>
            </div>
          </div>
        </section>
      </section>
    </main>
  );
}
