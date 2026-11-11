import { createHash } from "node:crypto";
import type { District, Grade, Student } from "../district/model.ts";
import { bearer, json, type Ctx, type MockRequest, type MockResponse } from "./http.ts";

/*
 * Clever's Data API v3.0, as dev.clever.com documents it. Address:
 * {base} = https://<host>/clever (Bright Bell's CLEVER_API_URL).
 *
 * - Bearer district-app token on every request; 401 without the right one.
 * - List responses are { data: [{ data, uri }], links: [{ rel, uri }] },
 *   sorted by id, paged with limit (default 100, max 10,000; 413 above) and
 *   starting_after / ending_before. Links are relative ("/v3.0/..."), like Clever's.
 * - Only shared records exist: withdrawn and preregistered students, and
 *   the one unshared teacher, are 404s.
 * - 404 for an id the district doesn't share; HTML 404 for unknown endpoints.
 * - X-RateLimit-* headers on every answer.
 */

export const CLEVER_TOKEN = "dummy-school-clever-token";
const VERSION = "v3.0";
const PER_MINUTE = 1200;

/** Clever ids are 24 hex characters; stable ones come from a label. */
export const cid = (label: string) => createHash("sha1").update(`dummy-school:${label}`).digest("hex").slice(0, 24);

type Rec = { id: string } & Record<string, unknown>;

export const cleverGrade = (g: Grade | null) => (g === null ? undefined : g === -2 ? "PreKindergarten" : g === -1 ? "TransitionalKindergarten" : g === 0 ? "Kindergarten" : String(g));
const RELATIONSHIP: Record<string, string> = { Mother: "Parent", Father: "Parent", Guardian: "Guardian", Grandparent: "Grandparent", "Aunt/Uncle": "Aunt/Uncle", Other: "Other" };

/** The district as Clever records. */
export function cleverView(d: District) {
  const created = `${d.today.slice(0, 4)}-08-01T12:00:00.000Z`;
  const modified = `${d.today}T07:00:00.000Z`;
  const DISTRICT = cid("district");
  const school = (key: string) => cid(`school:${key}`);
  const shared = (s: Student) => s.status === "active";
  const studentId = (id: number) => cid(`student:${id}`);
  const base = { district: DISTRICT, created, last_modified: modified };

  const schools: Rec[] = d.schools.map((s) => ({
    id: school(s.key), ...base, name: s.name, sis_id: s.key.toUpperCase(), school_number: s.number,
    state_id: `CA-${s.number}`, low_grade: cleverGrade(s.lowGrade), high_grade: cleverGrade(s.highGrade),
  }));

  const students: Rec[] = d.students.filter(shared).map((s) => {
    const schoolIds = [s.school, ...(s.alsoAt ?? [])].map(school);
    const role: Record<string, unknown> = { school: schoolIds[0], schools: schoolIds, legacy_id: studentId(s.id) };
    if (s.number) role.sis_id = s.number;
    if (!s.sparse) {
      if (s.number) role.student_number = s.number;
      if (s.stateId) role.state_id = s.stateId;
      if (s.grade !== null) role.grade = cleverGrade(s.grade);
      role.enrollments = schoolIds.map((id) => ({ school: id, start_date: d.terms[0].start }));
    }
    return { id: studentId(s.id), ...base, name: { first: s.first, last: s.last }, ...(s.email && !s.sparse ? { email: s.email } : {}), roles: { student: role } };
  });

  const teachers: Rec[] = d.teachers.filter((t) => !t.unshared).map((t) => {
    const id = cid(`teacher:${t.id}`);
    const roles: Record<string, unknown> = { teacher: { sis_id: `T-${t.id}`, teacher_number: `T-${t.id}`, school: school(t.school), schools: [school(t.school)], legacy_id: id } };
    if (t.multiRole) {
      roles.staff = { staff_id: `ST-${t.id}`, schools: [school(t.school)], roles: [], legacy_id: cid(`staff:${t.id}`) };
      roles.district_admin = { legacy_id: cid(`admin:${t.id}`) };
    }
    return { id, ...base, name: { first: t.first, last: t.last }, ...(t.email ? { email: t.email } : {}), roles };
  });

  const contacts: Rec[] = d.guardians.flatMap((g) => {
    const rels = d.students.filter(shared).flatMap((s) => s.guardians.filter((l) => l.guardianId === g.id).map((l) => ({ student: studentId(s.id), relationship: RELATIONSHIP[l.relationship] ?? "Other", type: l.type })));
    if (!rels.length) return [];
    // Clever keeps a contact's whole name in name.last, and doesn't validate emails.
    return [{
      id: cid(`contact:${g.id}`), ...base, ...(g.email ? { email: g.email } : {}), name: { last: `${g.first} ${g.last}` },
      roles: { contact: { sis_id: `P-${g.id}`, ...(g.phone ? { phone: g.phone, phone_type: "Cell" } : {}), student_relationships: rels, legacy_id: cid(`contact-legacy:${g.id}`) } },
    }];
  });

  const sharedIds = new Set(d.students.filter(shared).map((s) => s.id));
  const sections: Rec[] = d.sections.map((sec) => {
    const teacherIds = sec.teachers.map((t) => cid(`teacher:${t}`));
    return {
      id: cid(`section:${sec.id}`), ...base, school: school(sec.school), sis_id: `SEC-${sec.id}`, section_number: String(sec.id),
      name: `${sec.course}${sec.period ? ` - ${sec.period}` : ""}`, subject: "other",
      ...(sec.period ? { period: sec.period } : {}),
      ...(sec.termId ? { term_id: cid(`term:${sec.termId}`) } : {}),
      ...(teacherIds[0] ? { teacher: teacherIds[0] } : {}),
      teachers: teacherIds,
      students: sec.roster.filter((r) => r.status === "active" && sharedIds.has(r.studentId)).map((r) => studentId(r.studentId)),
    };
  });

  const usedTerms = new Set(d.sections.map((s) => s.termId).filter(Boolean));
  const terms: Rec[] = d.terms.filter((t) => usedTerms.has(t.id)).map((t) => ({ id: cid(`term:${t.id}`), district: DISTRICT, name: t.name, start_date: t.start, end_date: t.end }));

  return {
    district: { id: DISTRICT, name: d.name, state: "running", sis_type: "dummy", mdr_number: "00000000", last_sync: modified, launch_date: created.slice(0, 10) } as Rec,
    schools,
    users: [...students, ...teachers, ...contacts],
    sections,
    terms,
  };
}

