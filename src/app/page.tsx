import { headers } from "next/headers";
import { districtFor, todayFor } from "@/state/serve";
import { getStore } from "@/state/store";
import { signIn, signOut } from "./actions";
import { panelAccess } from "./auth";
import { Classes } from "./panel/classes";
import { Connect } from "./panel/connect";
import { Log } from "./panel/log";
import { Problems } from "./panel/problems";
import { Students } from "./panel/students";

const TABS = [
  ["connect", "Connect"],
  ["students", "Students"],
  ["classes", "Classes"],
  ["changes", "Changes and problems"],
  ["log", "Request log"],
] as const;

export default async function Home({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const raw = await searchParams;
  const params = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, Array.isArray(v) ? v[0] ?? "" : v ?? ""]));
  const access = await panelAccess();

  if (access === "needs-setup" || access === "needs-sign-in") {
    return (
      <main className="narrow-page">
        <h1>Dummy School</h1>
        {access === "needs-setup" ? (
          <p>The control panel is locked until a password is set. Add a <code>PANEL_PASSWORD</code> environment variable to this Vercel project and redeploy.</p>
        ) : (
          <form action={signIn} className="card stack">
            <label>Control panel password<input name="password" type="password" autoComplete="current-password" required autoFocus /></label>
            {params.error ? <p className="error" role="alert">That password isn&apos;t right.</p> : null}
            <button type="submit">Sign in</button>
          </form>
        )}
        <p className="muted small">The mock SIS addresses work without signing in; only this panel is locked.</p>
      </main>
    );
  }

  const store = getStore();
  const state = await store.read();
  const district = districtFor(state);
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const origin = `${h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https")}://${host}`;
  const tab = TABS.some(([k]) => k === params.tab) ? params.tab : "connect";
  const enrolled = district.students.filter((s) => s.status === "active").length;

  return (
    <>
      <header className="top">
        <div className="brand">
          <h1>Dummy School</h1>
          <p className="muted small">
            {district.name} · {enrolled} enrolled students · today {todayFor(state)}{state.today ? " (pretend)" : ""} · {state.changes.length} changes
            {store.kind === "memory" ? " · saved in memory only" : ""}
          </p>
        </div>
        {access === "signed-in" ? <form action={signOut}><button type="submit" className="link">Sign out</button></form> : null}
      </header>
      <nav className="tabs" aria-label="Sections">
        {TABS.map(([key, label]) => (
          <a key={key} href={`/?tab=${key}`} aria-current={tab === key ? "page" : undefined}>{label}</a>
        ))}
      </nav>
      <main>
        {tab === "connect" ? <Connect district={district} origin={origin} /> : null}
        {tab === "students" ? <Students district={district} params={params} /> : null}
        {tab === "classes" ? <Classes district={district} /> : null}
        {tab === "changes" ? <Problems district={district} state={state} today={todayFor(state)} /> : null}
        {tab === "log" ? <Log entries={await store.logs(150)} /> : null}
      </main>
    </>
  );
}
