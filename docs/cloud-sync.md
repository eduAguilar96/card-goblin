# Admin-only cloud sync

Cloud sync is a private operator feature for the CardGoblin administrator. The
current deployment has one shared credential, one cloud project, and infrastructure
sized for one account. It is **not a public product feature** and must not appear in
the public wiki, public roadmap, landing-page copy, or sitemap.

The public editor remains local-first: code and sheet rows are stored in browser
`localStorage`, uploaded assets are stored in IndexedDB, and project files are the
supported way for public users to back up or move work. This private mirror does not
change those guarantees for signed-out users.

The implementation and its behavior are retained here for maintainers. The setup,
security, and recovery runbook is in [deployment.md](deployment.md). The agreed
design is [DESIGN.md §7.6](DESIGN.md#76-cross-device-sync--agreed-spec-2026-08-17).

## Scope and capacity

- One administrator username and password; there are no public accounts,
  permissions, invitations, or per-user isolation.
- One cloud project, mirroring the editor's single local save slot.
- One administrator is the supported capacity. Do not enable or document this as a
  multi-user service without first designing and provisioning real account and data
  isolation.
- Code, sheet rows, and uploaded assets are mirrored. Project files remain the
  recoverable backup and multi-project mechanism.

## Sign-in reconciliation

After successful authentication, the client compares the browser project with the
cloud project before editing resumes:

- If the browser still contains the untouched demo or already matches the cloud,
  it loads the cloud project and downloads missing assets.
- If no cloud project exists, it uploads the browser project immediately.
- If both sides contain different real work, it keeps the checkpoint open until the
  administrator chooses **Use cloud project** or **Use this device's project**.

The same checkpoint runs when a remembered session is restored. A remembered login
is not treated as proof that the project already visible in the browser is current.

## What syncs and when

- Code and sheet rows push about **10 seconds** after your last change.
- Uploaded images are transferred or deleted immediately, independently of that
  debounce.
- Leaving the page flushes a pending project push when possible.
- A session lasts **30 days**. Rotating `SESSION_SECRET` invalidates every session.

## Status and conflict behavior

The private status control reports syncing, synced, offline, and conflict states.
Every push carries the revision on which it was based. If the cloud changed after
this browser last read it, the push is refused and the operator must explicitly
reload the cloud copy or overwrite it with this device's project.

## "Your editor has work that isn't in the cloud"

**Your editor has work that isn't in the cloud** means sign-in found two different
real projects. Nothing is
replaced until the administrator chooses one:

- **Use cloud project** discards this browser's local project and downloads the
  cloud project and its assets.
- **Use this device's project** keeps this browser's project and uploads its code,
  rows, and complete asset library.

## Known limits

- Conflict handling is guarded last-write-wins, not merging.
- Assets sync separately from code and rows, so temporary partial progress is
  normal.
- Resetting to the demo or importing a project replaces the local asset library but
  does not currently delete now-unreferenced cloud objects.
- Signing out clears this browser's session only. Rotate `SESSION_SECRET` to revoke
  all remembered sessions.
- Missing cloud configuration must degrade only the private feature; signed-out
  local editing must continue to work.

## Maintenance guardrails

The behavior above is covered by the cloud client, route, storage, and component
tests. `src/lib/docs/__tests__/docFacts.test.ts` also checks the operator-facing
10-second debounce, 30-day session, and exact conflict label against implementation
constants. Keep those checks pointed at this file, never at public wiki copy.
