/**
 * projectPayload.ts's validation (DESIGN.md §7.6) — headless, no HTTP. Was
 * previously exercised only indirectly through routes.test.ts's PUT
 * payload-validation cases; this file tests the module's own exports
 * directly, including the cloud-specific mime/name allowlists and hash
 * normalization added after an independent security review (L1/L2/L13).
 */
import { describe, expect, it } from "vitest";
import {
  MAX_CLOUD_ASSET_NAME_LENGTH,
  isSupportedCloudImageMime,
  isValidCloudAssetName,
  parseCloudProject,
  parseStoredCloudProjectJson,
  serializeStoredCloudProject,
} from "../projectPayload";

describe("isSupportedCloudImageMime (L1: a strict allowlist, not startsWith)", () => {
  it("accepts the allowlisted raster formats", () => {
    for (const mime of ["image/png", "image/jpeg", "image/gif", "image/webp", "image/avif"]) {
      expect(isSupportedCloudImageMime(mime)).toBe(true);
    }
  });

  it("rejects SVG (XML — can carry embedded scripts)", () => {
    expect(isSupportedCloudImageMime("image/svg+xml")).toBe(false);
  });

  it("rejects a bare 'image/' and a nonsense 'image/*' subtype", () => {
    expect(isSupportedCloudImageMime("image/")).toBe(false);
    expect(isSupportedCloudImageMime("image/html")).toBe(false);
    expect(isSupportedCloudImageMime("image/x-icon")).toBe(false);
  });

  it("rejects a mime with a trailing parameter, even for an otherwise-allowed subtype", () => {
    expect(isSupportedCloudImageMime("image/png; charset=x")).toBe(false);
    expect(isSupportedCloudImageMime("image/png;charset=utf-8")).toBe(false);
  });

  it("rejects non-image types entirely", () => {
    expect(isSupportedCloudImageMime("text/html")).toBe(false);
    expect(isSupportedCloudImageMime("application/octet-stream")).toBe(false);
  });

  it("is case-sensitive to the exact registered mime string (no silent normalization)", () => {
    expect(isSupportedCloudImageMime("image/PNG")).toBe(false);
    expect(isSupportedCloudImageMime("Image/png")).toBe(false);
  });
});

describe("isValidCloudAssetName (L2: adds a length cap on top of isValidAssetName)", () => {
  it("accepts ordinary short names", () => {
    expect(isValidCloudAssetName("dragon_art")).toBe(true);
    expect(isValidCloudAssetName("a")).toBe(true);
  });

  it("rejects invalid characters (delegates to the existing identifier rule)", () => {
    expect(isValidCloudAssetName("2starts-with-digit")).toBe(false);
    expect(isValidCloudAssetName("has space")).toBe(false);
    expect(isValidCloudAssetName("")).toBe(false);
  });

  it(`accepts a name at exactly the ${MAX_CLOUD_ASSET_NAME_LENGTH}-char cap`, () => {
    const atCap = "a".repeat(MAX_CLOUD_ASSET_NAME_LENGTH);
    expect(atCap.length).toBe(MAX_CLOUD_ASSET_NAME_LENGTH);
    expect(isValidCloudAssetName(atCap)).toBe(true);
  });

  it("rejects a name one character over the cap", () => {
    const overCap = "a".repeat(MAX_CLOUD_ASSET_NAME_LENGTH + 1);
    expect(isValidCloudAssetName(overCap)).toBe(false);
  });

  it("rejects an absurdly long name (the R2 key-length risk L2 found: 5000 chars 'presigned fine')", () => {
    expect(isValidCloudAssetName("a".repeat(5000))).toBe(false);
  });
});

describe("parseCloudProject", () => {
  const VALID = { code: "Sheet: S\n  column a: Text\n", sheets: {}, assets: [] };

  it("accepts a minimal valid payload", () => {
    expect(parseCloudProject(VALID)).toEqual({ code: VALID.code, sheets: {}, assets: [] });
  });

  it("rejects a non-record payload", () => {
    expect(parseCloudProject(null)).toBeNull();
    expect(parseCloudProject("a string")).toBeNull();
    expect(parseCloudProject([1, 2, 3])).toBeNull();
  });

  it("rejects non-string code", () => {
    expect(parseCloudProject({ ...VALID, code: 5 })).toBeNull();
  });

  it("rejects malformed sheets (reuses parseSheetsPayload's own strictness)", () => {
    expect(parseCloudProject({ ...VALID, sheets: { S: { rows: "nope", editedRows: [] } } })).toBeNull();
  });

  describe("asset manifest entries", () => {
    const baseEntry = { name: "dragon", mime: "image/png", size: 100, hash: "abcd1234" };

    it("accepts a well-formed entry", () => {
      const result = parseCloudProject({ ...VALID, assets: [baseEntry] });
      expect(result?.assets).toEqual([baseEntry]);
    });

    it("rejects an unsupported mime (L1) even though it's a valid image/* string", () => {
      expect(parseCloudProject({ ...VALID, assets: [{ ...baseEntry, mime: "image/svg+xml" }] })).toBeNull();
    });

    it("rejects a too-long name (L2)", () => {
      const longName = "a".repeat(MAX_CLOUD_ASSET_NAME_LENGTH + 1);
      expect(parseCloudProject({ ...VALID, assets: [{ ...baseEntry, name: longName }] })).toBeNull();
    });

    it("normalizes an uppercase-hex hash to lowercase (L13)", () => {
      const result = parseCloudProject({ ...VALID, assets: [{ ...baseEntry, hash: "ABCD1234" }] });
      expect(result?.assets[0].hash).toBe("abcd1234");
    });

    it("normalizes a MIXED-case hash to lowercase too", () => {
      const result = parseCloudProject({ ...VALID, assets: [{ ...baseEntry, hash: "aBcD1234" }] });
      expect(result?.assets[0].hash).toBe("abcd1234");
    });

    it("rejects a non-hex hash", () => {
      expect(parseCloudProject({ ...VALID, assets: [{ ...baseEntry, hash: "not-hex!" }] })).toBeNull();
    });

    it("rejects a duplicate name", () => {
      expect(parseCloudProject({ ...VALID, assets: [baseEntry, baseEntry] })).toBeNull();
    });

    it("rejects a size over the 2 MB cap", () => {
      expect(
        parseCloudProject({ ...VALID, assets: [{ ...baseEntry, size: 3 * 1024 * 1024 }] }),
      ).toBeNull();
    });
  });
});

describe("parseStoredCloudProjectJson / serializeStoredCloudProject", () => {
  it("round-trips a full stored project", () => {
    const stored = {
      revision: 7,
      code: "Sheet: S\n  column a: Text\n",
      sheets: { S: { rows: [{ a: "1" }], editedRows: [true] } },
      assets: [{ name: "dragon", mime: "image/png", size: 10, hash: "abcd1234" }],
    };
    const bytes = serializeStoredCloudProject(stored);
    expect(parseStoredCloudProjectJson(bytes)).toEqual(stored);
  });

  it("null on unparsable JSON bytes", () => {
    expect(parseStoredCloudProjectJson(new TextEncoder().encode("{not json"))).toBeNull();
  });

  it("null when revision is missing or not an integer", () => {
    expect(
      parseStoredCloudProjectJson(new TextEncoder().encode(JSON.stringify({ code: "", sheets: {}, assets: [] }))),
    ).toBeNull();
    expect(
      parseStoredCloudProjectJson(
        new TextEncoder().encode(JSON.stringify({ revision: 1.5, code: "", sheets: {}, assets: [] })),
      ),
    ).toBeNull();
  });
});
