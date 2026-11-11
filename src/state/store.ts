import type { Change } from "../district/changes.ts";
import type { AeriesSwitches, Vendor, VendorSwitches } from "../vendors/http.ts";

/*
 * What Dummy School remembers between requests: the changes made from the
 * control panel, the failure switches, and a log of recent requests.
 *
 * On Vercel this lives in Redis (Upstash, from the Vercel Marketplace),
 * reached over its REST API. Locally, and in tests, it lives in memory.
 */

export type State = {
  changes: Change[];
  switches: { aeries: AeriesSwitches; clever: VendorSwitches; powerschool: VendorSwitches };
  /** Pretend today is this date (YYYY-MM-DD). Blank: the real date. */
  today: string | null;
};

export type LogEntry = { at: string; vendor: Vendor; method: string; path: string; status: number; ms: number };

const vendorDefaults = (): VendorSwitches => ({ rejectSignIn: false, failNext: 0, rateLimitNext: 0, tokenEpoch: 1 });
export const defaultState = (): State => ({
  changes: [],
  switches: { aeries: { ...vendorDefaults(), deny: [], noSchoolWideAttendance: false }, clever: vendorDefaults(), powerschool: vendorDefaults() },
  today: null,
});

/** Fills in anything an older saved state is missing. */
function normalize(raw: unknown): State {
  const d = defaultState();
  const s = (raw && typeof raw === "object" ? raw : {}) as Partial<State>;
  return {
    changes: Array.isArray(s.changes) ? s.changes : [],
    switches: {
      aeries: { ...d.switches.aeries, ...s.switches?.aeries },
      clever: { ...d.switches.clever, ...s.switches?.clever },
      powerschool: { ...d.switches.powerschool, ...s.switches?.powerschool },
    },
    today: typeof s.today === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s.today) ? s.today : null,
  };
}

export interface Store {
  kind: "redis" | "memory";
  read(): Promise<State>;
  write(s: State): Promise<void>;
  log(e: LogEntry): Promise<void>;
  logs(n?: number): Promise<LogEntry[]>;
  clearLogs(): Promise<void>;
}

const KEY = "dummy-school:state";
const LOG = "dummy-school:log";
const LOG_KEEP = 300;

function redisStore(url: string, token: string): Store {
  const call = async (commands: (string | number)[][]) => {
    const res = await fetch(`${url.replace(/\/+$/, "")}/pipeline`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(commands),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`Redis answered ${res.status}`);
    const out = (await res.json()) as { result?: unknown; error?: string }[];
    const err = out.find((r) => r.error);
    if (err) throw new Error(`Redis: ${err.error}`);
    return out.map((r) => r.result);
  };
  return {
    kind: "redis",
    async read() {
      const [raw] = await call([["GET", KEY]]);
      return normalize(typeof raw === "string" ? JSON.parse(raw) : null);
    },
    async write(s) {
      await call([["SET", KEY, JSON.stringify(s)]]);
    },
    async log(e) {
      await call([["LPUSH", LOG, JSON.stringify(e)], ["LTRIM", LOG, 0, LOG_KEEP - 1]]);
    },
    async logs(n = 100) {
      const [rows] = await call([["LRANGE", LOG, 0, n - 1]]);
      return ((rows as string[]) ?? []).map((r) => JSON.parse(r) as LogEntry);
    },
    async clearLogs() {
      await call([["DEL", LOG]]);
    },
  };
}

function memoryStore(): Store {
  const g = globalThis as unknown as { __dummySchool?: { state: State; log: LogEntry[] } };
  g.__dummySchool ??= { state: defaultState(), log: [] };
  const mem = g.__dummySchool;
  return {
    kind: "memory",
    read: async () => normalize(structuredClone(mem.state)),
    write: async (s) => void (mem.state = structuredClone(s)),
    log: async (e) => void (mem.log.unshift(e), (mem.log.length = Math.min(mem.log.length, LOG_KEEP))),
    logs: async (n = 100) => mem.log.slice(0, n),
    clearLogs: async () => void (mem.log.length = 0),
  };
}

/** Redis when Vercel's Upstash variables are set; memory otherwise. */
export function getStore(): Store {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? redisStore(url, token) : memoryStore();
}

/** For tests: forget everything kept in memory. */
export function resetMemoryStore() {
  (globalThis as unknown as { __dummySchool?: unknown }).__dummySchool = undefined;
}
