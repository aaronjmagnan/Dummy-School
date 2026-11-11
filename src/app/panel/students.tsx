import { gradeLabel, type District, type Student } from "@/district/model";
import { addStudent, addToClass, dropClass, editStudent, restore, withdraw } from "../actions";

const GRADES = [-2, -1, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
const STATUS_LABEL: Record<Student["status"], string> = { active: "Enrolled", withdrawn: "Withdrawn", preregistered: "Pre-registered" };

function GradeSelect({ name, value }: { name: string; value: number | null }) {
  return (
    <select name={name} defaultValue={value === null ? "" : String(value)}>
      <option value="">None</option>
      {GRADES.map((g) => <option key={g} value={g}>{gradeLabel(g)}</option>)}
    </select>
  );
}

export function Students({ district, params }: { district: District; params: Record<string, string> }) {
  const d = district;
  const school = params.school ?? "";
  const status = params.status ?? "";
  const q = (params.q ?? "").toLowerCase();
  const editing = d.students.find((s) => String(s.id) === params.edit);

  const classesOf = (s: Student) => d.sections.filter((sec) => sec.roster.some((r) => r.studentId === s.id && r.status === "active"));
  const guardian = (s: Student) => d.guardians.find((g) => g.id === s.guardians[0]?.guardianId);
  const shown = d.students.filter((s) =>
    (!school || s.school === school) && (!status || s.status === status) &&
    (!q || `${s.first} ${s.last} ${s.number} ${s.id}`.toLowerCase().includes(q)));
  const link = (extra: Record<string, string>) => `/?${new URLSearchParams({ tab: "students", ...(school && { school }), ...(status && { status }), ...(q && { q }), ...extra })}`;

  return (
    <>
      <form className="filters" method="get">
        <input type="hidden" name="tab" value="students" />
        <label>School
          <select name="school" defaultValue={school}>
            <option value="">All schools</option>
            {d.schools.map((s) => <option key={s.key} value={s.key}>{s.name}</option>)}
          </select>
        </label>
        <label>Status
          <select name="status" defaultValue={status}>
            <option value="">Any</option>
            <option value="active">Enrolled</option>
            <option value="withdrawn">Withdrawn</option>
            <option value="preregistered">Pre-registered</option>
          </select>
        </label>
        <label className="grow">Search
          <input name="q" defaultValue={params.q ?? ""} placeholder="Name or student number" />
        </label>
        <button type="submit" className="secondary">Show</button>
      </form>

      {editing ? (() => {
        const g = guardian(editing);
        const mine = classesOf(editing);
        const others = d.sections.filter((sec) => sec.school === editing.school && !mine.includes(sec));
        return (
          <section className="card edit" aria-labelledby="edit-h">
            <div className="row-between">
              <h2 id="edit-h">Edit {editing.first} {editing.last}</h2>
              <a href={link({})}>Close</a>
            </div>
            <form action={editStudent} className="grid">
              <input type="hidden" name="studentId" value={editing.id} />
              <input type="hidden" name="guardianId" value={g?.id ?? ""} />
              <label>First name<input name="first" defaultValue={editing.first} required /></label>
              <label>Last name<input name="last" defaultValue={editing.last} required /></label>
              <label>Grade<GradeSelect name="grade" value={editing.grade} /></label>
              <label>State id<input name="stateId" defaultValue={editing.stateId} /></label>
              {g ? (
                <>
                  <label>Guardian first name<input name="gFirst" defaultValue={g.first} /></label>
                  <label>Guardian last name<input name="gLast" defaultValue={g.last} /></label>
                  <label>Guardian email<input name="gEmail" defaultValue={g.email} /></label>
                  <label>Guardian phone<input name="gPhone" defaultValue={g.phone} /></label>
                </>
              ) : <p className="muted span">No guardian on file.</p>}
              <div className="span"><button type="submit">Save changes</button></div>
            </form>
            <h3>Classes</h3>
            {mine.length ? (
              <ul className="plain">
                {mine.map((sec) => (
                  <li key={sec.id} className="row-between">
                    <span>{sec.course}{sec.period ? `, period ${sec.period}` : ""}</span>
                    <form action={dropClass}>
                      <input type="hidden" name="studentId" value={editing.id} />
                      <input type="hidden" name="sectionId" value={sec.id} />
                      <button type="submit" className="link danger">Drop</button>
                    </form>
                  </li>
                ))}
              </ul>
            ) : <p className="muted">No current classes.</p>}
            {others.length ? (
              <form action={addToClass} className="inline">
                <input type="hidden" name="studentId" value={editing.id} />
                <select name="sectionId" aria-label="Class to add" defaultValue="">
                  <option value="" disabled>Add to a class…</option>
                  {others.map((sec) => <option key={sec.id} value={sec.id}>{sec.course}{sec.period ? `, period ${sec.period}` : ""}</option>)}
                </select>
                <button type="submit" className="secondary">Add</button>
              </form>
            ) : null}
          </section>
        );
      })() : null}

      <details className="card">
        <summary>Add a student</summary>
        <form action={addStudent} className="grid">
          <label>School
            <select name="school" defaultValue={school || "high"}>
              {d.schools.map((s) => <option key={s.key} value={s.key}>{s.name}</option>)}
            </select>
          </label>
          <label>Grade<GradeSelect name="grade" value={9} /></label>
          <label>First name<input name="first" required /></label>
          <label>Last name<input name="last" required /></label>
          <label>Guardian first name<input name="gFirst" /></label>
          <label>Guardian last name<input name="gLast" placeholder="Same as student" /></label>
          <label>Guardian email<input name="gEmail" type="email" /></label>
          <label>Guardian phone<input name="gPhone" /></label>
          <p className="muted span">New students join their school&apos;s first class, as a new enrollment usually does.</p>
          <div className="span"><button type="submit">Add student</button></div>
        </form>
      </details>

      <p className="muted">{shown.length} of {d.students.length} students{shown.length > 300 ? "; showing the first 300" : ""}.</p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr><th>Number</th><th>Name</th><th>Grade</th><th>School</th><th>Status</th><th>Guardian</th><th>Classes</th><th><span className="sr">Actions</span></th></tr>
          </thead>
          <tbody>
            {shown.slice(0, 300).map((s) => {
              const g = guardian(s);
              return (
                <tr key={s.id} className={s.status === "active" ? "" : "dim"}>
                  <td>{s.number || <span className="muted">none</span>}</td>
                  <td>{s.first} {s.last}</td>
                  <td>{gradeLabel(s.grade) || <span className="muted">none</span>}</td>
                  <td>{d.schools.find((x) => x.key === s.school)!.name.replace(/ School$/, "")}{s.alsoAt?.length ? " +1" : ""}</td>
                  <td><span className={`badge ${s.status}`}>{STATUS_LABEL[s.status]}</span></td>
                  <td>{g ? <>{g.first} {g.last}<br /><span className="muted small">{g.email || "no email"}</span></> : <span className="muted">none</span>}</td>
                  <td>{classesOf(s).length}</td>
                  <td className="actions">
                    <a href={link({ edit: String(s.id) })}>Edit</a>
                    <form action={s.status === "active" ? withdraw : restore}>
                      <input type="hidden" name="studentId" value={s.id} />
                      <button type="submit" className="link">{s.status === "active" ? "Withdraw" : "Enroll"}</button>
                    </form>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
