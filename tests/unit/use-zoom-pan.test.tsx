import { describe, it, expect } from "vitest";
import { render, act } from "@testing-library/react";
import { useZoomPan, ZOOM_MAX } from "@/lib/use-zoom-pan";

function Harness() {
  const { svgRef, zoom } = useZoomPan([0, 0, 1000, 500], "test");
  return <svg ref={svgRef} data-testid="map" data-zoom={zoom} />;
}

function setup() {
  const { getByTestId } = render(<Harness />);
  const svg = getByTestId("map");
  svg.getBoundingClientRect = () =>
    ({ left: 0, top: 0, width: 1000, height: 500, right: 1000, bottom: 500, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
  return svg;
}

const zoomOf = (svg: Element) => Number(svg.getAttribute("data-zoom"));

const wheel = (svg: Element, deltaY: number, mods: { ctrlKey?: boolean; metaKey?: boolean } = { ctrlKey: true }) => {
  const e = new WheelEvent("wheel", { deltaY, clientX: 500, clientY: 250, cancelable: true, bubbles: true, ...mods });
  act(() => {
    svg.dispatchEvent(e);
  });
  return e;
};

describe("useZoomPan wheel handling", () => {
  it("leaves a plain wheel to the page so scrolling past the map always works", () => {
    const svg = setup();
    const e = wheel(svg, -100, {});
    expect(e.defaultPrevented).toBe(false);
    expect(zoomOf(svg)).toBe(1);
  });

  it("zooms with Ctrl + wheel (and trackpad pinch, which arrives as ctrl + wheel)", () => {
    const svg = setup();
    const e = wheel(svg, -100);
    expect(e.defaultPrevented).toBe(true);
    expect(zoomOf(svg)).toBeGreaterThan(1);
  });

  it("zooms with ⌘ + wheel on a Mac", () => {
    const svg = setup();
    expect(wheel(svg, -100, { metaKey: true }).defaultPrevented).toBe(true);
    expect(zoomOf(svg)).toBeGreaterThan(1);
  });

  it("stops at the cap and zooms back out", () => {
    const svg = setup();
    for (let i = 0; i < 40; i++) wheel(svg, -300);
    expect(zoomOf(svg)).toBeCloseTo(ZOOM_MAX, 5);
    wheel(svg, 100);
    expect(zoomOf(svg)).toBeLessThan(ZOOM_MAX);
  });
});
