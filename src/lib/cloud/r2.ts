/**
 * Cloud object storage port (DESIGN.md §7.6, decision ◆45): a narrow
 * interface over R2 (Cloudflare's S3-compatible object storage), used by
 * every /api/cloud/* route. SERVER-ONLY — this module (and the aws4fetch
 * credentials it wraps) must never be imported from a "use client" file or
 * from cloudSync.ts; the browser talks to R2 directly only via the
 * short-lived presigned URLs these routes mint, never through this module.
 *
 * Shaped like assetStore.ts's AssetAdapter, deliberately: a small async
 * interface + a real implementation (aws4fetch-signed requests to R2's S3
 * API) + an in-memory fake tests inject + a module singleton with a
 * test-seam override (mirrors assetStore.ts's attachAssetAdapterForTests).
 *
 * FAILURE POSTURE (brief A): missing/blank env → `getCloudStorage()` returns
 * `null`, and every route turns that into a clean 503 — never a thrown
 * error, never a boot crash. The app must build and run with NO env vars
 * set (signed-out local editing is the default experience, §7.6) — nothing
 * in this module runs at import time beyond defining functions.
 */

import { AwsClient } from "aws4fetch";

// ---------------------------------------------------------------------------
// The port
// ---------------------------------------------------------------------------

export interface StoredObject {
  bytes: Uint8Array;
  /** Opaque, storage-assigned — used only for conditional-write comparisons
   * (`ifMatch` below), never parsed. */
  etag: string;
  mime: string;
}

export interface ListedObject {
  key: string;
  etag: string;
  size: number;
}

export class CloudStorageError extends Error {
  readonly operation: "GET" | "PUT" | "DELETE" | "LIST";
  readonly status: number | null;
  readonly code: string | null;

  constructor(
    message: string,
    details: {
      operation: "GET" | "PUT" | "DELETE" | "LIST";
      status?: number | null;
      code?: string | null;
    },
  ) {
    super(message);
    this.name = "CloudStorageError";
    this.operation = details.operation;
    this.status = details.status ?? null;
    this.code = details.code ?? null;
  }
}

/** Safe for an authenticated API response: operation + numeric status +
 * R2's short machine code only. Never includes object keys, response bodies,
 * request IDs, credentials, or exception text. */
export function describeCloudStorageFailure(error: unknown): string {
  if (!(error instanceof CloudStorageError)) return "Cloud storage request failed.";
  const details = ["R2", error.operation];
  if (error.status !== null) details.push(String(error.status));
  if (error.code !== null) details.push(error.code);
  return `Cloud storage error (${details.join(" ")}).`;
}

/** The shared "cloud not configured" wording (brief A) — ONE string, so
 * every route's 503 body reads identically instead of five hand-typed
 * copies drifting apart. auth.ts's session-side unconfigured check reuses
 * this same constant. */
export const CLOUD_UNCONFIGURED_MESSAGE = "Cloud sync isn't configured on this server.";

/**
 * The typed error `getCloudStorage()` conceptually represents when env is
 * missing/blank (brief A: "a typed 'cloud not configured' error"). The
 * primary API stays a plain `null` return, not a throw — every call site is
 * a route that immediately turns "not configured" into a 503 response, and
 * a null check reads as directly there as a try/catch would while being one
 * line instead of several. This class exists so that fact is still a named,
 * typed thing (not just a magic `null`) for anything that wants to
 * `instanceof`-check or construct it explicitly, e.g. in a future caller
 * that isn't a route handler.
 */
export class CloudNotConfiguredError extends Error {
  constructor() {
    super(CLOUD_UNCONFIGURED_MESSAGE);
    this.name = "CloudNotConfiguredError";
  }
}

/** Thrown by `putObject` when `ifMatch` was given and the precondition
 * failed — the caller (PUT /api/cloud/project) turns this into a 409, never
 * lets the write land. */
export class CloudConditionalWriteError extends Error {
  constructor() {
    super("Conditional write failed — the object changed underneath this write.");
    this.name = "CloudConditionalWriteError";
  }
}

