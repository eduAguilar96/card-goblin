/**
 * r2.ts's storage port (DESIGN.md §7.6): config loading (missing/blank →
 * null, brief A's "cloud not configured" posture), the in-memory fake's
 * conditional-write contract (the same one PUT /api/cloud/project's
 * revision guard depends on), and the minimal ListObjectsV2 XML parser —
 * all headless, no real R2/network involved.
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  CLOUD_UNCONFIGURED_MESSAGE,
  CloudConditionalWriteError,
  CloudNotConfiguredError,
  createInMemoryCloudStorage,
  createR2Storage,
  getCloudStorage,
  loadR2ConfigFromEnv,
  parseListObjectsXml,
  resetCloudStorageForTests,
  setCloudStorageForTests,
} from "../r2";

afterEach(() => {
  resetCloudStorageForTests();
});

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

describe("loadR2ConfigFromEnv", () => {
  const FULL = {
    R2_ACCOUNT_ID: "acct",
    R2_ACCESS_KEY_ID: "key",
    R2_SECRET_ACCESS_KEY: "secret",
    R2_BUCKET: "bucket",
  };

  it("all four present: a config", () => {
    expect(loadR2ConfigFromEnv(FULL)).toEqual({
      accountId: "acct",
      accessKeyId: "key",
      secretAccessKey: "secret",
      bucket: "bucket",
    });
  });

  it("no env at all: null (the default, unconfigured, experience)", () => {
    expect(loadR2ConfigFromEnv({})).toBeNull();
  });

  for (const missing of Object.keys(FULL) as (keyof typeof FULL)[]) {
    it(`missing just ${missing}: null`, () => {
      const env = { ...FULL, [missing]: undefined };
      expect(loadR2ConfigFromEnv(env)).toBeNull();
    });

    it(`${missing} blank/whitespace-only: null (a half-filled .env must not partially configure)`, () => {
      const env = { ...FULL, [missing]: "   " };
      expect(loadR2ConfigFromEnv(env)).toBeNull();
    });
  }
});

describe("CloudNotConfiguredError (brief A: 'a typed cloud not configured error')", () => {
  it("is a real Error subclass, named, carrying the shared message routes 503 with", () => {
    const err = new CloudNotConfiguredError();
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("CloudNotConfiguredError");
    expect(err.message).toBe(CLOUD_UNCONFIGURED_MESSAGE);
  });
});

// ---------------------------------------------------------------------------
// In-memory fake — the conditional-write CONTRACT (brief C's revision guard
// depends on exactly this: undefined = unconditional, "" = must-not-exist,
// a specific etag = must-match)
// ---------------------------------------------------------------------------

describe("createInMemoryCloudStorage", () => {
  it("getObject on an absent key is null", async () => {
    const storage = createInMemoryCloudStorage();
    expect(await storage.getObject("nope")).toBeNull();
  });

  it("put then get round-trips bytes/mime, with a fresh etag", async () => {
    const storage = createInMemoryCloudStorage();
    const { etag } = await storage.putObject("k", new Uint8Array([1, 2, 3]), "application/json");
    const stored = await storage.getObject("k");
    expect(stored).toEqual({ bytes: new Uint8Array([1, 2, 3]), etag, mime: "application/json" });
  });

  it('ifMatch="" (must-not-exist): succeeds on a fresh key, throws on an existing one', async () => {
    const storage = createInMemoryCloudStorage();
    await expect(storage.putObject("k", new Uint8Array([1]), "text/plain", "")).resolves.toBeDefined();
    await expect(storage.putObject("k", new Uint8Array([2]), "text/plain", "")).rejects.toBeInstanceOf(
      CloudConditionalWriteError,
    );
  });

  it("ifMatch=<etag>: succeeds when it matches the CURRENT etag, throws when it doesn't", async () => {
    const storage = createInMemoryCloudStorage();
    const { etag: etag1 } = await storage.putObject("k", new Uint8Array([1]), "text/plain");
    const { etag: etag2 } = await storage.putObject("k", new Uint8Array([2]), "text/plain", etag1);
    expect(etag2).not.toBe(etag1); // every write mints a new etag
    // Now etag1 is STALE — a write conditioned on it must lose the race.
    await expect(
      storage.putObject("k", new Uint8Array([3]), "text/plain", etag1),
    ).rejects.toBeInstanceOf(CloudConditionalWriteError);
    // The CURRENT etag still works.
    await expect(
      storage.putObject("k", new Uint8Array([3]), "text/plain", etag2),
    ).resolves.toBeDefined();
  });

  it("ifMatch=<etag> against a key that doesn't exist at all: throws (nothing to match)", async () => {
    const storage = createInMemoryCloudStorage();
    await expect(
      storage.putObject("k", new Uint8Array([1]), "text/plain", "some-etag-that-cant-exist"),
    ).rejects.toBeInstanceOf(CloudConditionalWriteError);
  });

  it("ifMatch=undefined: always unconditional, even over an existing object", async () => {
    const storage = createInMemoryCloudStorage();
    await storage.putObject("k", new Uint8Array([1]), "text/plain");
    await expect(storage.putObject("k", new Uint8Array([2]), "text/plain")).resolves.toBeDefined();
    expect((await storage.getObject("k"))?.bytes).toEqual(new Uint8Array([2]));
  });

  it("delete is idempotent — deleting an absent key never throws", async () => {
    const storage = createInMemoryCloudStorage();
    await expect(storage.deleteObject("never-existed")).resolves.toBeUndefined();
    await storage.putObject("k", new Uint8Array([1]), "text/plain");
    await storage.deleteObject("k");
    await expect(storage.deleteObject("k")).resolves.toBeUndefined(); // twice
    expect(await storage.getObject("k")).toBeNull();
  });

  it("list(prefix) returns only matching keys, with size/etag", async () => {
    const storage = createInMemoryCloudStorage();
    await storage.putObject("projects/default/assets/dragon", new Uint8Array([1, 2]), "image/png");
    await storage.putObject("projects/default/assets/imp", new Uint8Array([1, 2, 3]), "image/png");
    await storage.putObject("projects/default/project.json", new Uint8Array([1]), "application/json");
    const assets = await storage.list("projects/default/assets/");
    expect(assets.map((o) => o.key).sort()).toEqual([
      "projects/default/assets/dragon",
      "projects/default/assets/imp",
    ]);
    expect(assets.find((o) => o.key.endsWith("imp"))?.size).toBe(3);
  });

  it("presignPut/presignGet resolve to SOME url (shape only — real signing is r2.ts's job, not the fake's)", async () => {
    const storage = createInMemoryCloudStorage();
    await expect(storage.presignPut("k", "image/png", 1234, 60)).resolves.toContain("k");
    await expect(storage.presignGet("k", 60)).resolves.toContain("k");
  });

  it("seeded storage is independent per-instance (no shared module state)", async () => {
    const a = createInMemoryCloudStorage({ shared: { bytes: new Uint8Array([9]), mime: "text/plain" } });
    const b = createInMemoryCloudStorage();
    expect(await a.getObject("shared")).not.toBeNull();
    expect(await b.getObject("shared")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// parseListObjectsXml
// ---------------------------------------------------------------------------

describe("parseListObjectsXml", () => {
  it("extracts Key/ETag/Size from a well-formed ListObjectsV2 response", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<ListBucketResult>
  <Contents>
    <Key>projects/default/assets/dragon</Key>
    <ETag>"abc123"</ETag>
    <Size>4096</Size>
  </Contents>
  <Contents>
    <Key>projects/default/assets/imp</Key>
    <ETag>"def456"</ETag>
    <Size>2048</Size>
  </Contents>
</ListBucketResult>`;
    expect(parseListObjectsXml(xml)).toEqual([
      { key: "projects/default/assets/dragon", etag: "abc123", size: 4096 },
      { key: "projects/default/assets/imp", etag: "def456", size: 2048 },
    ]);
  });

  it("an empty result (no <Contents>) parses to an empty array, not a throw", () => {
    expect(parseListObjectsXml("<ListBucketResult></ListBucketResult>")).toEqual([]);
    expect(parseListObjectsXml("")).toEqual([]);
    expect(parseListObjectsXml("not even xml")).toEqual([]);
  });

  it("decodes XML entities in keys, &amp; LAST so a literal '&lt;' round-trips correctly", () => {
    const xml = `<Contents><Key>a&amp;lt;b&amp;gt;c</Key><ETag>"x"</ETag><Size>1</Size></Contents>`;
    // The ORIGINAL key (before XML-encoding) was `a&lt;b&gt;c` — a literal
    // string containing "&lt;"/"&gt;" as TEXT, not as markup. Decoding
    // &amp; too early would corrupt it into `a<b>c`.
    expect(parseListObjectsXml(xml)[0].key).toBe("a&lt;b&gt;c");
  });

  it("a Contents block missing <Key> is skipped rather than producing a garbage entry", () => {
    const xml = `<Contents><ETag>"x"</ETag><Size>1</Size></Contents>`;
    expect(parseListObjectsXml(xml)).toEqual([]);
  });

  it("missing <Size>/<ETag> default to 0/empty rather than throwing", () => {
    const xml = `<Contents><Key>k</Key></Contents>`;
    expect(parseListObjectsXml(xml)).toEqual([{ key: "k", etag: "", size: 0 }]);
  });
});

// ---------------------------------------------------------------------------
// createR2Storage's REAL presigning (L4, independent security review: these
// guards were previously untested — dropping `allHeaders` or either
// `X-Amz-Expires` line left every one of this project's tests green, and
// aws4fetch's own default TTL without an explicit X-Amz-Expires is 86400 s
// (288× longer than the 300 s this app actually wants). Fake credentials —
// `sign()` is pure computation, no network call, so this needs no live R2.
// ---------------------------------------------------------------------------

describe("createR2Storage — presigned URL signing (L4)", () => {
  const config = { accountId: "acct", accessKeyId: "AKIAFAKE", secretAccessKey: "fakesecret", bucket: "bucket" };

  it("presignPut: X-Amz-Expires matches the requested TTL exactly (not aws4fetch's 86400 s default)", async () => {
    const storage = createR2Storage(config);
    const url = new URL(await storage.presignPut("projects/default/assets/dragon", "image/png", 1234, 300));
    expect(url.searchParams.get("X-Amz-Expires")).toBe("300");
  });

  it("presignPut: SignedHeaders is EXACTLY content-length;content-type;host — content-length really is signed", () => {
    return createR2Storage(config)
      .presignPut("projects/default/assets/dragon", "image/png", 1234, 300)
      .then((url) => {
        const signedHeaders = new URL(url).searchParams.get("X-Amz-SignedHeaders");
        expect(signedHeaders).toBe("content-length;content-type;host");
      });
  });

  it("presignPut: a DIFFERENT TTL is reflected exactly (not hardcoded)", async () => {
    const storage = createR2Storage(config);
    const url = new URL(await storage.presignPut("k", "image/png", 10, 60));
    expect(url.searchParams.get("X-Amz-Expires")).toBe("60");
  });

  it("presignGet: X-Amz-Expires matches the requested TTL, SignedHeaders is just host (no body to constrain)", async () => {
    const storage = createR2Storage(config);
    const url = new URL(await storage.presignGet("projects/default/project.json", 300));
    expect(url.searchParams.get("X-Amz-Expires")).toBe("300");
    expect(url.searchParams.get("X-Amz-SignedHeaders")).toBe("host");
  });

  it("the presigned URL targets the exact configured account/bucket/key, method-appropriate", async () => {
    const storage = createR2Storage(config);
    const putUrl = new URL(await storage.presignPut("projects/default/assets/dragon", "image/png", 1, 300));
    expect(putUrl.hostname).toBe("acct.r2.cloudflarestorage.com");
    expect(putUrl.pathname).toBe("/bucket/projects/default/assets/dragon");
    expect(putUrl.searchParams.get("X-Amz-Credential")).toContain("AKIAFAKE");
  });
});

// ---------------------------------------------------------------------------
// getCloudStorage — the singleton every route calls (brief A)
// ---------------------------------------------------------------------------

describe("getCloudStorage", () => {
  it("no env: null (503 territory) — the default, no-crash experience", () => {
    expect(getCloudStorage({})).toBeNull();
  });

  it("full env: a real (non-null) CloudStorage", () => {
    const storage = getCloudStorage({
      R2_ACCOUNT_ID: "a",
      R2_ACCESS_KEY_ID: "b",
      R2_SECRET_ACCESS_KEY: "c",
      R2_BUCKET: "d",
    });
    expect(storage).not.toBeNull();
    expect(typeof storage?.getObject).toBe("function");
  });

  it("setCloudStorageForTests overrides env entirely, including to null", () => {
    const fake = createInMemoryCloudStorage();
    setCloudStorageForTests(fake);
    expect(getCloudStorage({ R2_ACCOUNT_ID: "a", R2_ACCESS_KEY_ID: "b", R2_SECRET_ACCESS_KEY: "c", R2_BUCKET: "d" })).toBe(
      fake,
    );
    setCloudStorageForTests(null);
    expect(getCloudStorage({ R2_ACCOUNT_ID: "a", R2_ACCESS_KEY_ID: "b", R2_SECRET_ACCESS_KEY: "c", R2_BUCKET: "d" })).toBeNull();
  });

  it("resetCloudStorageForTests goes back to reading env", () => {
    setCloudStorageForTests(createInMemoryCloudStorage());
    resetCloudStorageForTests();
    expect(getCloudStorage({})).toBeNull();
  });
});
