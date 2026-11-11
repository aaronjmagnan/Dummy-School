import { NEXT_SYNC, type Change } from "@/district/changes";
import type { District } from "@/district/model";
import type { State } from "@/state/store";
import type { Vendor, VendorSwitches } from "@/vendors/http";
import { resetDistrict, resetEverything, runScenario, setSwitch, setToday, undoLast } from "../actions";

const AREAS = ["Student Data", "Contacts", "Attendance", "Absence Code Table"];
const VENDOR_NAME: Record<Vendor, string> = { aeries: "Aeries", clever: "Clever", powerschool: "PowerSchool" };

/** A change, in words. Names come from the district as it is now. */
function describe(c: Change, d: District) {
  const s = (id: number) => { const x = d.students.find((y) => y.id === id); return x ? `${x.first} ${x.last}` : `student ${id}`; };
  const sec = (id: number) => d.sections.find((y) => y.id === id)?.course ?? `class ${id}`;
  const t = (id: number) => { const x = d.teachers.find((y) => y.id === id); return x ? `${x.first} ${x.last}` : `teacher ${id}`; };
  switch (c.type) {
    case "withdraw": return `Withdrew ${s(c.studentId)}`;
    case "restore": return `Enrolled ${s(c.studentId)} again`;
    case "addStudent": return `Added ${c.first} ${c.last}`;
    case "editStudent": return `Edited ${s(c.studentId)}`;
    case "editGuardian": return "Edited a guardian";
    case "dropClass": return `${s(c.studentId)} dropped ${sec(c.sectionId)}`;
    case "addToClass": return `${s(c.studentId)} joined ${sec(c.sectionId)}`;
    case "setTeacher": return `${sec(c.sectionId)} now taught by ${t(c.teacherId)}`;
    case "editTeacher": return `Edited ${t(c.teacherId)}`;
    case "nextSync": return "Next sync changes";
    case "newTerm": return "New term";
  }
}

function SwitchButton({ vendor, what, label, on }: { vendor: Vendor; what: string; label: string; on?: boolean }) {
  return (
    <form action={setSwitch}>
      <input type="hidden" name="vendor" value={vendor} />
      <input type="hidden" name="what" value={what} />
      <button type="submit" className={on ? "on" : "secondary"} aria-pressed={on}>{label}</button>
    </form>
  );
}

function Counter({ vendor, what, label, value }: { vendor: Vendor; what: string; label: string; value: number }) {
  return (
    <form action={setSwitch} className="inline">
      <input type="hidden" name="vendor" value={vendor} />
      <input type="hidden" name="what" value={what} />
      <label className="inline">{label}<input name="n" type="number" min={0} max={50} defaultValue={value} className="narrow" /></label>
      <button type="submit" className="secondary">Set</button>
      <span className="small muted">requests</span>
      {value ? <span className="badge withdrawn">{value} to go</span> : null}
    </form>
  );
}

function VendorProblems({ vendor, sw, children }: { vendor: Vendor; sw: VendorSwitches; children?: React.ReactNode }) {
  return (
    <section className="card" aria-labelledby={`p-${vendor}`}>
      <h3 id={`p-${vendor}`}>{VENDOR_NAME[vendor]}</h3>
      <div className="stack">
        <SwitchButton vendor={vendor} what="rejectSignIn" on={sw.rejectSignIn} label={sw.rejectSignIn ? "Sign-in is refused (click to allow)" : "Refuse sign-in"} />
        <SwitchButton vendor={vendor} what="expireTokens" label="End every sign-in now" />
        <Counter vendor={vendor} what="failNext" label="Server errors (500) for the next" value={sw.failNext} />
        <Counter vendor={vendor} what="rateLimitNext" label="Rate limits (429) for the next" value={sw.rateLimitNext} />
        {children}
      </div>
    </section>
  );
}

export function Problems({ district, state, today }: { district: District; state: State; today: string }) {
  const a = state.switches.aeries;
  return (
    <>
      <section className="card" aria-labelledby="scen-h">
        <h2 id="scen-h">Change the district</h2>
        <p className="muted">Each of these changes what all three systems report. Sync from Bright Bell afterward to see how it handles the change.</p>
        <div className="scenarios">
          <form action={runScenario}>
            <input type="hidden" name="scenario" value="nextSync" />
            <button type="submit">Next sync changes</button>
            <p className="small">
              {NEXT_SYNC.withdrawn.length} students withdraw, {NEXT_SYNC.added.length} new students enroll, a guardian email changes, a grade goes up, a
              student drops Algebra I, and a teacher&apos;s name and email change.
            </p>
          </form>
          <form action={runScenario}>
            <input type="hidden" name="scenario" value="newTerm" />
            <button type="submit">New term</button>
            <p className="small">Fall classes end and spring classes start with new ids, the way a real SIS rolls over.</p>
          </form>
          <form action={setToday}>
            <label>Pretend today is<input type="date" name="today" defaultValue={state.today ?? ""} /></label>
            <button type="submit" className="secondary">{state.today ? "Change" : "Set"}</button>
            <p className="small">Now: {today}{state.today ? " (pretend)" : ""}. Clear the date to use the real one. Term dates and attendance follow it.</p>
          </form>
        </div>
      </section>

      <section className="card" aria-labelledby="hist-h">
        <div className="row-between">
          <h2 id="hist-h">Changes so far</h2>
          <div className="row">
            {state.changes.length ? <form action={undoLast}><button type="submit" className="secondary">Undo last</button></form> : null}
            {state.changes.length ? <form action={resetDistrict}><button type="submit" className="secondary">Back to the starting district</button></form> : null}
          </div>
        </div>
        {state.changes.length ? (
          <ol className="history">
            {[...state.changes].reverse().map((c, i) => (
              <li key={i}><span>{describe(c, district)}</span>{c.at ? <time className="muted small" dateTime={c.at}>{new Date(c.at).toLocaleString("en-US", { timeZone: "America/Los_Angeles", dateStyle: "medium", timeStyle: "short" })}</time> : null}</li>
            ))}
          </ol>
        ) : <p className="muted">None. This is the starting district.</p>}
      </section>

      <h2 className="section-title">Make something go wrong</h2>
      <p className="muted">See how Bright Bell handles a district that misbehaves. Counters go down by one with each request until they reach zero.</p>
      <div className="cards-3">
        <VendorProblems vendor="aeries" sw={a}>
          <form action={setSwitch} className="stack-tight">
            <input type="hidden" name="vendor" value="aeries" />
            <input type="hidden" name="what" value="deny" />
            <fieldset>
              <legend>Certificate not granted</legend>
              {AREAS.map((area) => <label key={area} className="check"><input type="checkbox" name="area" value={area} defaultChecked={a.deny.includes(area)} /> {area}</label>)}
            </fieldset>
            <button type="submit" className="secondary">Save</button>
          </form>
          <SwitchButton vendor="aeries" what="noSchoolWide" on={a.noSchoolWideAttendance} label={a.noSchoolWideAttendance ? "No school-wide attendance list (click to restore)" : "Hide the school-wide attendance list"} />
        </VendorProblems>
        <VendorProblems vendor="clever" sw={state.switches.clever} />
        <VendorProblems vendor="powerschool" sw={state.switches.powerschool} />
      </div>

      <section className="card danger-zone">
        <h2>Start over</h2>
        <p className="muted">Clears every change, turns off every problem, and empties the request log.</p>
        <form action={resetEverything}><button type="submit" className="danger">Reset everything</button></form>
      </section>
    </>
  );
}
