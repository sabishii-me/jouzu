import type { ChatImage } from "./chat-connection";

export const IMAGE_ACCEPT = "image/png,image/jpeg,image/webp,image/gif";
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_TOTAL_IMAGE_BYTES = 20 * 1024 * 1024;
export const MAX_IMAGES = 4;
export interface ImageAttachment { id: string; name: string; size: number; image: ChatImage }
type ImageFile = { type: string; size: number };

export function validateImageSelection(existing: readonly { size: number }[], files: readonly ImageFile[]) {
  if (existing.length + files.length > MAX_IMAGES) throw new Error("Attach at most 4 images.");
  for (const file of files) {
    if (!IMAGE_ACCEPT.split(",").includes(file.type)) throw new Error("Choose PNG, JPEG, WebP, or GIF images only.");
    if (!Number.isSafeInteger(file.size) || file.size <= 0) throw new Error("Images must not be empty.");
  }
  if ([...existing, ...files].reduce((total, file) => total + file.size, 0) > MAX_TOTAL_IMAGE_BYTES) {
    throw new Error("Images must total 20 MB or less.");
  }
}

// Check file signatures independently of filename and browser-provided MIME type.
// This is a format guard, not a full image decoder.
export function validateImageBytes(bytes: Uint8Array, mimeType: string): ChatImage["mimeType"] {
  const starts = (signature: number[], offset = 0) => signature.every((value, index) => bytes[offset + index] === value);
  const valid = mimeType === "image/png" ? starts([137, 80, 78, 71, 13, 10, 26, 10])
    : mimeType === "image/jpeg" ? starts([255, 216, 255])
    : mimeType === "image/gif" ? starts([71, 73, 70, 56, 55, 97]) || starts([71, 73, 70, 56, 57, 97])
    : mimeType === "image/webp" ? starts([82, 73, 70, 70]) && bytes.length >= 12 && starts([87, 69, 66, 80], 8)
    : false;
  if (!valid || bytes.length > MAX_IMAGE_BYTES) throw new Error("Image contents do not match a supported image type or exceed 10 MB.");
  return mimeType as ChatImage["mimeType"];
}

export function readImageAttachment(file: File): Promise<ImageAttachment> {
  validateImageSelection([], [file]);
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`Could not read ${file.name}.`));
    reader.onabort = () => reject(new Error(`Reading ${file.name} was cancelled.`));
    reader.onload = () => {
      try {
        if (!(reader.result instanceof ArrayBuffer)) throw new Error("Could not read image bytes.");
        const bytes = new Uint8Array(reader.result);
        if (bytes.length !== file.size) throw new Error("Image size changed while reading.");
        const mimeType = validateImageBytes(bytes, file.type);
        let binary = "";
        for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
        resolve({ id: crypto.randomUUID(), name: file.name, size: bytes.length, image: { type: "image", data: btoa(binary), mimeType } });
      } catch (error) { reject(error); }
    };
    reader.readAsArrayBuffer(file);
  });
}

export function removeSubmittedImages(current: readonly ImageAttachment[], submitted: readonly ImageAttachment[]) {
  const ids = new Set(submitted.map(image => image.id));
  return current.filter(image => !ids.has(image.id));
}
