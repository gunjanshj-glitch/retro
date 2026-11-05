"use client";

/**
 * Zoom and pan for an SVG map whose viewBox we drive ourselves.
 *
 * Shared by every map so they all behave the same, and built so the map never
 * gets in the way of reading the page:
 *
 * - A plain mouse wheel (or one-finger swipe) always scrolls the PAGE. The map
 *   shows a short "Ctrl + scroll to zoom" hint instead of trapping the wheel.
 * - Ctrl/⌘ + wheel zooms about the cursor. Trackpad pinch arrives as
 *   ctrl + wheel in every major browser, so it works too.
 * - Two fingers pinch-zoom and pan on touch screens.
 * - Dragging with a mouse pans once zoomed in; double-click zooms in.
 * - Buttons zoom about the centre; `fitTo` frames a box (dive into a country).
 *
 * Wheel and touch listeners are attached natively and non-passively: React
 * registers `onWheel`/`onTouchMove` as passive, so `preventDefault` there
 * silently fails.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

export type ViewBox = [number, number, number, number];
export type Box = { x0: number; y0: number; x1: number; y1: number };

export const ZOOM_MIN = 1;
export const ZOOM_MAX = 8;
const BUTTON_FACTOR = 1.6;
const WHEEL_FACTOR = 1.0022;
const DBLCLICK_FACTOR = 1.8;
const ANIM_MS = 480;
const HINT_MS = 1200;

export type ZoomHint = "wheel" | "touch" | null;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

type Nav = { key: string; zoom: number; cx: number; cy: number };

const prefersReducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

export function useZoomPan(base: ViewBox, resetKey: string) {
  const [bx, by, bw, bh] = base;
  // A callback ref held in state, so the hook notices when the SVG mounts later
  // than the component (a map that only renders once its data has loaded).
  const [svgEl, setSvgEl] = useState<SVGSVGElement | null>(null);
  const svgRef = useCallback((node: SVGSVGElement | null) => setSvgEl(node), []);
  const [nav, setNav] = useState<Nav>({ key: resetKey, zoom: 1, cx: bx + bw / 2, cy: by + bh / 2 });
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [hint, setHint] = useState<ZoomHint>(null);

  // A different map starts from its own full extent.
  const current: Nav =
    nav.key === resetKey ? nav : { key: resetKey, zoom: 1, cx: bx + bw / 2, cy: by + bh / 2 };

  const view = useMemo(() => {
    const w = bw / current.zoom;
    const h = bh / current.zoom;
    return {
      x: clamp(current.cx - w / 2, bx, bx + bw - w),
      y: clamp(current.cy - h / 2, by, by + bh - h),
      w,
      h,
    };
  }, [bx, by, bw, bh, current.zoom, current.cx, current.cy]);

  // Handlers read the latest view through refs, kept current after each render.
  const viewRef = useRef(view);
  const navRef = useRef(current);
  useEffect(() => {
    viewRef.current = view;
    navRef.current = current;
  });

  useEffect(() => {
    const el = svgEl;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      setSize({ width: r.width, height: r.height });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [svgEl]);

  const pxPerUnit = size.width && size.height ? Math.min(size.width / view.w, size.height / view.h) : 1;

  const anim = useRef(0);
  const stopAnim = () => {
    if (anim.current) cancelAnimationFrame(anim.current);
    anim.current = 0;
  };

  const setView = useCallback(
    (zoom: number, cx: number, cy: number) => {
      const z = clamp(zoom, ZOOM_MIN, ZOOM_MAX);
      const w = bw / z;
      const h = bh / z;
      const next = {
        key: resetKey,
        zoom: z,
        cx: clamp(cx, bx + w / 2, bx + bw - w / 2),
        cy: clamp(cy, by + h / 2, by + bh - h / 2),
      };
      // Keep the refs current immediately, so events that land before the next
      // render (a fast wheel spin) build on each other rather than on stale state.
      navRef.current = next;
      viewRef.current = { x: next.cx - w / 2, y: next.cy - h / 2, w, h };
      setNav(next);
    },
    [bx, by, bw, bh, resetKey],
  );

  /** Eases from the current view to a target; instant under reduced motion. */
  const animateTo = useCallback(
    (zoom: number, cx: number, cy: number) => {
      stopAnim();
      const from = navRef.current;
      if (prefersReducedMotion() || typeof requestAnimationFrame === "undefined") {
        setView(zoom, cx, cy);
        return;
      }
      const target = { zoom: clamp(zoom, ZOOM_MIN, ZOOM_MAX), cx, cy };
      const t0 = performance.now();
      // Interpolate the scale logarithmically so zooming feels even.
      const lz0 = Math.log(from.zoom), lz1 = Math.log(target.zoom);
      const tick = (t: number) => {
        const k = Math.min(1, (t - t0) / ANIM_MS);
        const e = 1 - Math.pow(1 - k, 3);
        setView(Math.exp(lz0 + (lz1 - lz0) * e), from.cx + (target.cx - from.cx) * e, from.cy + (target.cy - from.cy) * e);
        anim.current = k < 1 ? requestAnimationFrame(tick) : 0;
      };
      anim.current = requestAnimationFrame(tick);
    },
    [setView],
  );
  useEffect(() => stopAnim, []);

  /** Zooms by a factor, keeping the map point under (ax, ay) fixed on screen. */
  const zoomAbout = useCallback(
    (factor: number, ax: number, ay: number, animated = false) => {
      const v = viewRef.current;
      const z = clamp(navRef.current.zoom * factor, ZOOM_MIN, ZOOM_MAX);
      const w = bw / z;
      const h = bh / z;
      const fx = (ax - v.x) / v.w;
      const fy = (ay - v.y) / v.h;
      const cx = ax - fx * w + w / 2;
      const cy = ay - fy * h + h / 2;
      if (animated) animateTo(z, cx, cy);
      else setView(z, cx, cy);
    },
    [bw, bh, setView, animateTo],
  );

  const zoomIn = useCallback(() => {
    const v = viewRef.current;
    zoomAbout(BUTTON_FACTOR, v.x + v.w / 2, v.y + v.h / 2, true);
  }, [zoomAbout]);
  const zoomOut = useCallback(() => {
    const v = viewRef.current;
    zoomAbout(1 / BUTTON_FACTOR, v.x + v.w / 2, v.y + v.h / 2, true);
  }, [zoomAbout]);

  const reset = useCallback(() => animateTo(1, bx + bw / 2, by + bh / 2), [animateTo, bx, by, bw, bh]);

  /** Frames a box, with breathing room, as tightly as the zoom limit allows. */
  const fitTo = useCallback(
    (box: Box, padding = 40) => {
      const w = Math.max(1, box.x1 - box.x0 + padding * 2);
      const h = Math.max(1, box.y1 - box.y0 + padding * 2);
      animateTo(Math.min(bw / w, bh / h), (box.x0 + box.x1) / 2, (box.y0 + box.y1) / 2);
    },
    [bw, bh, animateTo],
  );

  /** Client pixel -> map units, accounting for preserveAspectRatio centring. */
  const toMap = useCallback(
    (clientX: number, clientY: number): [number, number] | null => {
      const el = svgEl;
      if (!el) return null;
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) return null;
      const v = viewRef.current;
      const scale = Math.min(r.width / v.w, r.height / v.h);
      const offX = (r.width - v.w * scale) / 2;
      const offY = (r.height - v.h * scale) / 2;
      return [v.x + (clientX - r.left - offX) / scale, v.y + (clientY - r.top - offY) / scale];
    },
    [svgEl],
  );

  const hintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flashHint = useCallback((kind: Exclude<ZoomHint, null>) => {
    setHint(kind);
    if (hintTimer.current) clearTimeout(hintTimer.current);
    hintTimer.current = setTimeout(() => setHint(null), HINT_MS);
  }, []);
  useEffect(() => () => {
    if (hintTimer.current) clearTimeout(hintTimer.current);
  }, []);

  // Wheel: the page keeps scrolling unless Ctrl/⌘ is held (or a trackpad pinch).
  useEffect(() => {
    const el = svgEl;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) {
        if (Math.abs(e.deltaY) > 2) flashHint("wheel");
        return;
      }
      e.preventDefault();
      stopAnim();
      setHint(null);
      const p = toMap(e.clientX, e.clientY);
      if (!p) return;
      const dy = e.deltaMode === 1 ? e.deltaY * 30 : e.deltaY;
      zoomAbout(Math.pow(WHEEL_FACTOR, -dy), p[0], p[1]);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomAbout, svgEl, toMap, flashHint]);

  // Touch: one finger scrolls the page (touch-action: pan-y on the SVG); two
  // fingers pinch and pan the map.
  const pinch = useRef<{ d: number; zoom: number; anchor: [number, number] } | null>(null);
  useEffect(() => {
    const el = svgEl;
    if (!el) return;
    const mid = (t: TouchList) => [(t[0].clientX + t[1].clientX) / 2, (t[0].clientY + t[1].clientY) / 2] as const;
    const dist = (t: TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 2) return;
      e.preventDefault();
      stopAnim();
      const [mx, my] = mid(e.touches);
      const anchor = toMap(mx, my);
      if (anchor) pinch.current = { d: dist(e.touches), zoom: navRef.current.zoom, anchor };
    };
    const onMove = (e: TouchEvent) => {
      const p = pinch.current;
      if (!p || e.touches.length !== 2) return;
      e.preventDefault();
      const el2 = el.getBoundingClientRect();
      const z = clamp((p.zoom * dist(e.touches)) / p.d, ZOOM_MIN, ZOOM_MAX);
      const w = bw / z, h = bh / z;
      const scale = Math.min(el2.width / w, el2.height / h);
      const [mx, my] = mid(e.touches);
      const offX = (el2.width - w * scale) / 2, offY = (el2.height - h * scale) / 2;
      // Keep the map point that started under the fingers under them.
      const x0 = p.anchor[0] - (mx - el2.left - offX) / scale;
      const y0 = p.anchor[1] - (my - el2.top - offY) / scale;
      setView(z, x0 + w / 2, y0 + h / 2);
    };
    const onEnd = (e: TouchEvent) => {
      if (e.touches.length < 2) pinch.current = null;
    };
    el.addEventListener("touchstart", onStart, { passive: false });
    el.addEventListener("touchmove", onMove, { passive: false });
    el.addEventListener("touchend", onEnd);
    el.addEventListener("touchcancel", onEnd);
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
      el.removeEventListener("touchcancel", onEnd);
    };
  }, [svgEl, toMap, setView, bw, bh]);

  // --- mouse drag to pan, double-click to zoom ------------------------------
  const drag = useRef<{ id: number; sx: number; sy: number; cx: number; cy: number } | null>(null);
  /** True once a drag has travelled far enough to be a pan, not a click. */
  const panned = useRef(false);

  const onPointerDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    panned.current = false;
    if (e.pointerType === "touch") return;
    if (navRef.current.zoom <= ZOOM_MIN + 0.001) return;
    stopAnim();
    const v = viewRef.current;
    drag.current = { id: e.pointerId, sx: e.clientX, sy: e.clientY, cx: v.x + v.w / 2, cy: v.y + v.h / 2 };
  };
  const onPointerMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const dx = e.clientX - d.sx;
    const dy = e.clientY - d.sy;
    if (Math.hypot(dx, dy) > 4) {
      panned.current = true;
      // Capture only once it is a drag; capturing on pointerdown would
      // retarget a plain click on a pin to the SVG root.
      if (!e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.setPointerCapture(e.pointerId);
    }
    if (!panned.current) return;
    setView(navRef.current.zoom, d.cx - dx / pxPerUnit, d.cy - dy / pxPerUnit);
  };
  const endDrag = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (drag.current?.id !== e.pointerId) return;
    drag.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  };
  const onDoubleClick = (e: React.MouseEvent<SVGSVGElement>) => {
    const p = toMap(e.clientX, e.clientY);
    if (p) zoomAbout(DBLCLICK_FACTOR, p[0], p[1], true);
  };

  return {
    svgRef,
    view,
    zoom: current.zoom,
    size,
    pxPerUnit,
    zoomIn,
    zoomOut,
    reset,
    fitTo,
    panned,
    hint,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: endDrag,
      onPointerCancel: endDrag,
      onDoubleClick,
    },
  };
}
