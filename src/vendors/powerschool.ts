import type { District, School, Student } from "../district/model.ts";
import { bearer, clientCredentials, issueToken, json, tokenValid, type Ctx, type MockRequest, type MockResponse } from "./http.ts";
import { oneRosterRoute, type OneRosterStyle } from "./oneroster.ts";

/*
 * PowerSchool, both ways a real server offers rostering. Address:
 * {base} = https://<host>/powerschool
 *
 *   PowerSchool SIS API
 *     POST {base}/oauth/access_token                        client credentials, HTTP Basic
 *     GET  {base}/ws/v1/district/school
 *     GET  {base}/ws/v1/school/{id}/student|staff|course|term|section[/count]   ?page&pagesize&expansions
 *     GET  {base}/ws/v1/section/{id}/section_enrollment
 *
 *   OneRoster 1.1 plugin
 *     POST {base}/oauth/token (or /oauth/access_token)
 *     GET  {base}/ims/oneroster/v1p1/...
 *
 * Quirks real servers have: one record comes back as a bare object and an
 * empty list as ""; numbers arrive as strings in places; pages hold at most
 * 100; expansions are only included when asked for.
 */

export const PS_CLIENT_ID = "dummy-school-powerschool";
export const PS_CLIENT_SECRET = "powerschool-secret";

const wrap = <T,>(xs: T[]): T | T[] | "" => (xs.length === 0 ? "" : xs.length === 1 ? xs[0] : xs);
const ENROLL: Record<Student["status"], [string, number]> = { active: ["A", 0], withdrawn: ["T", 2], preregistered: ["P", -1] };

export const psStyle: OneRosterStyle = {
  schoolId: (s) => String(s.psId),
  studentId: (s) => String(s.id),
  studentIdentifier: (s) => s.number,
  guardianId: (g) => `g-${g}`,
  teacherId: (t) => `t-${t}`,
  classId: (sec) => `c-${sec.id}`,
  termId: (t) => `term-${t}`,
  inactive: "tobedeleted",
  districtName: "Dummy School District",
};

function addDays(day: string, n: number) {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** The district as PowerSchool records, per school (keyed by PowerSchool school id). */
export function psView(d: District, school: School) {
  const students = d.students.filter((s) => s.school === school.key).map((s) => {
    const links = s.guardians.map((l) => ({ l, g: d.guardians.find((x) => x.id === l.guardianId)! }));
    const named = (rel: string) => links.find(({ l }) => l.relationship === rel)?.g;
    const name = (g?: { first: string; last: string }) => (g ? `${g.first} ${g.last}` : "");
    const [status, code] = ENROLL[s.status];
    return {
      id: String(s.id),
      local_id: s.number ? Number(s.number) : "",
      student_username: s.email.split("@")[0] ?? "",
      state_province_id: s.stateId,
      name: { first_name: s.first, last_name: s.last },
      school_enrollment: { grade_level: s.grade ?? "", enroll_status: status, enroll_status_code: code, ...(s.status === "withdrawn" ? { exit_date: d.today } : {}) },
      contact: {
        mother: name(named("Mother")),
        father: name(named("Father")),
        // Districts often put every parent's email in this one field.
        guardian_email: links.filter(({ l }) => l.type === "Parent/Guardian").map(({ g }) => g.email).filter(Boolean).join(", "),
        emergency_contact_name1: name(links[0]?.g),
        emergency_phone1: links[0]?.g.phone ?? "",
        emergency_contact_name2: name(links[1]?.g),
        emergency_phone2: links[1]?.g.phone ?? "",
      },
    };
  });

  const staff = d.teachers.filter((t) => t.school === school.key).map((t) => ({
    id: t.id, name: { first_name: t.first, last_name: t.last }, ...(t.email ? { emails: { work_email: t.email } } : {}),
  }));

  const sections = d.sections.filter((s) => s.school === school.key);
  const courseNumbers = [...new Set(sections.map((s) => s.courseNumber))];
  const courseId = (n: string) => 700 + courseNumbers.indexOf(n);
  const courses = courseNumbers.map((n) => ({ id: courseId(n), course_number: n, course_name: sections.find((s) => s.courseNumber === n)!.course }));

  const usedTerms = new Set(sections.map((s) => s.termId).filter(Boolean));
  const terms = d.terms.filter((t) => usedTerms.has(t.id)).map((t) => ({ id: t.id, name: t.name, abbreviation: t.code, start_date: t.start, end_date: t.end }));

  const psSections = sections.map((sec) => ({
    id: sec.id, course_id: courseId(sec.courseNumber), ...(sec.termId ? { term_id: sec.termId } : {}),
    ...(sec.teachers[0] ? { staff_id: String(sec.teachers[0]) } : {}), section_number: String(sec.id % 100),
    expression: sec.period ? `${sec.period}(A)` : "",
  }));

  const yearEnd = d.terms[0].end;
  const enrollments = new Map(sections.map((sec) => {
    const term = d.terms.find((t) => t.id === sec.termId);
    const start = term?.start ?? d.terms[0].start;
    const end = term && term.end > d.today ? term.end : yearEnd;
    return [String(sec.id), sec.roster.map((r, i) => ({
      id: sec.id * 1000 + i, section_id: sec.id, student_id: String(r.studentId), entry_date: start,
      // PowerSchool's exit date is the first day the student is no longer in the class.
      exit_date: r.status === "left" ? addDays(d.today, -1) : end,
      dropped: r.status === "dropped",
    }))];
  }));

  return { students, staff, courses, terms, sections: psSections, enrollments };
}

function signIn(req: MockRequest, ctx: Ctx): MockResponse {
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });
  const form = new URLSearchParams(req.body);
  const { id, secret } = clientCredentials(req.headers, form);
  if (id !== PS_CLIENT_ID || secret !== PS_CLIENT_SECRET || ctx.switches.rejectSignIn) return json(401, { error: "invalid_client" });
  if (form.get("grant_type") !== "client_credentials") return json(400, { error: "unsupported_grant_type" });
  return json(200, { access_token: issueToken("powerschool", ctx.switches.tokenEpoch, 3600, ctx.now), token_type: "Bearer", expires_in: "3600" });
}

