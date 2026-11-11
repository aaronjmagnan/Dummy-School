import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

/*
 * The control panel changes the fake district for everyone using it, so it
 * sits behind one shared password (PANEL_PASSWORD). The mock APIs don't:
 * they hold only made-up data and check their own fake credentials.
 *
 * With no PANEL_PASSWORD, the panel is open when running locally and
 * closed on Vercel.
 */

export const COOKIE = "dummy_school_panel";
const password = () => process.env.PANEL_PASSWORD ?? "";
export const onVercel = () => Boolean(process.env.VERCEL);
const proof = (pw: string) => createHmac("sha256", `${process.env.TOKEN_SECRET ?? "dummy-school"}:panel`).update(pw).digest("base64url");

export type PanelAccess = "open" | "signed-in" | "needs-sign-in" | "needs-setup";

export async function panelAccess(): Promise<PanelAccess> {
  const pw = password();
  if (!pw) return onVercel() ? "needs-setup" : "open";
  const got = (await cookies()).get(COOKIE)?.value ?? "";
  const want = proof(pw);
  return got.length === want.length && timingSafeEqual(Buffer.from(got), Buffer.from(want)) ? "signed-in" : "needs-sign-in";
}

export async function requirePanel() {
  const a = await panelAccess();
  if (a !== "open" && a !== "signed-in") throw new Error("Sign in to the control panel first.");
}

export function checkPassword(attempt: string) {
  const pw = password();
  if (!pw || attempt.length !== pw.length) return null;
  return timingSafeEqual(Buffer.from(attempt), Buffer.from(pw)) ? proof(pw) : null;
}
