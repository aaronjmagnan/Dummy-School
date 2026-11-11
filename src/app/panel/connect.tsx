import type { District } from "@/district/model";
import { AERIES_CERT, AERIES_CLIENT_ID, AERIES_CLIENT_SECRET } from "@/vendors/aeries";
import { CLEVER_TOKEN, cid } from "@/vendors/clever";
import { PS_CLIENT_ID, PS_CLIENT_SECRET } from "@/vendors/powerschool";
import { Copy } from "./client";

type Row = [label: string, value: string, note?: string];

/** Settings that are picked from a list in Bright Bell, not pasted. */
const PICKED = new Set(["Student information system", "OneRoster version", "Sign-in method"]);

function Settings({ rows }: { rows: Row[] }) {
  return (
    <dl className="settings">
      {rows.map(([label, value, note]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>
            {!value ? <span className="muted">Leave blank</span> : PICKED.has(label) ? <span>Choose <strong>{value}</strong></span> : <><code>{value}</code><Copy value={value} /></>}
            {note ? <span className="note">{note}</span> : null}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function Connect({ district, origin }: { district: District; origin: string }) {
  const local = !origin.startsWith("https://");
  const high = district.schools[0];
  return (
    <>
      <p className="lede">
        Dummy School answers like three student information systems at once, all reading the same fake district. Paste these settings into Bright Bell
        to connect a test school, then change the district on the other tabs and sync again.
      </p>
      {local ? (
        <p className="callout">
          You&apos;re running Dummy School locally over plain http. Bright Bell only accepts https:// SIS addresses, so connect Bright Bell to the
          deployed Dummy School on Vercel instead, or use this address only from scripts and tests.
        </p>
      ) : null}

      <section className="card" aria-labelledby="aeries-h">
        <h2 id="aeries-h">Aeries</h2>
        <h3>Bright Bell SIS screen (OneRoster)</h3>
        <Settings rows={[
          ["Student information system", "Aeries"],
          ["SIS address", `${origin}/aeries`],
          ["School ID in the SIS", String(high.aeriesCode), `${high.name}. Also ${district.schools.slice(1).map((s) => `${s.aeriesCode} (${s.name})`).join(", ")}.`],
          ["Client ID", AERIES_CLIENT_ID],
          ["Client secret", AERIES_CLIENT_SECRET],
          ["Token URL", "", "Bright Bell's Aeries preset already uses /token."],
        ]} />
        <h3>Bright Bell absence feed (Aeries API)</h3>
        <Settings rows={[
          ["Address", `${origin}/aeries`],
          ["School code", String(high.aeriesCode)],
          ["Certificate", AERIES_CERT, "The example certificate from Aeries' own docs."],
        ]} />
      </section>

      <section className="card" aria-labelledby="clever-h">
        <h2 id="clever-h">Clever</h2>
        <p>
          Clever has one fixed address, so Bright Bell reads it from a setting on the server. On the Bright Bell deployment you&apos;re testing, set
          this environment variable, then redeploy:
        </p>
        <Settings rows={[["CLEVER_API_URL", `${origin}/clever`, "Only on a test or preview deployment, never production."]]} />
        <h3>Bright Bell SIS screen</h3>
        <Settings rows={[
          ["Student information system", "Clever"],
          ["District token", CLEVER_TOKEN],
          ...district.schools.map((s): Row => [`Clever school ID: ${s.name}`, cid(`school:${s.key}`)]),
        ]} />
      </section>

      <section className="card" aria-labelledby="ps-h">
        <h2 id="ps-h">PowerSchool</h2>
        <h3>Bright Bell SIS screen (OneRoster plugin)</h3>
        <Settings rows={[
          ["Student information system", "PowerSchool"],
          ["OneRoster version", "1.1"],
          ["Sign-in method", "OAuth 2 (client ID + secret)"],
          ["SIS address", `${origin}/powerschool`],
          ["Token URL", "", "The usual /oauth/token works."],
          ["School ID in the SIS", String(high.psId), `${high.name}. The school number ${high.number} works too.`],
          ["Client ID", PS_CLIENT_ID],
          ["Client secret", PS_CLIENT_SECRET],
          ["State id field", "userIds:stateId", "Optional: only where Bright Bell asks for it."],
        ]} />
        <h3>PowerSchool&apos;s own API</h3>
        <p className="muted">
          For Bright Bell&apos;s PowerSchool API connector and its tester script. Same address and keys; sign-in is at /oauth/access_token, school
          number {high.number}.
        </p>
      </section>

      <section className="card" aria-labelledby="schools-h">
        <h2 id="schools-h">The schools in each system</h2>
        <div className="table-wrap">
          <table>
            <thead><tr><th>School</th><th>Grades</th><th>Aeries code</th><th>PowerSchool id / number</th><th>Clever id</th></tr></thead>
            <tbody>
              {district.schools.map((s) => (
                <tr key={s.key}>
                  <td>{s.name}</td>
                  <td>{s.lowGrade < 0 ? "TK" : s.lowGrade === 0 ? "K" : s.lowGrade}-{s.highGrade}</td>
                  <td>{s.aeriesCode}</td>
                  <td>{s.psId} / {s.number}</td>
                  <td><code>{cid(`school:${s.key}`)}</code></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