export interface CloudStorage {
  /** `null` when the key doesn't exist — routes turn that into a 404. */
  getObject(key: string): Promise<StoredObject | null>;
  /**
   * `ifMatch` closes the read-then-write race at the storage layer (§7.6):
   * - `undefined` — unconditional write.
   * - `""` (empty string) — the object must NOT already exist (maps to
   *   `If-None-Match: *`) — the first-ever write of a key.
   * - any other string — the object must currently carry EXACTLY this ETag
   *   (maps to `If-Match`) — every write after the first.
   * Throws `CloudConditionalWriteError` when the precondition fails.
   */
  putObject(
    key: string,
    bytes: Uint8Array,
    mime: string,
    ifMatch?: string,
  ): Promise<{ etag: string }>;
  /** Idempotent — deleting an absent key is success, not an error (matches
   * S3-compatible DELETE semantics; brief C's asset DELETE route relies on
   * this). */
  deleteObject(key: string): Promise<void>;
  /**
   * A time-limited URL the BROWSER can PUT bytes to directly — the routes'
   * whole reason to exist (brief A's "4.5 MB wall": asset bytes must never
   * transit a route handler's body). `size` is SIGNED as the `Content-Length`
   * header (independent security review — the earlier version of this
   * comment claimed exact byte count couldn't be constrained, which was
   * wrong: `Content-Length` sits in the SAME "unsignable by default" set as
   * `Content-Type`, so `allHeaders: true` un-filters it exactly the same
   * way): a browser `fetch()` can't be told to LIE about Content-Length (the
   * platform always sends the body's true computed length), so if the
   * actual upload's byte count differs from `size`, the request's real
   * Content-Length no longer matches what was signed and R2 rejects it as a
   * signature mismatch BEFORE storing anything — closing the "upload more
   * bytes than presigned for" gap directly, not just mitigating it.
   */
  presignPut(key: string, mime: string, size: number, ttlSeconds: number): Promise<string>;
  presignGet(key: string, ttlSeconds: number): Promise<string>;
  list(prefix: string): Promise<ListedObject[]>;
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface R2Config {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
}

/** Reads the four R2 env vars (brief A). A blank string counts as missing —
 * a half-filled `.env` (`R2_BUCKET=`) must configure NOTHING, not a client
 * pointed at an empty bucket name. */
export function loadR2ConfigFromEnv(env: Record<string, string | undefined> = process.env): R2Config | null {
  const accountId = env.R2_ACCOUNT_ID?.trim();
  const accessKeyId = env.R2_ACCESS_KEY_ID?.trim();
  const secretAccessKey = env.R2_SECRET_ACCESS_KEY?.trim();
  const bucket = env.R2_BUCKET?.trim();
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) return null;
  return { accountId, accessKeyId, secretAccessKey, bucket };
}

export interface R2ConfigDiagnostics {
  accountId: boolean;
  accessKeyId: boolean;
  secretAccessKey: boolean;
  bucket: boolean;
}

/**
 * Per-variable presence (TASK 2b, `GET /api/cloud/diagnose`) — unlike
 * `loadR2ConfigFromEnv`'s all-or-nothing `null`, this reports EACH of the
 * four independently so an operator can see exactly which one is still
 * blank instead of a single undifferentiated "not configured." Same
 * blank-counts-as-missing rule as `loadR2ConfigFromEnv`. Never returns a
 * VALUE, only presence — safe for an unauthenticated route (that route's
 * own doc comment has the full reasoning).
 */
export function inspectR2ConfigFromEnv(env: Record<string, string | undefined> = process.env): R2ConfigDiagnostics {
  return {
    accountId: !!env.R2_ACCOUNT_ID?.trim(),
    accessKeyId: !!env.R2_ACCESS_KEY_ID?.trim(),
    secretAccessKey: !!env.R2_SECRET_ACCESS_KEY?.trim(),
    bucket: !!env.R2_BUCKET?.trim(),
  };
}

// ---------------------------------------------------------------------------
// Real R2 implementation (aws4fetch-signed S3 API calls)
// ---------------------------------------------------------------------------

/** Path-style R2 object URL: `https://<account>.r2.cloudflarestorage.com/<bucket>/<key>`.
 * Each path segment is percent-encoded separately so a literal `/` in `key`
 * (our own hierarchy separator — `projects/default/assets/<name>`) stays a
 * path separator rather than becoming `%2F`. */
function objectUrl(config: R2Config, key: string): string {
  const encodedKey = key
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return `https://${config.accountId}.r2.cloudflarestorage.com/${config.bucket}/${encodedKey}`;
}

function bucketUrl(config: R2Config): string {
  return `https://${config.accountId}.r2.cloudflarestorage.com/${config.bucket}`;
}

type R2Operation = CloudStorageError["operation"];

async function r2Fetch(operation: R2Operation, key: string, request: () => Promise<Response>): Promise<Response> {
  try {
    return await request();
  } catch {
    throw new CloudStorageError(`R2 ${operation} ${key} request failed`, {
      operation,
      code: "RequestFailed",
    });
  }
}

/** R2's S3 errors are XML. Keep only the bounded machine-readable `<Code>`
 * token; the rest can contain request IDs and provider detail that has no
 * place in an API response. */
async function r2ErrorCode(res: Response): Promise<string | null> {
  try {
    const text = await res.text();
    const code = /<Code>([A-Za-z0-9_-]{1,80})<\/Code>/.exec(text)?.[1];
    return code ?? null;
  } catch {
    return null;
  }
}

