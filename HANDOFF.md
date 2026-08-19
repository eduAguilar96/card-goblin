# CardGoblin — handoff notes (2026-08-19)

Written for whoever picks this up next, human or otherwise. Everything here
was verified against the repo at the time of writing, not recalled.

## Repo state

- Branch `main`, **1642 tests green**, `npx tsc --noEmit` clean.
- The cloud-sync fix described below is committed locally alongside the earlier
  unpushed `7d9b0ba` (diagnose problem-codes). Neither is deployed until the
  owner pushes `main`.
- Deployed on Vercel at cardgoblin.com; auto-deploys on push to `main`.

## What the project is

A browser tool that turns a small DSL ("Goblin script") plus a spreadsheet into
print-ready cards. No backend for the core product — the compiler, renderer and
PDF export all run client-side.

Read in this order: `CLAUDE.md` (working agreements + docs contract) →
`docs/DESIGN.md` (the spec and, in §2, a decision log of ~45 numbered decisions
with justifications) → `docs/development.md` (build/test/code map).

## Ground rules that matter

- **Spec first**: `docs/DESIGN.md` is normative; change it, then the code, then
  the tests. New decisions get a numbered row in §2.
- **Docs contract** (`CLAUDE.md`): a user-visible change updates its wiki page
  in the same commit. `src/lib/docs/__tests__/docFacts.test.ts` checks the
  wiki's numbers/tables against the constants they describe, bidirectionally —
  when it fails, fix the docs or the pattern, never delete the check.
- **Never-throws contracts**: `parse`, `check`, `generateModel`,
  `compileProject` degrade to diagnostics rather than throwing. One bad
  spreadsheet cell must never blank a deck.
- **The test suite is headless** (no jsdom, no browser driver). It structurally
  cannot catch DOM/CSS/lifecycle bugs; two shipped CRITICALs were of that class.
  Anything touching React runtime deserves manual browser verification.
- **Don't run `npm run build` while `npm run dev` is running** — both write to
  `.next/` and the production build removes manifests the dev server holds open,
   500ing every route. Recovery: `rm -rf .next`, restart dev.

## Milestones shipped

M1 (vertical slice), M2 (PDF export, autosave, autocomplete, icon styles,
custom sizes, Image element), M3 so far (TextBox wrapping, nine-point pivots,
QR codes, local image assets, project files, fonts, row reordering + `[row]`/
`[card]` bindings, `rotate:`, inline icons).

## CLOUD SYNC ROOT CAUSE — fixed and committed locally, not deployed yet

**Symptom (owner-reported, trustworthy):** sign in on production, edit the
project, wait — nothing appears in another browser. Signing in elsewhere shows
that browser's own local state.

**Verified facts (including the 2026-08-19 takeover pass):**
- The R2 bucket was **empty** — zero objects under `projects/`; nothing had ever
  been written.
- `GET /api/cloud/diagnose` on production reports all R2/auth config present,
  the hash parsing, and a sufficiently long session secret.
- Production's project route exists and correctly returns 401 without a
  session; an intentionally invalid login also returns the expected generic
  401. This is not the earlier missing-route/404 failure.
- The local R2 credentials are write-capable: a conditional diagnostic PUT,
  read-after-write, and cleanup all succeeded (200/200/204) without touching
  project data. The token is not read-only.
- The public production JavaScript bundle does **not** contain the local
  empty-cloud adoption/success-notice code. Production is still running the
  version that treats an empty cloud GET as a successful sync without PUTting
  anything.

**Root cause in the deployed code:** the `pull()` not-found branch sets
`knownRevision = 0`, changes the status to `idle`, and records `lastSyncedAt`
without ever calling `putProject`. The UI therefore says the empty bucket is
synced although no project exists. The in-flight `adoptLocalProject` change
fixes that by immediately pushing the local project (and its asset bytes) as
revision 1 after the empty-cloud GET.

**What remains before calling it end-to-end fixed:** deploy the local commit,
then do one production sign-in against the still-empty bucket and verify all
three authoritative signals: a `PUT /api/cloud/project` occurs, the status says
`No cloud project yet — uploading this one`, and R2 contains
`projects/default/project.json`. Then sign in from a second browser and confirm
it loads that copy. The owner's report that an edit-triggered push also failed
has direct fake-transport regression coverage now, but still deserves this live
post-deploy check rather than another assumption.

## Cloud-sync fix included in the local commit

The commit updates 7 tracked implementation/spec/test files plus this handoff:
sign-in now adopts the
local project when the cloud is empty, `lastSyncedAt` only set after a real
server round trip, a conflict prompt instead of silently replacing local work,
sign-in feedback text, asset-manifest integrity, and a docs/code copy check.
Tests pass (1642) and `npx tsc --noEmit` is clean. This patch **does fix the
empty-cloud root cause above**, but it is not present in the live bundle yet.

## Cloud sync design (for context)

`docs/DESIGN.md` §7.6 + decision ◆45. Object storage plus one password, no
database: Cloudflare R2 holds `projects/default/project.json` (code + sheets)
and `projects/default/assets/<name>`; a single admin username/password mints an
HMAC-signed `__Host-` cookie; asset bytes move browser↔R2 via short-lived
presigned URLs (Vercel caps request bodies below one image); a `revision`
integer guards against one device clobbering another.

Operational runbook, including the six env vars and `npm run hash-password`:
`docs/deployment.md`. Known trap documented there: the stored hash uses `.`
separators because `$` gets eaten by dotenv expansion in `.env.local`.

## Security notes

- `.env.local` holds live R2 credentials and is gitignored. **They were exposed
  in an assistant session — rotate them.**
- The security perimeter is one password + one HMAC secret; both have enforced
  minimum lengths. Sessions are stateless, so sign-out doesn't revoke other
  devices — rotating `SESSION_SECRET` is the kill switch.
