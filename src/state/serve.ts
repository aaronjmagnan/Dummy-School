import { buildDistrict } from "../district/changes.ts";
import type { District } from "../district/model.ts";
import { aeries } from "../vendors/aeries.ts";
import { clever, cleverRateLimited } from "../vendors/clever.ts";
import { json, type Ctx, type MockRequest, type MockResponse, type Vendor } from "../vendors/http.ts";
import { powerschool } from "../vendors/powerschool.ts";
import { getStore, type State } from "./store.ts";

/*
 * The glue between a web request and a mock: load the state, build the
 * district, apply any failure switch, answer, and log what was asked.
 */

const HANDLERS = { aeries, clever, powerschool } as const;

/** Today's date where the fake district is (Pacific time), as YYYY-MM-DD. */
export const realToday = (now = Date.now()) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(now);

export const todayFor = (state: State) => state.today ?? realToday();

// Building the district is quick, but a sync makes hundreds of requests: keep the last one.
let cache: { key: string; district: District } | null = null;
export function districtFor(state: State): District {
  const today = todayFor(state);
  const key = `${today}|${JSON.stringify(state.changes)}`;
  if (cache?.key !== key) cache = { key, district: buildDistrict(today, state.changes) };
  return cache.district;
}

/** Answers one mock request. Used by the route handlers and by tests. */
export async function answer(vendor: Vendor, req: MockRequest, base: string): Promise<MockResponse> {
  const store = getStore();
  const state = await store.read();
  const sw = state.switches[vendor];
  const now = Date.now();

  // Forced failures, counted down one request at a time.
  if (sw.failNext > 0 || sw.rateLimitNext > 0) {
    const forced = sw.failNext > 0 ? "fail" : "rate";
    if (forced === "fail") sw.failNext--;
    else sw.rateLimitNext--;
    await store.write(state);
    if (forced === "fail") return json(500, { message: "Internal server error (forced from the Dummy School control panel)" });
    return vendor === "clever" ? cleverRateLimited(now) : json(429, { message: "Too many requests (forced from the Dummy School control panel)" }, { "Retry-After": "1" });
  }

  const ctx = { district: districtFor(state), switches: sw, base, now } as Ctx;
  return (HANDLERS[vendor] as (r: MockRequest, c: Ctx) => MockResponse)(req, ctx);
}

/** A Next.js route handler for one vendor. */
export function routeFor(vendor: Vendor) {
  return async (request: Request, { params }: { params: Promise<{ path?: string[] }> }) => {
    const started = Date.now();
    const url = new URL(request.url);
    const { path = [] } = await params;
    const req: MockRequest = {
      method: request.method,
      path,
      query: url.searchParams,
      headers: request.headers,
      body: request.method === "GET" || request.method === "HEAD" ? "" : await request.text(),
    };
    let res: MockResponse;
    try {
      res = await answer(vendor, req, `${url.origin}/${vendor}`);
    } catch (e) {
      res = json(500, { message: `Dummy School error: ${e instanceof Error ? e.message : "unknown"}` });
    }
    // Never log credentials: the path and query only (the API puts none there).
    await getStore()
      .log({ at: new Date().toISOString(), vendor, method: request.method, path: `${url.pathname}${url.search}`.slice(0, 300), status: res.status, ms: Date.now() - started })
      .catch(() => {});
    const headers = new Headers(res.headers);
    headers.set("Cache-Control", "no-store");
    if (res.text !== undefined) return new Response(res.text, { status: res.status, headers });
    if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json; charset=utf-8");
    return new Response(res.body === undefined ? "" : JSON.stringify(res.body), { status: res.status, headers });
  };
}
