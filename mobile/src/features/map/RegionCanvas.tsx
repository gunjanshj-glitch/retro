'use no memo';
/**
 * One region's map, drawn on a single GPU canvas (Skia). Pan and pinch run on the UI thread and move the
 * whole map as one transform, so no pin re-renders while a finger is down. Pins keep a constant on-screen
 * size because their radius is divided by the zoom. Names and the "which pins fit" choice are recomputed
 * once the finger lifts, on the JS side, from the committed view.
 */
import { Canvas, Circle, Group, Path, Skia } from "@shopify/react-native-skia";
import { useCallback, useEffect, useMemo, useState } from "react";
import { StyleSheet, View, type LayoutChangeEvent } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { useDerivedValue, useSharedValue, withTiming } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { pinMetrics, placePinLabels, selectVisiblePins, type DeclutterPin } from "@retro/core/map-declutter";
import { Text } from "@/ui";
import { useTheme } from "@/theme";
import { coastlinePath, pinsNear, type MapPin, type RegionMarkers } from "./regions";

export const ZOOM_MAX = 12;
const HIT_RADIUS = 22;

type Props = {
  svg: string;
  markers: RegionMarkers;
  pins: MapPin[];
  /** Place ids in the trip. */
  selected: Set<string>;
  /** Place ids that cannot be added right now. */
  blocked: Set<string>;
  /** Fired with every pin under the finger (1 = act on it, several = let the traveller choose). */
  onTap: (pins: MapPin[]) => void;
  /** Country the map should zoom to when this changes. */
  focus: { country: string; nonce: number } | null;
};

type ViewState = { tx: number; ty: number; sc: number };

