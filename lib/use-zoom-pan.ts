"use client";

/**
 * Zoom and pan for an SVG map whose viewBox we drive ourselves.
 *
 * Shared by every region map so they all behave the same: mouse wheel zooms
 * about the cursor, +/- buttons zoom about the centre, dragging pans, and the
 * view can be fitted to a box (used to dive into a country). The wheel handler
 * is attached natively and non-passively — React registers `onWheel` as
 * passive, so calling `preventDefault` there silently fails and the page
 * scrolls while the map zooms.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

export type ViewBox = [number, number, number, number];
export type Box = { x0: number; y0: number; x1: number; y1: number };

export const ZOOM_MIN = 1;
/** Deepest zoom. Past it the wheel stops zooming and scrolls the page instead. */
export const ZOOM_MAX = 5.8;
const BUTTON_FACTOR = 1.5;
const WHEEL_FACTOR = 1.0018;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

type Nav = { key: string; zoom: number; cx: number; cy: number };

export function useZoomPan(base: ViewBox, resetKey: string) {
  const [bx, by, bw, bh] = base;
  // A callback ref held in state, so the hook notices when the SVG mounts later
  // than the component (a map that only renders once its data has loaded).
  const [svgEl, setSvgEl] = useState<SVGSVGElement | null>(null);
  const svgRef = useCallback((node: SVGSVGElement | null) => setSvgEl(node), []);
  const [nav, setNav] = useState<Nav>({ key: resetKey, zoom: 1, cx: bx + bw / 2, cy: by + bh / 2 });
  const [size, setSize] = useState({ width: 0, height: 0 });

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

  /** Zooms by a factor, keeping the map point under (ax, ay) fixed on screen. */
  const zoomAbout = useCallback(
    (factor: number, ax: number, ay: number) => {
      const v = viewRef.current;
      const z = clamp(navRef.current.zoom * factor, ZOOM_MIN, ZOOM_MAX);
      const w = bw / z;
      const h = bh / z;
      const fx = (ax - v.x) / v.w;
      const fy = (ay - v.y) / v.h;
      setView(z, ax - fx * w + w / 2, ay - fy * h + h / 2);
    },
    [bw, bh, setView],
  );

  const zoomIn = useCallback(() => {
    const v = viewRef.current;
    zoomAbout(BUTTON_FACTOR, v.x + v.w / 2, v.y + v.h / 2);
  }, [zoomAbout]);
  const zoomOut = useCallback(() => {
    const v = viewRef.current;
    zoomAbout(1 / BUTTON_FACTOR, v.x + v.w / 2, v.y + v.h / 2);
  }, [zoomAbout]);

  const reset = useCallback(() => setView(1, bx + bw / 2, by + bh / 2), [setView, bx, by, bw, bh]);

  /** Frames a box, with breathing room, as tightly as the zoom limit allows. */
  const fitTo = useCallback(
    (box: Box, padding = 40) => {
      const w = Math.max(1, box.x1 - box.x0 + padding * 2);
      const h = Math.max(1, box.y1 - box.y0 + padding * 2);
      setView(Math.min(bw / w, bh / h), (box.x0 + box.x1) / 2, (box.y0 + box.y1) / 2);
    },
    [bw, bh, setView],
  );

  // Native, non-passive wheel listener.
  useEffect(() => {
    const el = svgEl;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      // Already fully zoomed in and still zooming in: let the page scroll
      // rather than trapping the wheel over the map.
      if (e.deltaY < 0 && navRef.current.zoom >= ZOOM_MAX - 0.001) return;
      e.preventDefault();
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) return;
      const v = viewRef.current;
      const scale = Math.min(r.width / v.w, r.height / v.h);
      // preserveAspectRatio centres the map, so measure from its own origin.
      const offX = (r.width - v.w * scale) / 2;
      const offY = (r.height - v.h * scale) / 2;
      const ax = v.x + (e.clientX - r.left - offX) / scale;
      const ay = v.y + (e.clientY - r.top - offY) / scale;
      zoomAbout(Math.pow(WHEEL_FACTOR, -e.deltaY), ax, ay);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomAbout, svgEl]);

  // --- drag to pan ---------------------------------------------------------
  const drag = useRef<{ id: number; sx: number; sy: number; cx: number; cy: number } | null>(null);
  /** True once a drag has travelled far enough to be a pan, not a click. */
  const panned = useRef(false);

  const onPointerDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (navRef.current.zoom <= ZOOM_MIN) return;
    const v = viewRef.current;
    drag.current = { id: e.pointerId, sx: e.clientX, sy: e.clientY, cx: v.x + v.w / 2, cy: v.y + v.h / 2 };
    panned.current = false;
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
    const v = viewRef.current;
    setView(navRef.current.zoom, d.cx - dx / pxPerUnit, d.cy - dy / pxPerUnit);
    void v;
  };
  const endDrag = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (drag.current?.id !== e.pointerId) return;
    drag.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
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
    handlers: { onPointerDown, onPointerMove, onPointerUp: endDrag, onPointerCancel: endDrag },
  };
}
