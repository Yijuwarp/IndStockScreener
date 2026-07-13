import type { Bundle } from "./types";

const API_BASE = import.meta.env.VITE_API_URL ?? "http://localhost:8000";

// Last session's decompressed bundle size, used to scale the progress bar.
// Self-correcting: each successful load stores the actual size for next time.
const BUNDLE_SIZE_KEY = "iss_bundle_bytes";
const BUNDLE_SIZE_DEFAULT = 3_600_000;

// In-flight dedupe: React StrictMode double-mounts effects in dev, and the whole
// point of the bundle is one request per session -- share the promise, and route
// progress to whichever caller subscribed last (the live mount).
let inFlight: Promise<Bundle> | null = null;
let progressListener: (pct: number) => void = () => {};

/** Fetch the whole universe (both bases), indexes, and refresh status in one
 * request -- the only backend call a session makes. onProgress receives 0-100;
 * the first call marks the transition from "waiting on backend" to "fetching". */
export function fetchBundle(onProgress: (pct: number) => void): Promise<Bundle> {
  progressListener = onProgress;
  if (!inFlight) {
    inFlight = fetchBundleOnce((pct) => progressListener(pct)).catch((err) => {
      inFlight = null; // let the boot retry loop try again
      throw err;
    });
  }
  return inFlight;
}

// In production the data-refresh workflow publishes bundle.json into the Vercel
// deploy, so the CDN copy (same-origin, no cold start) is tried first; the
// backend endpoint is the fallback. Dev always uses the local backend so the
// app reflects the local DB. A SPA rewrite can answer a missing static file
// with index.html, so a non-JSON content type also falls through.
async function openBundleResponse(): Promise<Response> {
  if (import.meta.env.PROD) {
    try {
      const res = await fetch("/bundle.json");
      if (res.ok && (res.headers.get("content-type") ?? "").includes("json")) return res;
    } catch {
      // fall through to the API
    }
  }
  const res = await fetch(`${API_BASE}/stocks/bundle`);
  if (!res.ok) throw new Error(`Bundle request failed: ${res.status}`);
  return res;
}

async function fetchBundleOnce(onProgress: (pct: number) => void): Promise<Bundle> {
  const res = await openBundleResponse();
  onProgress(0);

  if (!res.body) return res.json();

  const expected = Number(localStorage.getItem(BUNDLE_SIZE_KEY)) || BUNDLE_SIZE_DEFAULT;
  const reader = res.body.getReader();
  const chunks: BlobPart[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    onProgress(Math.min(99, Math.round((received / expected) * 100)));
  }
  try {
    localStorage.setItem(BUNDLE_SIZE_KEY, String(received));
  } catch {
    // private mode etc. -- the default estimate is fine
  }
  onProgress(100);
  return JSON.parse(await new Blob(chunks).text());
}
