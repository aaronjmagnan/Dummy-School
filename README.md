# Dummy School

A fake school district that answers like three student information systems
at once: **Aeries**, **Clever**, and **PowerSchool**. It's for testing
Bright Bell's SIS connections without a real district's credentials. None of
the three vendors offers an open sandbox.

All three read the **same** district: Lincoln High, Roosevelt Middle, and
Cedar Elementary, with about 160 students, their guardians, teachers,
classes, terms, and attendance. Every name, number, and address is made up.

| Path | Answers like |
| --- | --- |
| `/aeries` | Aeries API v5 (`AERIES-CERT`), OneRoster 1.1 (`/token`), attendance |
| `/clever` | Clever Data API v3.0 (district token) |
| `/powerschool` | PowerSchool SIS API (`/ws/v1`), OneRoster 1.1 plugin |
| `/` | The control panel |

## The control panel

- **Connect**: the exact settings to paste into Bright Bell for each system, with copy buttons.
- **Students**: search, withdraw or re-enroll, edit names, grades, and guardians, move students between classes, add students.
- **Classes**: change a class's teacher; edit teachers.
- **Changes and problems**: "next sync" changes, a new term, pretend today is another date, undo,
  and failure switches per system (refused sign-in, ended sign-ins, server errors, rate limits,
  and for Aeries, missing permissions and no school-wide attendance list).
- **Request log**: every request Bright Bell made, live.

Every change applies to all three systems at once.

## Edge cases planted on purpose

From what the three connectors each have to handle (`src/district/seed.ts`, `EDGE`): a student
with no student number, a withdrawn student still listed in Aeries, a pre-registered student, a
middle schooler also enrolled at the high school, a student in no classes, a student with only
Clever's guaranteed fields, siblings sharing a guardian who is also an aunt to a third student,
an emergency contact listed before family, two parents whose emails share one PowerSchool field,
a malformed state id, a guardian email Clever doesn't validate, a teacher with no email, a
teacher from another school, a co-taught class, a teacher Clever doesn't share, a class with no
period or term, a dropped class, and a class the student already left.

## Run it locally

```
npm install
npm run dev        # http://localhost:3000, panel open, state in memory
npm test
```

Bright Bell only connects to `https://` SIS addresses, so point Bright Bell at the deployed copy.
Scripts and tests can use the local one.

## Deploy on Vercel

1. Import this repo as a Vercel project (framework: Next.js).
2. Add an **Upstash Redis** store from the Vercel Marketplace and connect it to the project.
   That sets `KV_REST_API_URL` and `KV_REST_API_TOKEN`.
3. Set `PANEL_PASSWORD` and `TOKEN_SECRET` (see `.env.example`).
4. Turn off Vercel Authentication (Deployment Protection) for the production domain, or Bright
   Bell's servers will be turned away. The mock APIs hold only fake data and check their own fake
   credentials; the panel has its own password.

For Clever, set `CLEVER_API_URL=https://<your-dummy-school>/clever` on the Bright Bell deployment
you're testing (never production), since Clever's address is fixed in Bright Bell.

## How it's built

- `src/district`: the one district. `seed.ts` builds it for a date; `changes.ts` replays the
  panel's changes over it; `attendance.ts` generates attendance from the student and date.
- `src/vendors`: one plain function per system that turns a request into a response, plus the
  OneRoster view the Aeries and PowerSchool mocks share. Sign-in tokens are signed, not stored.
- `src/state`: the saved state (changes, switches, request log) in Redis or memory, and the glue
  that answers a request.
- `src/app`: the Next.js routes and the control panel.