export function RegionCanvas({ svg, markers, pins, selected, blocked, onTap, focus }: Props) {
  const c = useTheme();
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [vx, vy, vw, vh] = markers.viewBox;
  const k = size.w ? Math.min(size.w / vw, size.h / vh) : 1;

  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const sc = useSharedValue(1);
  const kv = useSharedValue(1);
  const [view, setView] = useState<ViewState>({ tx: 0, ty: 0, sc: 1 });

  const fit = useCallback((w: number, h: number) => {
    const kk = Math.min(w / vw, h / vh);
    kv.value = kk;
    tx.value = (w - vw * kk) / 2;
    ty.value = (h - vh * kk) / 2;
    sc.value = 1;
    setView({ tx: (w - vw * kk) / 2, ty: (h - vh * kk) / 2, sc: 1 });
  }, [vw, vh, kv, tx, ty, sc]);

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setSize({ w: width, h: height });
    fit(width, height);
  };

  const commit = useCallback((a: number, b: number, s: number) => setView({ tx: a, ty: b, sc: s }), []);

  // Screen position of a map point under the committed view.
  const toScreen = useCallback((cx: number, cy: number) => ({ x: (cx - vx) * k * view.sc + view.tx, y: (cy - vy) * k * view.sc + view.ty }), [vx, vy, k, view]);

  const handleTap = useCallback((x: number, y: number) => {
    const placed = visiblePins.map((p) => ({ pin: p, ...toScreen(p.cx, p.cy) }));
    onTap(pinsNear(placed, x, y, HIT_RADIUS).map((p) => p.pin));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toScreen, onTap]);

  // Which pins fit at this zoom, and where their names go.
  const metrics = pinMetrics(size.w || 400);
  const declutter = useMemo(() => {
    if (!size.w) return null;
    const input: DeclutterPin[] = pins.map((p) => ({ id: p.key, x: p.cx, y: p.cy, country: p.marker.country, level: p.marker.level, rank: p.marker.rank, pinned: p.place ? selected.has(p.place.id) : false }));
    return selectVisiblePins({ pins: input, pxPerUnit: k * view.sc, widthPx: size.w, heightPx: size.h, zoom: view.sc });
  }, [pins, selected, k, view.sc, size.w, size.h]);
  const visiblePins = useMemo(() => (declutter ? pins.filter((p) => declutter.visible.has(p.key)) : []), [declutter, pins]);

  const labels = useMemo(() => {
    const items = [...visiblePins].sort((a, b) => a.marker.level - b.marker.level || a.marker.rank - b.marker.rank).map((p) => ({ id: p.key, ...(() => { const s = toScreen(p.cx, p.cy); return { px: s.x, py: s.y }; })(), text: p.marker.level === 0 ? (p.marker.label ?? p.marker.name) : p.marker.name }));
    const sides = placePinLabels(items, metrics.radiusPx);
    return items.filter((i) => sides.has(i.id)).map((i) => ({ ...i, side: sides.get(i.id)! }));
  }, [visiblePins, toScreen, metrics.radiusPx]);

  const path = useMemo(() => {
    const d = coastlinePath(svg);
    return d ? Skia.Path.MakeFromSVGString(d) : null;
  }, [svg]);

  // Zoom to a country when asked.
  useEffect(() => {
    if (!focus || !size.w) return;
    const own = pins.filter((p) => p.marker.country === focus.country && p.marker.level === 1);
    if (!own.length) return;
    const x0 = Math.min(...own.map((p) => p.cx)), x1 = Math.max(...own.map((p) => p.cx));
    const y0 = Math.min(...own.map((p) => p.cy)), y1 = Math.max(...own.map((p) => p.cy));
    const bw = Math.max(x1 - x0, 24), bh = Math.max(y1 - y0, 24);
    const target = Math.max(1, Math.min(ZOOM_MAX, Math.min((size.w * 0.7) / (bw * k), (size.h * 0.6) / (bh * k))));
    const ntx = size.w / 2 - ((x0 + x1) / 2 - vx) * k * target;
    const nty = size.h / 2 - ((y0 + y1) / 2 - vy) * k * target;
    tx.value = withTiming(ntx, { duration: 320 });
    ty.value = withTiming(nty, { duration: 320 });
    sc.value = withTiming(target, { duration: 320 });
    const t = setTimeout(() => commit(ntx, nty, target), 340);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus?.nonce]);

  const pan = Gesture.Pan()
    .minDistance(4)
    .onChange((e) => { tx.value += e.changeX; ty.value += e.changeY; })
    .onEnd(() => { scheduleOnRN(commit, tx.value, ty.value, sc.value); });
  const pinch = Gesture.Pinch()
    .onChange((e) => {
      const next = Math.max(1, Math.min(ZOOM_MAX, sc.value * e.scaleChange));
      const f = next / sc.value;
      tx.value = e.focalX - (e.focalX - tx.value) * f;
      ty.value = e.focalY - (e.focalY - ty.value) * f;
      sc.value = next;
    })
    .onEnd(() => { scheduleOnRN(commit, tx.value, ty.value, sc.value); });
  const doubleTap = Gesture.Tap().numberOfTaps(2).onEnd((e, ok) => {
    if (!ok) return;
    const next = Math.min(ZOOM_MAX, sc.value * 2);
    const f = next / sc.value;
    const ntx = e.x - (e.x - tx.value) * f;
    const nty = e.y - (e.y - ty.value) * f;
    tx.value = withTiming(ntx, { duration: 220 });
    ty.value = withTiming(nty, { duration: 220 });
    sc.value = withTiming(next, { duration: 220 });
    scheduleOnRN(commit, ntx, nty, next);
  });
  const tap = Gesture.Tap().maxDuration(260).onEnd((e, ok) => { if (ok) scheduleOnRN(handleTap, e.x, e.y); });
  const gesture = Gesture.Race(Gesture.Simultaneous(pan, pinch), Gesture.Exclusive(doubleTap, tap));

  // Map-unit transform of the whole drawing, and constant-size pin radii.
  const transform = useDerivedValue(() => [{ translateX: tx.value }, { translateY: ty.value }, { scale: kv.value * sc.value }, { translateX: -vx }, { translateY: -vy }]);
  const pxScale = useDerivedValue(() => kv.value * sc.value);
  const r = useDerivedValue(() => 9 / pxScale.value);
  const rSel = useDerivedValue(() => 12 / pxScale.value);
  const stroke = useDerivedValue(() => 1.2 / pxScale.value);
  const coast = useDerivedValue(() => 1 / pxScale.value);

  const plain = visiblePins.filter((p) => p.place && !selected.has(p.place.id) && !blocked.has(p.place.id));
  const off = visiblePins.filter((p) => p.place && !selected.has(p.place.id) && blocked.has(p.place.id));
  const on = visiblePins.filter((p) => p.place && selected.has(p.place.id));
  const groups = visiblePins.filter((p) => !p.place);

  return (
    <View style={StyleSheet.absoluteFill} onLayout={onLayout}>
      {size.w ? (
        <GestureDetector gesture={gesture}>
          <View style={StyleSheet.absoluteFill} accessible accessibilityLabel="Map. Pinch to zoom, drag to move, tap a pin to add it. A list of places is on the previous screen.">
            <Canvas style={StyleSheet.absoluteFill}>
              <Group transform={transform}>
                {path ? <Path path={path} color={c.surface} /> : null}
                {path ? <Path path={path} style="stroke" strokeWidth={coast} color={c.border} /> : null}
                {groups.map((p) => <Circle key={p.key} cx={p.cx} cy={p.cy} r={r} color={c.action} opacity={0.9} />)}
                {off.map((p) => <Circle key={p.key} cx={p.cx} cy={p.cy} r={r} color={c.textDim} opacity={0.35} />)}
                {plain.map((p) => <Circle key={p.key} cx={p.cx} cy={p.cy} r={r} color={c.accent} />)}
                {plain.map((p) => <Circle key={`s${p.key}`} cx={p.cx} cy={p.cy} r={r} style="stroke" strokeWidth={stroke} color={c.bg} />)}
                {on.map((p) => <Circle key={p.key} cx={p.cx} cy={p.cy} r={rSel} color={c.success} />)}
                {on.map((p) => <Circle key={`s${p.key}`} cx={p.cx} cy={p.cy} r={rSel} style="stroke" strokeWidth={stroke} color={c.text} />)}
              </Group>
            </Canvas>
            {labels.map((l) => (
              <View key={l.id} pointerEvents="none" style={{ position: "absolute", left: l.side === "right" ? l.px + metrics.radiusPx + 2 : undefined, right: l.side === "left" ? size.w - l.px + metrics.radiusPx + 2 : undefined, top: l.py - 9 }}>
                <Text variant="small" numberOfLines={1} style={{ fontSize: 12, color: c.text, textShadowColor: c.bg, textShadowRadius: 3 }}>{l.text}</Text>
              </View>
            ))}
          </View>
        </GestureDetector>
      ) : null}
    </View>
  );
}
