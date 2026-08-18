# Deployment: cloud sync

The operational runbook for [cloud sync](DESIGN.md §7.6, decision ◆45) — the
optional "Sign in" that mirrors a project across devices. Everything else about
CardGoblin needs no setup: with none of the env vars below set, the app builds
and runs exactly as it always has, signed-out and entirely local (that's the
default, and it's meant to stay boring).

This is a repo-level operational doc, not a wiki page — the *what it does and how
it behaves* half lives at [`/docs/cloud-sync`](wiki/export-and-project/07-cloud-sync.md)
(card designers); this page is *how to turn it on* (whoever runs the deployment).

## The six environment variables

| Variable | What it's for |
|---|---|
| `R2_ACCOUNT_ID` | Your Cloudflare account ID (Cloudflare dashboard → R2 → Overview — it's in the right-hand panel, and in the S3 API endpoint Cloudflare shows you: `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`). |
| `R2_ACCESS_KEY_ID` | From an R2 API token (below). |
| `R2_SECRET_ACCESS_KEY` | From the same token — shown once, at creation. |
| `R2_BUCKET` | The bucket name you create for this project. |
| `ADMIN_PASSWORD_HASH` | The output of `npm run hash-password` (below, enforces >= 16 characters) — never the plaintext password. |
| `SESSION_SECRET` | A random string signing the session cookie (below, must be >= 32 bytes or it's treated as not set at all). |

Set these in your hosting provider's environment variable settings (Vercel: Project
→ Settings → Environment Variables), or in a local `.env.local` for testing —
`.env*` is already gitignored, so a local file never gets committed by accident. All
six are server-only; none of them is prefixed `NEXT_PUBLIC_*`, so none of them ever
reaches the browser bundle.

Missing or blank ANY of them degrades that piece cleanly: `R2_*` missing → the
project/asset routes 503 ("cloud not configured"); `ADMIN_PASSWORD_HASH`/
`SESSION_SECRET` missing → login 503s the same way. Either way, the editor itself —
signed out — is unaffected. There's no state where a misconfigured deployment
crashes or half-works; it's cloud sync specifically that's unavailable.

## Create the R2 bucket

1. Cloudflare dashboard → R2 → **Create bucket**. Any name; put it in `R2_BUCKET`.
   Location: your choice — R2 doesn't charge egress, so this is about latency, not
   cost.
2. **Keep it private.** Cloud sync never needs public bucket access — every read
   and write goes through this app's own routes (which mint short-lived presigned
   URLs for the browser to use directly, per §7.6's "4.5 MB wall") or through
   server-to-R2 calls signed with the API token below. A public bucket would let
   anyone with a URL read your project.
3. R2 → **Manage API tokens** → **Create API token**, scoped to just this bucket,
   with **Object Read & Write** permission. Cloudflare shows the Access Key ID and
   Secret Access Key once — copy both immediately into `R2_ACCESS_KEY_ID` /
   `R2_SECRET_ACCESS_KEY`; there's no way to view the secret again afterward (only
   to issue a new token).

## CORS

The Next.js server never proxies asset bytes (that's the whole point of presigned
URLs) — the **browser** PUTs/GETs objects directly against R2, which makes this a
genuine cross-origin request from your site's origin to
`*.r2.cloudflarestorage.com`. Without a CORS policy on the bucket, those requests
fail. R2 → your bucket → **Settings** → **CORS Policy**. This is a PRODUCTION
policy — one origin, your real deployed domain:

```json
[
  {
    "AllowedOrigins": ["https://your-deployed-domain.example"],
    "AllowedMethods": ["GET", "PUT"],
    "AllowedHeaders": ["content-type"],
    "ExposeHeaders": ["etag"],
    "MaxAgeSeconds": 3600
  }
]
```

Replace `https://your-deployed-domain.example` with your real deployed origin (the
same value you'd set `NEXT_PUBLIC_SITE_URL` to, per `src/lib/site.ts`). Two things
worth being precise about:

- **No `DELETE`.** Deleting an asset goes through this app's OWN route
  (`DELETE /api/cloud/assets/[name]`), which calls R2 server-to-server with the API
  token above — the browser never issues a cross-origin `DELETE` to R2 directly, so
  granting it here would be an unused, unnecessary permission on the bucket.
- **Only add `http://localhost:3000` if you're testing `npm run dev` against this
  SAME real bucket** — append it as a second array entry, don't replace the
  production one with it. It's a development convenience, not something a
  production bucket policy needs; leave it out if you always test against a
  separate bucket (or the in-memory fake this project's own tests use).

`content-type` is the only header the browser needs to send: uploads are
query-string-signed (no `Authorization` header crosses the wire, and `Content-Length`
is signed too — see r2.ts's `presignPut` — so an upload of more or fewer bytes than
was authorized fails outright rather than silently landing), and downloads are plain
`GET`s.

## Generate `SESSION_SECRET`

At least 32 random bytes — shorter is rejected outright (`loadSessionEnvFromProcess`
treats it as "not configured," the same as missing, rather than accepting a weak
signing key):

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

Treat it like a password — anyone who has it can forge a valid session cookie
without ever knowing `ADMIN_PASSWORD_HASH` or the real password. Rotating it
(setting a new value) invalidates every existing session immediately — the
emergency "sign everyone out, everywhere, right now" lever if a device or the
secret itself is ever compromised. **Changing `ADMIN_PASSWORD_HASH` alone does
NOT do this** — see below.

## Set the admin password

```bash
npm run hash-password
```

Prompts twice on **stdin** (masked, never echoed), refuses anything under 16
characters, and prints a `scrypt$...` line — paste the WHOLE line as
`ADMIN_PASSWORD_HASH`. The script never takes the password as a command-line
argument on purpose: argv is visible to every other process on the machine (`ps`)
and typically lands in shell history, which the intended secret input method
(stdin) avoids. See `scripts/hash-password.mjs` for the format details (mirrored,
deliberately, from `src/lib/cloud/session.ts`).

Pick something long and ideally randomly generated (a password manager's generator,
or e.g. `node -e "console.log(require('node:crypto').randomBytes(18).toString('base64url'))"`
for a 24-character random one) — this is the ONE credential every signed-in device
shares, and per `src/app/api/cloud/login/route.ts`'s own doc comment, a fixed
per-attempt delay is the only brute-force defense on the LOGIN ROUTE itself
(serverless functions share no memory across invocations, so a request-counting
rate limiter would reset every cold start and protect nobody) — and that delay
throttles a single connection, not the aggregate: an attacker running many
parallel requests is throttled once per connection, not once overall, so the
password's own length and randomness are what actually stand between a guesser
and this deployment.

**Changing the password later does NOT sign anyone out.** The session cookie is
validated against `SESSION_SECRET` alone (`src/lib/cloud/session.ts`) — rotating
`ADMIN_PASSWORD_HASH` stops the OLD password from working for any FUTURE sign-in,
but every device already signed in stays signed in, for up to 30 days, regardless.
If a device or the password itself may be compromised, rotate `SESSION_SECRET`
too (above) — that's the lever that actually revokes existing sessions.

## Verifying it worked

With all six variables set and deployed, `/editor` should show a **Sign in** button
in the status bar. Signing in with the password you hashed should pull whatever's
already in the bucket (nothing, the first time) and start showing a synced status.
If Sign in instead fails with "Cloud sync isn't set up on this server," double-check
`ADMIN_PASSWORD_HASH`/`SESSION_SECRET` reached the runtime environment (a redeploy is
often required after adding env vars). If sign-in succeeds but asset uploads fail
silently (the status bar shows **Offline** shortly after adding an image), it's
almost always the CORS policy above.
