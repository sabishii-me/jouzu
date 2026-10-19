import { describe, expect, it, vi } from "vitest";
import { MAX_IMAGE_BYTES, MAX_TOTAL_IMAGE_BYTES, readImageAttachment, removeSubmittedImages, validateImageBytes, validateImageSelection, type ImageAttachment } from "./chat-attachments";

const signatures = [
  ["image/png", [137, 80, 78, 71, 13, 10, 26, 10]],
  ["image/jpeg", [255, 216, 255]],
  ["image/gif", [71, 73, 70, 56, 55, 97]],
  ["image/gif", [71, 73, 70, 56, 57, 97]],
  ["image/webp", [82, 73, 70, 70, 0, 0, 0, 0, 87, 69, 66, 80]],
] as const;
describe("image attachments", () => {
  it("uses mainstream per-image and total limits", () => {
    expect(MAX_IMAGE_BYTES).toBeGreaterThan(1024 * 1024);
    expect(MAX_TOTAL_IMAGE_BYTES).toBeGreaterThanOrEqual(MAX_IMAGE_BYTES);
  });
  it("accepts only the supported signatures and matching MIME", () => {
    for (const [mime, signature] of signatures) {
      expect(validateImageBytes(new Uint8Array(signature), mime)).toBe(mime);
      expect(() => validateImageBytes(new Uint8Array(signature.slice(0, -1)), mime)).toThrow();
      expect(() => validateImageBytes(new Uint8Array(signature), "text/plain")).toThrow();
    }
    expect(() => validateImageBytes(new Uint8Array(signatures[0][1]), "image/jpeg")).toThrow();
    expect(() => validateImageBytes(new Uint8Array([60, 115, 118, 103]), "image/png")).toThrow();
  });
  it("enforces combined raw byte and count limits including existing images", () => {
    const file = { type: "image/png", size: MAX_IMAGE_BYTES };
    expect(() => validateImageSelection([], [file])).not.toThrow();
    expect(() => validateImageSelection([{ size: MAX_TOTAL_IMAGE_BYTES }], [file])).toThrow(/20 MB/);
    expect(() => validateImageSelection([], Array(4).fill({ ...file, size: 1 }))).not.toThrow();
    expect(() => validateImageSelection([{ size: 1 }], Array(4).fill({ ...file, size: 1 }))).toThrow(/4 images/);
    for (const size of [0, -1, NaN, Infinity, 1.5]) expect(() => validateImageSelection([], [{ ...file, size }])).toThrow();
    expect(() => validateImageSelection([], [{ type: "image/svg+xml", size: 1 }])).toThrow(/only/);
    const large = new Uint8Array(MAX_IMAGE_BYTES + 1); large.set(signatures[0][1]);
    expect(() => validateImageBytes(large, "image/png")).toThrow();
  });
  it("removes only accepted submission identities, preserving later additions", () => {
    const attachment = (id: string): ImageAttachment => ({ id, name: "same.png", size: 8, image: { type: "image", data: "", mimeType: "image/png" } });
    const old = attachment("old"); const added = attachment("added");
    expect(removeSubmittedImages([old, added], [old])).toEqual([added]);
    expect(removeSubmittedImages([added], [old])).toEqual([added]);
  });
  it("reads asynchronously and emits raw base64, not a data URL", async () => {
    const bytes = new Uint8Array(signatures[0][1]);
    class Reader {
      result: ArrayBuffer | null = null;
      onload?: () => void;
      readAsArrayBuffer() { queueMicrotask(() => { this.result = bytes.buffer; this.onload?.(); }); }
    }
    vi.stubGlobal("FileReader", Reader);
    try {
      const result = await readImageAttachment({ name: "photo.png", type: "image/png", size: bytes.length } as File);
      expect(result.image).toEqual({ type: "image", data: "iVBORw0KGgo=", mimeType: "image/png" });
      expect(result.name).toBe("photo.png");
    } finally { vi.unstubAllGlobals(); }
  });
  it("rejects unreadable and mismatched files", async () => {
    class Reader {
      result = new Uint8Array([1, 2, 3]).buffer;
      onload?: () => void;
      readAsArrayBuffer() { queueMicrotask(() => this.onload?.()); }
    }
    vi.stubGlobal("FileReader", Reader);
    try {
      await expect(readImageAttachment({ name: "fake.png", type: "image/png", size: 3 } as File)).rejects.toThrow(/contents/);
      await expect(readImageAttachment({ name: "changed.png", type: "image/png", size: 8 } as File)).rejects.toThrow(/size changed/);
    } finally { vi.unstubAllGlobals(); }
  });
});