const rateHeaders = (now: number, remaining = PER_MINUTE - 1) => ({
  "X-RateLimit-Limit": String(PER_MINUTE),
  "X-RateLimit-Remaining": String(remaining),
  // A forced 429 resets right away, so a client's wait is short.
  "X-RateLimit-Reset": String(Math.floor(now / 1000) + (remaining ? 60 : 0)),
  "X-RateLimit-Bucket": "district-token",
});

export const cleverRateLimited = (now: number): MockResponse => json(429, { message: "Rate limit exceeded" }, rateHeaders(now, 0));

const htmlNotFound = (): MockResponse => ({ status: 404, body: null, text: "<html><body>Not Found</body></html>", headers: { "Content-Type": "text/html" } });

export function clever(req: MockRequest, ctx: Ctx): MockResponse {
  const [version, ...parts] = req.path.filter(Boolean).map(decodeURIComponent);
  if (version !== VERSION) return htmlNotFound();
  if (req.method !== "GET") return json(501, { message: "Not implemented" });
  if (bearer(req.headers) !== CLEVER_TOKEN || ctx.switches.rejectSignIn) return json(401, { message: "Unauthorized" });

  const data = cleverView(ctx.district);
  const headers = rateHeaders(ctx.now);
  const notFound = () => json(404, { message: "Resource not found" }, headers);
  const self = `/${VERSION}/${parts.join("/")}`;
  const uriFor = (kind: string, id: string) => `/${VERSION}/${kind}/${id}`;
  const role = req.query.get("role");
  const hasRole = (u: Rec, r: string | null) => !r || Boolean((u.roles as Record<string, unknown>)?.[r]);
  const userSchools = (u: Rec) => {
    const roles = (u.roles ?? {}) as Record<string, { schools?: string[]; school?: string }>;
    return new Set(["student", "teacher", "staff"].flatMap((r) => roles[r]?.schools ?? (roles[r]?.school ? [roles[r].school!] : [])));
  };

  const list = (kind: string, items: Rec[]): MockResponse => {
    const q = req.query;
    const limit = q.has("limit") ? Number(q.get("limit")) : 100;
    if (!Number.isInteger(limit) || limit < 1) return json(400, { message: "limit must be a positive integer" }, headers);
    if (limit > 10000) return json(413, { message: "limit must be 10000 or less" }, headers);
    const sorted = [...items].sort((a, b) => a.id.localeCompare(b.id));
    const after = q.get("starting_after");
    const before = q.get("ending_before");
    let page: Rec[];
    if (before) {
      const end = sorted.findIndex((x) => x.id >= before);
      const stop = end === -1 ? sorted.length : end;
      page = sorted.slice(Math.max(0, stop - limit), stop);
    } else {
      const start = after ? sorted.findIndex((x) => x.id > after) : 0;
      page = start === -1 ? [] : sorted.slice(start, start + limit);
    }
    // Links keep the request's other parameters, as Clever's do.
    const link = (key: string, value: string) => {
      const p = new URLSearchParams(q);
      p.delete("starting_after");
      p.delete("ending_before");
      p.set(key, value);
      return `${self}?${p}`;
    };
    const links = [{ rel: "self", uri: `${self}${q.size ? `?${q}` : ""}` }];
    // Like Clever, a next link appears whenever the page isn't empty, even on the last page.
    if (page.length) links.push({ rel: "next", uri: link("starting_after", page.at(-1)!.id) });
    if (page.length && (after || before)) links.push({ rel: "prev", uri: link("ending_before", page[0].id) });
    return json(200, { data: page.map((x) => ({ data: x, uri: uriFor(kind, x.id) })), links }, headers);
  };
  const one = (kind: string, item: Rec | undefined) =>
    item ? json(200, { data: item, links: [{ rel: "self", uri: uriFor(kind, item.id) }], uri: uriFor(kind, item.id) }, headers) : notFound();

  const [kind, id, sub] = parts;
  if (kind === "districts") return id ? one("districts", id === data.district.id ? data.district : undefined) : list("districts", [data.district]);
  if (kind === "schools") {
    if (!id) return list("schools", data.schools);
    const school = data.schools.find((s) => s.id === id);
    if (!school) return notFound();
    if (!sub) return one("schools", school);
    if (sub === "users") {
      if (role && !["staff", "student", "teacher"].includes(role)) return json(400, { message: "invalid role" }, headers);
      return list("users", data.users.filter((u) => hasRole(u, role) && !hasRole(u, "contact") && userSchools(u).has(id)));
    }
    if (sub === "sections") return list("sections", data.sections.filter((s) => s.school === id));
    if (sub === "terms") {
      const termIds = new Set(data.sections.filter((s) => s.school === id).map((s) => s.term_id));
      return list("terms", data.terms.filter((t) => termIds.has(t.id)));
    }
    return notFound();
  }
  if (kind === "users") {
    if (!id) {
      if (role && !["contact", "district_admin", "staff", "student", "teacher"].includes(role)) return json(400, { message: "invalid role" }, headers);
      return list("users", data.users.filter((u) => hasRole(u, role)));
    }
    const user = data.users.find((u) => u.id === id);
    if (!sub) return one("users", user);
    if (!user) return notFound();
    if (sub === "mycontacts") {
      return list("users", data.users.filter((u) =>
        ((u.roles as { contact?: { student_relationships?: { student: string }[] } }).contact?.student_relationships ?? []).some((r) => r.student === id)));
    }
    if (sub === "sections") return list("sections", data.sections.filter((s) => (s.students as string[]).includes(id) || (s.teachers as string[]).includes(id)));
    return notFound();
  }
  if (kind === "sections") {
    if (!id) return list("sections", data.sections);
    const s = data.sections.find((x) => x.id === id);
    if (!sub) return one("sections", s);
    if (!s) return notFound();
    if (sub === "users") {
      const ids = new Set([...(s.students as string[]), ...(s.teachers as string[])]);
      return list("users", data.users.filter((u) => ids.has(u.id) && hasRole(u, role)));
    }
    return notFound();
  }
  if (kind === "terms") return id ? one("terms", data.terms.find((t) => t.id === id)) : list("terms", data.terms);
  if (kind === "courses") return id ? notFound() : list("courses", []);
  return htmlNotFound();
}
