import type { LogEntry } from "@/state/store";
import { clearLog } from "../actions";
import { LiveRefresh } from "./client";

const NAME = { aeries: "Aeries", clever: "Clever", powerschool: "PowerSchool" } as const;

export function Log({ entries }: { entries: LogEntry[] }) {
  return (
    <section className="card" aria-labelledby="log-h">
      <div className="row-between">
        <h2 id="log-h">What Bright Bell asked for</h2>
        <div className="row">
          <LiveRefresh />
          {entries.length ? <form action={clearLog}><button type="submit" className="secondary">Clear</button></form> : null}
        </div>
      </div>
      <p className="muted">The latest {entries.length || ""} requests to the three systems, newest first. Sign-in keys aren&apos;t recorded.</p>
      {entries.length ? (
        <div className="table-wrap">
          <table className="log">
            <thead><tr><th>Time</th><th>System</th><th>Request</th><th>Answer</th><th>Took</th></tr></thead>
            <tbody>
              {entries.map((e, i) => (
                <tr key={i}>
                  <td className="small nowrap">{new Date(e.at).toLocaleTimeString("en-US", { timeZone: "America/Los_Angeles" })}</td>
                  <td>{NAME[e.vendor]}</td>
                  <td><code className="wrap">{e.method} {e.path}</code></td>
                  <td><span className={`status s${String(e.status)[0]}`}>{e.status}</span></td>
                  <td className="small">{e.ms} ms</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <p className="muted">Nothing yet. Test the connection or sync from Bright Bell and requests show up here.</p>}
    </section>
  );
}
