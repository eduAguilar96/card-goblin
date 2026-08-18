---
title: Cloud sync
status: evolving
summary: Sign in to sync your project across devices — what syncs, the behind-prompt, and the honest limits.
---

# Cloud sync

If whoever runs this copy of CardGoblin has turned it on, a **Sign in** button appears
in the status bar. Signing in carries your project — code, sheet rows, and uploaded
images — to any other computer where you sign in with the same password. It's
optional: without it (or before you sign in), everything works exactly like the
[autosave](autosave.md)-only experience described elsewhere in these pages.

This is not an accounts system. There's one password for the whole site, set by
whoever deployed it — see [Setting it up](#setting-it-up) if that's you.

## Signing in

Click **Sign in** and enter the password. On success, CardGoblin fetches whatever
project is saved in the cloud and loads it — replacing what was in this browser —
then downloads any images that came with it that this browser doesn't already have,
showing progress ("3 of 8 images…") while it does. If nothing has ever been pushed to
the cloud yet, your current local project simply becomes the starting point.

## What syncs, and when

- **Code and sheet rows** — the same shape [autosave](autosave.md) saves locally —
  push to the cloud about **10 seconds** after your last change (much slower than
  autosave's 1 second: cloud writes cost real money at scale, local ones don't).
- **Uploaded images** ([the Assets drawer](assets.md)) upload or delete the moment
  you add or remove them, independent of that 10-second wait.
- Signing out, or closing the tab, doesn't lose anything queued — leaving the page
  flushes any pending sync first.

## The status indicator

Once signed in, the status bar shows a dot and a short label instead of the Sign in
button:

- **Synced 2m ago** (or similar) — everything is pushed; the time is how long ago.
- **Syncing…** — a push or pull is in progress.
- **Offline** — the last attempt failed (no network, the server is unreachable, your
  session expired). Editing is completely unaffected; CardGoblin quietly keeps
  working locally and retries on your next change.
- **This browser is behind** — see below.

**Sign out** is always available next to the indicator. It clears the session on this
browser only; your project stays exactly as it was in the cloud.

## "This browser is behind"

Every push carries the revision it was based on. If another device pushed something
newer since this browser last synced, the push is refused rather than silently
overwriting that other work — you'll never lose a change just because two devices
were open at once. Instead the status bar offers two choices:

- **Reload** — discard this browser's unsynced changes and load the server's copy.
- **Overwrite** — keep what's in this browser and push it as the new version anyway,
  replacing what the other device wrote.

Either way, nothing is silently thrown away: the choice is always yours.

## Honest limits

- **One project, same as local.** Cloud sync mirrors the single save slot
  [autosave](autosave.md) already has — it doesn't add a second project or a project
  list. For more than one project, [project files](project-files.md) are still the
  way, cloud or not.
- **Last-write-wins, guarded — not merging.** The revision check stops a SILENT
  overwrite (see above), but CardGoblin never merges two people's simultaneous edits
  line by line. If you resolve a "this browser is behind" prompt, one side's edits
  since the last sync are gone from the cloud copy (though never gone from the
  browser that made them, unless you choose Reload there too).
- **Images sync separately from code and sheets**, as described above — a moment
  where one has synced and the other hasn't is normal, not a bug.
- **Removing an image doesn't always clean up the cloud copy.** An ordinary delete
  in the Assets drawer does — that upload is removed from the cloud right away. But
  **Reset to demo** and importing a [project file](project-files.md) replace your
  whole local library at once, and today that bulk replace doesn't walk the cloud
  deleting what's no longer there — the old images stay in cloud storage,
  unreferenced, until something uploads a new image with that same name. Not a
  privacy concern beyond what already applies to the rest of a signed-in project
  (still only reachable with the shared password), just unclaimed storage.
- **One password for everyone who has it.** There's no per-person identity — anyone
  with the password can sign in and see or change the project. Treat it like the key
  to a shared drive, not an individual login.
- **Sign out clears THIS browser, not every copy of your session.** There's no
  server-side account system to revoke a session from (the same "no database" choice
  that keeps this simple) — a session lasts up to 30 days once granted. If a device
  you signed in on is lost, shared, or no longer trusted, Sign out on it isn't enough
  by itself; ask whoever runs the deployment to rotate `SESSION_SECRET`
  ([`docs/deployment.md`](../../deployment.md)), which immediately signs every device
  out at once (the actual "something's wrong, cut it off" lever).
- **Off unless the operator turned it on.** If cloud sync isn't configured on this
  deployment, Sign in fails with a plain message and nothing else changes — the rest
  of the editor behaves exactly as if the button weren't there.

## Setting it up

Cloud sync needs a Cloudflare R2 bucket and a few environment variables — see
[`docs/deployment.md`](../../deployment.md) in the repository for the full runbook
(the six env vars, the bucket and CORS setup, and generating the admin password with
`npm run hash-password`). A session lasts **30 days** before you're asked to sign in
again.