export function powerschool(req: MockRequest, ctx: Ctx): MockResponse {
  const d = ctx.district;
  const parts = req.path.filter(Boolean).map(decodeURIComponent);
  const path = `/${parts.join("/")}`;

  if (path === "/oauth/access_token" || path === "/oauth/token") return signIn(req, ctx);

  const auth = req.headers.get("authorization") ?? "";
  // OAuth 1 (older OneRoster setups): only the consumer key is checked, not the signature.
  const oauth1 = auth.startsWith("OAuth ") && auth.includes(`oauth_consumer_key="${PS_CLIENT_ID}"`) && !ctx.switches.rejectSignIn;
  if (!oauth1 && !tokenValid(bearer(req.headers), "powerschool", ctx.switches.tokenEpoch, ctx.now)) {
    return json(401, { message: "Invalid or expired access token" });
  }

  const findSchool = (key: string) => d.schools.find((s) => String(s.psId) === key) ?? d.schools.find((s) => s.number === key);

  if (parts[0] === "ims" && parts[1] === "oneroster" && parts[2] === "v1p1") return oneRosterRoute(d, parts.slice(3), req.query, psStyle, findSchool);

  const page = Math.max(1, Number(req.query.get("page") ?? 1) || 1);
  const size = Math.min(100, Math.max(1, Number(req.query.get("pagesize") ?? 100) || 100));
  const paged = <T,>(xs: T[]) => xs.slice((page - 1) * size, page * size);
  const expansions = new Set((req.query.get("expansions") ?? "").split(",").map((x) => x.trim()));

  if (path === "/ws/v1/district/school") {
    // Ids and numbers come back as numbers for some schools and strings for others.
    return json(200, { schools: { school: wrap(d.schools.map((s, i) => ({ id: i % 2 ? String(s.psId) : s.psId, name: s.name, school_number: i % 2 ? s.number : Number(s.number) }))) } });
  }

  let m = path.match(/^\/ws\/v1\/school\/([^/]+)\/(student|staff|course|term|section)(\/count)?$/);
  if (m) {
    const school = d.schools.find((s) => String(s.psId) === m![1]);
    if (!school) return json(404, { message: "School not found" });
    const v = psView(d, school);
    const rows: Record<string, unknown[]> = {
      student: v.students.map((s) => ({ ...s, school_enrollment: expansions.has("school_enrollment") ? s.school_enrollment : undefined, contact: expansions.has("contact") ? s.contact : undefined })),
      staff: v.staff.map((t) => ({ ...t, emails: expansions.has("emails") ? t.emails : undefined })),
      course: v.courses,
      term: v.terms,
      section: v.sections,
    };
    const all = rows[m[2]];
    if (m[3]) return json(200, { resource: { count: all.length } });
    const outer = m[2] === "staff" ? "staffs" : `${m[2]}s`;
    return json(200, { [outer]: { [m[2]]: wrap(paged(all)) } });
  }

  m = path.match(/^\/ws\/v1\/section\/([^/]+)\/section_enrollment$/);
  if (m) {
    const sec = d.sections.find((s) => String(s.id) === m![1]);
    if (!sec) return json(404, { message: "Section not found" });
    const rows = psView(d, d.schools.find((s) => s.key === sec.school)!).enrollments.get(String(sec.id)) ?? [];
    return json(200, { section_enrollments: { section_enrollment: wrap(paged(rows)) } });
  }

  return json(404, { message: `No such endpoint: ${path}` });
}
