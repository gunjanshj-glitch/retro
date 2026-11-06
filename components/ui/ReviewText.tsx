"use client";

import { useState } from "react";

/** Review body clamped to a few lines, with a toggle when it's long. */
export function ReviewText({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const long = text.length > 220;

  return (
    <>
      <span className={!open && long ? "line-clamp-5" : "block"}>{text}</span>
      {long && (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="mt-2 inline-block min-h-8 text-sm font-semibold underline-offset-2 hover:underline"
          style={{ color: "var(--accent)" }}
        >
          {open ? "Show less" : "Read more"}
        </button>
      )}
    </>
  );
}
