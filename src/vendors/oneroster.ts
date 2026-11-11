import type { District, School, Section, Student } from "../district/model.ts";
import { json, type MockResponse } from "./http.ts";

/*
 * OneRoster 1.1 rostering, shared by the Aeries and PowerSchool mocks.
 * Each SIS names things its own way (sourcedIds, identifiers, how
 * withdrawn students appear), so the differences are passed in.
 */

export type OneRosterStyle = {
  schoolId: (s: School) => string;
  studentId: (s: Student) => string;
  studentIdentifier: (s: Student, school: School) => string;
  guardianId: (guardianId: number) => string;
  teacherId: (teacherId: number) => string;
  classId: (sec: Section, school: School) => string;
  termId: (termId: number, school: School) => string;
  /** "omit": withdrawn students and their enrollments aren't listed. "tobedeleted": listed with that status. */
  inactive: "omit" | "tobedeleted";
  districtName: string;
};

/** OneRoster's grade vocabulary. */
export const orGrade = (g: number | null) => (g === null ? [] : [g === -2 ? "PK" : g === -1 ? "TK" : g === 0 ? "KG" : String(g).padStart(2, "0")]);

export function oneRosterView(d: District, school: School, st: OneRosterStyle) {
  const listed = d.students.filter((s) => s.school === school.key && s.status !== "preregistered" && (st.inactive === "tobedeleted" || s.status === "active"));
  const status = (active: boolean) => (active ? "active" : "tobedeleted");
  const org = { sourcedId: st.schoolId(school), type: "org" };

  const users = listed.map((s) => ({
    sourcedId: st.studentId(s), status: status(s.status === "active"), dateLastModified: `${d.today}T07:00:00.000Z`,
    enabledUser: "true", role: "student", username: s.email, email: s.email,
    givenName: s.first, familyName: s.last, middleName: "",
    identifier: st.studentIdentifier(s, school),
    userIds: s.stateId ? [{ type: "stateId", identifier: s.stateId }] : [],
    grades: orGrade(s.grade),
    agents: s.guardians.map((g) => ({ sourcedId: st.guardianId(g.guardianId), type: "user" })),
    orgs: [org],
  }));

  const guardians = d.guardians.map((g) => {
    const links = d.students.flatMap((s) => s.guardians.filter((x) => x.guardianId === g.id).map((x) => ({ s, x })));
    const role = links.some(({ x }) => x.type === "Parent/Guardian") ? (links.some(({ x }) => x.relationship === "Guardian") ? "guardian" : "parent") : "relative";
    return {
      sourcedId: st.guardianId(g.id), status: "active", enabledUser: "true", role,
      givenName: g.first, familyName: g.last, email: g.email, sms: g.phone, phone: g.phone, username: g.email,
      agents: links.map(({ s }) => ({ sourcedId: st.studentId(s), type: "user" })),
      orgs: [{ sourcedId: "0", type: "org" }],
    };
  });

  const teachers = d.teachers.filter((t) => t.school === school.key || d.sections.some((sec) => sec.school === school.key && sec.teachers.includes(t.id))).map((t) => ({
    sourcedId: st.teacherId(t.id), status: "active", enabledUser: "true", role: "teacher",
    givenName: t.first, familyName: t.last, email: t.email, username: t.email, identifier: String(t.id), orgs: [org],
  }));

  const sections = d.sections.filter((s) => s.school === school.key);
  const classes = sections.map((sec) => ({
    sourcedId: st.classId(sec, school), status: "active", title: sec.course, classCode: sec.courseNumber, classType: "scheduled",
    course: { sourcedId: sec.courseNumber, type: "course" }, school: org,
    terms: sec.termId ? [{ sourcedId: st.termId(sec.termId, school), type: "academicSession" }] : [],
    periods: sec.period ? [sec.period] : [],
  }));

  const studentById = new Map(d.students.map((s) => [s.id, s]));
  const enrollments = sections.flatMap((sec) => [
    ...sec.teachers.map((t, i) => ({
      sourcedId: `${st.classId(sec, school)}-T${t}`, status: "active", role: "teacher", primary: i === 0 ? "true" : "false",
      user: { sourcedId: st.teacherId(t), type: "user" }, class: { sourcedId: st.classId(sec, school), type: "class" }, school: org,
    })),
    ...sec.roster.flatMap((r) => {
      const s = studentById.get(r.studentId);
      if (!s || s.status === "preregistered") return [];
      const active = r.status === "active" && s.status === "active";
      if (!active && st.inactive === "omit") return [];
      return [{
        sourcedId: `${st.classId(sec, school)}-S${r.studentId}`, status: status(active), role: "student", primary: "false",
        user: { sourcedId: st.studentId(s), type: "user" }, class: { sourcedId: st.classId(sec, school), type: "class" }, school: org,
      }];
    }),
  ]);

  const usedTerms = new Set(sections.map((s) => s.termId).filter(Boolean));
  const terms = d.terms.filter((t) => usedTerms.has(t.id)).map((t) => ({
    sourcedId: st.termId(t.id, school), status: "active", title: t.name, type: "term", startDate: t.start, endDate: t.end, schoolYear: t.end.slice(0, 4),
  }));

  return { users, guardians, teachers, classes, enrollments, terms };
}

/** Answers a OneRoster rostering request; `parts` is the path after /ims/oneroster/v1p1. */
export function oneRosterRoute(d: District, parts: string[], query: URLSearchParams, st: OneRosterStyle, findSchool: (id: string) => School | undefined): MockResponse {
  const limit = Math.max(1, Math.min(10000, Number(query.get("limit") ?? 100) || 100));
  const offset = Math.max(0, Number(query.get("offset") ?? 0) || 0);
  const page = (key: string, all: unknown[]) => json(200, { [key]: all.slice(offset, offset + limit) }, { "X-Total-Count": String(all.length) });
  const notFound = () => json(404, { imsx_codeMajor: "failure", imsx_severity: "error", imsx_codeMinor: "unknownobject" });
  const [what, id, sub] = parts.map((p) => decodeURIComponent(p));
  const orgFor = (s: School) => ({ sourcedId: st.schoolId(s), status: "active", name: s.name, type: "school", identifier: s.number, parent: { sourcedId: "0", type: "org" } });

  if ((what === "orgs" || what === "schools") && !id) {
    const schools = d.schools.map(orgFor);
    return page("orgs", what === "orgs" ? [{ sourcedId: "0", status: "active", name: st.districtName, type: "district" }, ...schools] : schools);
  }
  if (what === "users" && id) {
    for (const school of d.schools) {
      const v = oneRosterView(d, school, st);
      const u = [...v.users, ...v.teachers, ...v.guardians].find((x) => x.sourcedId === id);
      if (u) return json(200, { user: u });
    }
    return notFound();
  }
  if ((what === "schools" || what === "orgs") && id) {
    const school = findSchool(id);
    if (!school) return notFound();
    const v = oneRosterView(d, school, st);
    switch (sub) {
      case undefined: return json(200, { org: orgFor(school) });
      case "students": return page("users", v.users);
      case "teachers": return page("users", v.teachers);
      case "classes": return page("classes", v.classes);
      case "enrollments": return page("enrollments", v.enrollments);
      case "terms": return page("academicSessions", v.terms);
      default: return notFound();
    }
  }
  return notFound();
}
