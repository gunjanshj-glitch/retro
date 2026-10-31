"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { trackPageview } from "@/lib/analytics";

/** Sends a page_view on client-side navigations (the first load is sent by gtag config). */
export function RouteTracker() {
  const pathname = usePathname();
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    trackPageview(pathname);
  }, [pathname]);
  return null;
}
