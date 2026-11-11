import { createHmac, timingSafeEqual } from "node:crypto";
import type { District } from "../district/model.ts";

/*
 * What every mock handler takes and returns. Handlers are plain functions,
 * so they run the same inside a Next.js route on Vercel and in tests.
 */

export type Vendor = "aeries" | "clever" | "powerschool";

export type MockRequest = {
  method: string;
  /** The path after the vendor prefix, e.g. ["api", "v5", "schools"]. Case as sent. */
  path: string[];
  query: URLSearchParams;
  headers: Headers;
  body: string;
};

export type MockResponse = {
  status: number;
  body: unknown;
  headers?: Record<string, string>;
  /** Send `body` as text with this content type instead of JSON. */
  text?: string;
};

export type VendorSwitches = {
  /** Sign-in fails even with the right credentials. */
  rejectSignIn: boolean;
  /** The next N requests answer 500. */
  failNext: number;
  /** The next N requests answer 429. */
  rateLimitNext: number;
  /** Bumped to end every sign-in issued so far. */
  tokenEpoch: number;
};

export type AeriesSwitches = VendorSwitches & {
  /** Security areas the certificate wasn't granted: "Student Data", "Contacts", "Attendance", "Absence Code Table". */
  deny: string[];
  /** This Aeries has no school-wide attendance list (the connector falls back to one student at a time). */
  noSchoolWideAttendance: boolean;
};

export type Ctx<S extends VendorSwitches = VendorSwitches> = {
  district: District;
  switches: S;
  /** The full public address of this vendor, e.g. https://dummy-school.vercel.app/aeries. */
  base: string;
  now: number;
};

export const json = (status: number, body: unknown, headers?: Record<string, string>): MockResponse => ({ status, body, headers });

// ---------- sign-in tokens ----------

const secret = () => process.env.TOKEN_SECRET || "dummy-school-local-token-secret";
const sign = (payload: string) => createHmac("sha256", secret()).update(payload).digest("base64url");

/** A bearer token that proves itself: vendor, sign-in epoch, and expiry, signed. */
export function issueToken(vendor: Vendor, epoch: number, ttlSeconds: number, now = Date.now()) {
  const payload = `${vendor}.${epoch}.${Math.floor(now / 1000) + ttlSeconds}.${Math.random().toString(36).slice(2, 8)}`;
  return `${payload}.${sign(payload)}`;
}

export function tokenValid(token: string | null | undefined, vendor: Vendor, epoch: number, now = Date.now()) {
  if (!token) return false;
  const i = token.lastIndexOf(".");
  if (i < 0) return false;
  const payload = token.slice(0, i);
  const want = Buffer.from(sign(payload));
  const got = Buffer.from(token.slice(i + 1));
  if (want.length !== got.length || !timingSafeEqual(want, got)) return false;
  const [v, e, exp] = payload.split(".");
  return v === vendor && Number(e) === epoch && Number(exp) * 1000 > now;
}

export const bearer = (h: Headers) => /^Bearer\s+(.+)$/i.exec(h.get("authorization") ?? "")?.[1]?.trim() ?? null;

/** Client id and secret from HTTP Basic auth or the form body. */
export function clientCredentials(h: Headers, form: URLSearchParams) {
  const basic = /^Basic\s+(.+)$/i.exec(h.get("authorization") ?? "");
  if (basic) {
    const [id, ...rest] = Buffer.from(basic[1], "base64").toString("utf8").split(":");
    return { id, secret: rest.join(":") };
  }
  return { id: form.get("client_id"), secret: form.get("client_secret") };
}
