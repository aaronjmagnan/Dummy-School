import type { District } from "@/district/model";
import { editTeacher, setTeacher } from "../actions";

export function Classes({ district }: { district: District }) {
  const d = district;
  const teacher = (id: number) => d.teachers.find((t) => t.id === id);
  return (
    <>
      {d.schools.map((school) => {
        const sections = d.sections.filter((s) => s.school === school.key);
        return (
          <section key={school.key} className="card" aria-labelledby={`cls-${school.key}`}>
            <h2 id={`cls-${school.key}`}>{school.name}</h2>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Class</th><th>Period</th><th>Term</th><th>Teacher</th><th>Students</th><th>Dropped or left</th></tr></thead>
                <tbody>
                  {sections.map((sec) => {
                    const lead = teacher(sec.teachers[0]);
                    const active = sec.roster.filter((r) => r.status === "active").length;
                    return (
                      <tr key={sec.id}>
                        <td>{sec.course} <span className="muted small">{sec.courseNumber}</span></td>
                        <td>{sec.period ?? <span className="muted">none</span>}</td>
                        <td>{d.terms.find((t) => t.id === sec.termId)?.name ?? <span className="muted">none</span>}</td>
                        <td>
                          <form action={setTeacher} className="inline">
                            <input type="hidden" name="sectionId" value={sec.id} />
                            <select name="teacherId" defaultValue={lead?.id} aria-label={`Teacher for ${sec.course}`}>
                              {d.teachers.map((t) => <option key={t.id} value={t.id}>{t.first} {t.last}{t.school !== school.key ? " (other school)" : ""}</option>)}
                            </select>
                            <button type="submit" className="link">Change</button>
                          </form>
                          {sec.teachers.length > 1 ? <span className="muted small">with {sec.teachers.slice(1).map((t) => `${teacher(t)?.first} ${teacher(t)?.last}`).join(", ")}</span> : null}
                        </td>
                        <td>{active}</td>
                        <td>{sec.roster.length - active}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}

      <section className="card" aria-labelledby="teachers-h">
        <h2 id="teachers-h">Teachers</h2>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Name</th><th>Email</th><th>School</th><th>Notes</th><th><span className="sr">Edit</span></th></tr></thead>
            <tbody>
              {d.teachers.map((t) => (
                <tr key={t.id}>
                  <td>{t.first} {t.last}</td>
                  <td>{t.email || <span className="muted">none</span>}</td>
                  <td>{d.schools.find((s) => s.key === t.school)!.name}</td>
                  <td className="small">{[t.multiRole && "Also staff and district admin (Clever)", t.unshared && "Not shared with Clever"].filter(Boolean).join(". ")}</td>
                  <td>
                    <details>
                      <summary className="link">Edit</summary>
                      <form action={editTeacher} className="grid compact">
                        <input type="hidden" name="teacherId" value={t.id} />
                        <label>First<input name="first" defaultValue={t.first} required /></label>
                        <label>Last<input name="last" defaultValue={t.last} required /></label>
                        <label>Email<input name="email" defaultValue={t.email} /></label>
                        <div><button type="submit">Save</button></div>
                      </form>
                    </details>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
