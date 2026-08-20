---
title: Cloud sync
status: evolving
summary: Sign in to sync your project across devices — what syncs, the behind-prompt, and the honest limits.
---

# Cloud sync

If whoever runs this copy of CardGoblin has turned it on, a **Sign in** button appears
in the status bar. Signing in carries your project — code, sheet rows, and uploaded
images — to any other computer where you sign in with the same username and
password. It's optional: without it (or before you sign in), everything works
exactly like the [autosave](autosave.md)-only experience described elsewhere in
these pages.

This is not an accounts system. There's one username and password for the whole
site, set by whoever deployed it — see [Setting it up](#setting-it-up) if that's
you.

## Signing in

Click **Sign in** and enter the username and password. What happens next depends on
what's already in the cloud:

- **A project is already there, and this browser doesn't have unsaved work of its
  own** (it's still the untouched demo, or it already matches the cloud copy) —
  CardGoblin loads the cloud project, replacing what was in this browser, then
  downloads any images that came with it this browser doesn't already have, showing
  progress ("3 of 8 images…") while it does. The status bar briefly confirms
  **Loaded your cloud project**.
- **Nothing has ever been pushed to the cloud yet** — this browser's current
  project becomes the starting point, and CardGoblin uploads it — code, sheet
  rows, and every image — right away, rather than waiting for the next edit like
  an ordinary sync would. The status bar briefly confirms **No cloud project yet —
  uploading this one**.
- **A project is already there, AND this browser has its own unsaved work that's
  genuinely different from it** — nothing is replaced until you choose; see
  **Your editor has work that isn't in the cloud**, below.

After the credentials are accepted, a blocking checkpoint makes the result
unambiguous before you can edit:

- **Syncing** means CardGoblin is comparing this browser with the cloud, loading or
  uploading the chosen project, and transferring its images. Keep the window open.
- **Synced** means the project now shown in the editor matches the saved cloud
  project. Click **Continue** to resume editing.
- **Could not sync** means your work is still safe in this browser, but CardGoblin
  could not confirm it as saved in the cloud. You can **Continue locally**, or, if
  CardGoblin found two different real projects, choose **Use cloud project** or
  **Use this device's project**. A two-project choice cannot be dismissed without
  deciding which copy to keep.

This checkpoint also appears when CardGoblin restores a remembered 30-day session
on page load. A remembered login is never treated as proof that the project already
visible in that browser is current: CardGoblin performs the same comparison and
pull as a fresh sign-in. Private/incognito windows may share their private session
while any private window remains open, but they still pass through this project
reconciliation.

If sign-in fails, the dialog now says why: a wrong username or password, the server
not being set up for cloud sync at all, a network problem reaching it, or an
unexpected server error — each with its own message, so you're not left guessing
which one it was.

## What syncs, and when

- **Code and sheet rows** — the same shape [autosave](autosave.md) saves locally —
  push to the cloud about **10 seconds** after your last change (much slower than
  autosave's 1 second: cloud writes cost real money at scale, local ones don't).
- **Uploaded images** ([the Assets drawer](assets.md)) upload or delete the moment
  you add or remove them, independent of that 10-second wait. PNG, JPEG, GIF,
  WebP, AVIF, and SVG assets are supported by cloud sync. If a future or unusual
  local image format is rejected, **Offline** names the asset and the server's
  reason instead of reducing the problem to an anonymous error code.
- Signing out, or closing the tab, doesn't lose anything queued — leaving the page
  flushes any pending sync first.

## The status indicator

Once signed in, the status bar shows a dot and a short label instead of the Sign in
button:

- **Synced 2m ago** (or similar) — everything is pushed; the time is how long ago.
  Right after signing in, this briefly reads **Loaded your cloud project** or
  **No cloud project yet — uploading this one** instead, so you know which of the
  two just happened (see [Signing in](#signing-in) above) — it settles into the
  ordinary "Synced…" wording on your next change.
- **Syncing…** — a push or pull is in progress.
- **Offline** — the last attempt failed (no network, the server is unreachable, your
  session expired). During sign-in, CardGoblin first explains this in the blocking
  **Could not sync** checkpoint; after you choose **Continue locally**, editing is
  unaffected and CardGoblin retries a safe cloud comparison on your next change.
  If your local work now differs, that retry asks which project to keep instead of
  pushing blindly. Mid-session failures use only this quiet status. When R2 itself rejects a
  storage request, the detail names the operation plus its safe status/error code
  (without exposing credentials or project contents), so deployment problems are
  actionable instead of all reading as the same generic storage error.
- **This browser is behind** — see below.
- **Your editor has work that isn't in the cloud** — see below.

After the initial checkpoint is resolved and dismissed, **Sign out** is available
next to the indicator. It clears the session on this browser only; your project
stays exactly as it was in the cloud.

## "This browser is behind"

Every push carries the revision it was based on. If another device pushed something
newer since this browser last synced, the push is refused rather than silently
overwriting that other work — you'll never lose a change just because two devices
were open at once. Instead the status bar offers two choices:

- **Reload** — discard this browser's unsynced changes and load the server's copy.
- **Overwrite** — keep what's in this browser and push it as the new version anyway,
  replacing what the other device wrote.

Either way, nothing is silently thrown away: the choice is always yours.
The size or complexity of your Goblin script does not itself create a conflict;
a conflict means the cloud copy actually changed after this browser last read it.

## "Your editor has work that isn't in the cloud"

This is the sign-in version of the same problem: signing in found a project in the
cloud, but this browser ALSO has its own project that isn't just the demo and isn't
already what the cloud holds — two real, different projects. Rather than guessing
which one you want, CardGoblin keeps the synchronization checkpoint open and asks:

- **Use cloud project** — discard this browser's local work and load the cloud
  project (downloading its images the same way an ordinary sign-in would).
- **Use this device's project** — keep what's in this browser and upload it — code,
  sheet rows, and every image — replacing what was in the cloud.

Nothing is replaced until you choose. The checkpoint returns to **Syncing** while
the choice is applied, and says **Synced** only when the chosen project is the saved
cloud project.

## Honest limits

- **One project, same as local.** Cloud sync mirrors the single save slot
  [autosave](autosave.md) already has — it doesn't add a second project or a project
  list. For more than one project, [project files](project-files.md) are still the
  way, cloud or not.
- **Last-write-wins, guarded — not merging.** The revision check stops a SILENT
  overwrite (see above), but CardGoblin never merges two people's simultaneous edits
  line by line. If you resolve a "this browser is behind" or "your editor has work
  that isn't in the cloud" prompt, one side's edits are gone from the copy you
  didn't pick (though never gone from the browser that made them, unless you choose
  to discard them there too).
- **Images sync separately from code and sheets**, as described above — a moment
  where one has synced and the other hasn't is normal, not a bug.
- **Image work participates in the sign-in choice.** A local-only image or
  different local bytes under the same name counts as work, even if code and
  sheet rows already match. CardGoblin asks which project to keep instead of
  silently replacing that image. Images present only in the cloud are simply
  downloaded because that does not discard local work. Choosing the cloud
  project removes local-only images; choosing this device uploads its complete
  image library.
- **Removing an image doesn't always clean up the cloud copy.** An ordinary delete
  in the Assets drawer does — that upload is removed from the cloud right away. But
  **Reset to demo** and importing a [project file](project-files.md) replace your
  whole local library at once, and today that bulk replace doesn't walk the cloud
  deleting what's no longer there — the old images stay in cloud storage,
  unreferenced, until something uploads a new image with that same name. Not a
  privacy concern beyond what already applies to the rest of a signed-in project
  (still only reachable with the shared credentials), just unclaimed storage.
- **One username and password for everyone who has them.** There's no per-person
  identity — anyone with the credentials can sign in and see or change the project.
  Treat them like the key to a shared drive, not an individual login.
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
(the six required env vars, the bucket and CORS setup, generating the admin
password with `npm run hash-password`, and an optional `ADMIN_USERNAME` if you'd
rather the account name not default to "admin"). A session lasts **30 days** before
you're asked to sign in again.