async function storageResponseError(operation: R2Operation, key: string, res: Response): Promise<CloudStorageError> {
  const code = await r2ErrorCode(res);
  return new CloudStorageError(`R2 ${operation} ${key} failed: ${res.status}${code ? ` ${code}` : ""}`, {
    operation,
    status: res.status,
    code,
  });
}

/**
 * Minimal ListObjectsV2 XML → the fields this port needs. NOT a general XML
 * parser — R2/S3's list response is a flat, well-known shape (repeated
 * `<Contents>` blocks), so a small tag-scoped extraction is enough and
 * avoids a second dependency (the brief allows exactly one: aws4fetch).
 * Exported for a direct unit test against a hand-written XML fixture (no
 * network needed to exercise the parsing itself).
 */
export function parseListObjectsXml(xml: string): ListedObject[] {
  const objects: ListedObject[] = [];
  const contentsRe = /<Contents>([\s\S]*?)<\/Contents>/g;
  let match: RegExpExecArray | null;
  while ((match = contentsRe.exec(xml)) !== null) {
    const block = match[1];
    const key = /<Key>([\s\S]*?)<\/Key>/.exec(block)?.[1];
    if (key === undefined) continue;
    const etag = /<ETag>([\s\S]*?)<\/ETag>/.exec(block)?.[1] ?? "";
    const sizeText = /<Size>([\s\S]*?)<\/Size>/.exec(block)?.[1] ?? "0";
    objects.push({
      key: decodeXmlEntities(key),
      etag: decodeXmlEntities(etag).replace(/"/g, ""),
      size: Number(sizeText) || 0,
    });
  }
  return objects;
}

/** Order matters: `&amp;` LAST, or an original literal `&amp;lt;` (i.e. the
 * literal text `&lt;`) would double-decode into `<` instead of `&lt;`. */
function decodeXmlEntities(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

/**
 * The real implementation: every method is an aws4fetch-signed request
 * straight to R2's S3-compatible API. `getObject`/`putObject`/`deleteObject`/
 * `list` sign with the default Authorization-HEADER flow (server → R2,
 * trusted, no size constraint worth avoiding); `presignPut`/`presignGet`
 * build query-string-signed URLs the BROWSER uses directly (brief A).
 */
export function createR2Storage(config: R2Config): CloudStorage {
  const client = new AwsClient({
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    service: "s3",
    region: "auto",
  });

  return {
    async getObject(key) {
      const res = await r2Fetch("GET", key, () => client.fetch(objectUrl(config, key), { method: "GET" }));
      if (res.status === 404) {
        const code = await r2ErrorCode(res);
        // R2 normally answers an absent object with NoSuchKey. A blank 404
        // is tolerated for compatibility, but NoSuchBucket must not masquerade
        // as "this project has never synced" and trigger a doomed first PUT.
        if (code === null || code === "NoSuchKey") return null;
        throw new CloudStorageError(`R2 GET ${key} failed: 404 ${code}`, {
          operation: "GET",
          status: 404,
          code,
        });
      }
      if (!res.ok) throw await storageResponseError("GET", key, res);
      const bytes = new Uint8Array(await res.arrayBuffer());
      return {
        bytes,
        etag: res.headers.get("etag") ?? "",
        mime: res.headers.get("content-type") ?? "application/octet-stream",
      };
    },

    async putObject(key, bytes, mime, ifMatch) {
      const headers: Record<string, string> = {
        "content-type": mime,
        // R2's S3 PutObject requires Content-Length. Do not rely on a
        // particular serverless fetch runtime to infer it from Uint8Array.
        "content-length": String(bytes.byteLength),
      };
      if (ifMatch === "") headers["if-none-match"] = "*";
      else if (ifMatch !== undefined) headers["if-match"] = ifMatch;
      const res = await r2Fetch("PUT", key, () =>
        client.fetch(objectUrl(config, key), {
          method: "PUT",
          headers,
          body: bytes as BodyInit,
        }),
      );
      if (res.status === 412 || res.status === 409) throw new CloudConditionalWriteError();
      if (!res.ok) throw await storageResponseError("PUT", key, res);
      return { etag: res.headers.get("etag") ?? "" };
    },

    async deleteObject(key) {
      const res = await r2Fetch("DELETE", key, () => client.fetch(objectUrl(config, key), { method: "DELETE" }));
      // Idempotent (interface doc): a 404 here still counts as "deleted".
      if (!res.ok && res.status !== 404) {
        throw await storageResponseError("DELETE", key, res);
      }
    },

    async presignPut(key, mime, size, ttlSeconds) {
      const url = new URL(objectUrl(config, key));
      url.searchParams.set("X-Amz-Expires", String(ttlSeconds));
      // `allHeaders: true` so `content-type`/`content-length` (normally
      // excluded from signing — see aws4fetch's UNSIGNABLE_HEADERS) are
      // part of the signed set: the actual browser PUT then MUST send the
      // same Content-Type AND the same body length it was presigned for.
      // Content-Type a page could lie about (it's allowed to set it);
      // Content-Length it fundamentally can't (`fetch()` always sends the
      // body's true computed length, never a JS-supplied override) — so
      // signing it is what turns "declared size" into an ENFORCED one (see
      // the interface doc comment on `presignPut`).
      const signed = await client.sign(url.toString(), {
        method: "PUT",
        aws: { signQuery: true, allHeaders: true },
        headers: { "content-type": mime, "content-length": String(size) },
      });
      return signed.url;
    },

    async presignGet(key, ttlSeconds) {
      const url = new URL(objectUrl(config, key));
      url.searchParams.set("X-Amz-Expires", String(ttlSeconds));
      const signed = await client.sign(url.toString(), {
        method: "GET",
        aws: { signQuery: true },
      });
      return signed.url;
    },

    async list(prefix) {
      const url = new URL(bucketUrl(config));
      url.searchParams.set("list-type", "2");
      url.searchParams.set("prefix", prefix);
      const res = await r2Fetch("LIST", prefix, () => client.fetch(url.toString(), { method: "GET" }));
      if (!res.ok) throw await storageResponseError("LIST", prefix, res);
      return parseListObjectsXml(await res.text());
    },
  };
}

// ---------------------------------------------------------------------------
// In-memory fake (mirrors assetStore.ts's createInMemoryAssetAdapter)
// ---------------------------------------------------------------------------

/**
 * What every route test injects instead of a real R2 client. ETags are a
 * monotonic counter per write — enough to exercise the conditional-write
 * CONTRACT (matches / doesn't match / must-not-exist) without reimplementing
 * S3's actual ETag algorithm, which nothing here depends on being real.
 */
export function createInMemoryCloudStorage(
  seed: Record<string, { bytes: Uint8Array; mime: string }> = {},
): CloudStorage {
  const table = new Map<string, { bytes: Uint8Array; mime: string; etag: string }>();
  let counter = 0;
  for (const [key, value] of Object.entries(seed)) {
    table.set(key, { ...value, etag: `etag-${++counter}` });
  }

  return {
    async getObject(key) {
      const found = table.get(key);
      return found ? { bytes: found.bytes, etag: found.etag, mime: found.mime } : null;
    },

    async putObject(key, bytes, mime, ifMatch) {
      const existing = table.get(key);
      if (ifMatch === "" && existing !== undefined) throw new CloudConditionalWriteError();
      if (ifMatch !== undefined && ifMatch !== "" && existing?.etag !== ifMatch) {
        throw new CloudConditionalWriteError();
      }
      const etag = `etag-${++counter}`;
      table.set(key, { bytes, mime, etag });
      return { etag };
    },

    async deleteObject(key) {
      table.delete(key);
    },

    async presignPut(key, mime, size, ttlSeconds) {
      return `https://fake-r2.test/${encodeURIComponent(key)}?mode=put&mime=${encodeURIComponent(mime)}&size=${size}&ttl=${ttlSeconds}`;
    },

    async presignGet(key, ttlSeconds) {
      return `https://fake-r2.test/${encodeURIComponent(key)}?mode=get&ttl=${ttlSeconds}`;
    },

    async list(prefix) {
      return [...table.entries()]
        .filter(([key]) => key.startsWith(prefix))
        .map(([key, value]) => ({ key, etag: value.etag, size: value.bytes.byteLength }));
    },
  };
}

// ---------------------------------------------------------------------------
// Singleton (test-seam override, mirrors assetStore.ts)
// ---------------------------------------------------------------------------

let override: CloudStorage | null | undefined;

/** Test seam: force `getCloudStorage()` to return a specific storage (or
 * `null`, simulating "not configured") regardless of env vars. */
export function setCloudStorageForTests(storage: CloudStorage | null): void {
  override = storage;
}

/** Test seam: stop overriding — `getCloudStorage()` reads env again. */
export function resetCloudStorageForTests(): void {
  override = undefined;
}

/**
 * Every route's ONE way to reach storage. `null` means "cloud not
 * configured" — routes turn that into a 503 (brief A), never a thrown error.
 * Reads env FRESH on every call (no module-load-time caching): a serverless
 * cold start always sees the CURRENT env this way, and tests can change
 * `process.env` between cases without a stale client surviving it.
 */
export function getCloudStorage(env: Record<string, string | undefined> = process.env): CloudStorage | null {
  if (override !== undefined) return override;
  const config = loadR2ConfigFromEnv(env);
  if (config === null) return null;
  return createR2Storage(config);
}
