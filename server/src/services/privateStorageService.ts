import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { config } from "../config.js";

const objectKeyPattern = /^[a-f0-9]{64}$/;

function encryptionKey(): Buffer | undefined {
  const configured = config.REQUEST_DATA_ENCRYPTION_KEY;
  if (!configured) return undefined;
  return configured.length === 64 ? Buffer.from(configured, "hex") : Buffer.from(configured, "base64");
}

function objectPath(key: string): string {
  if (!objectKeyPattern.test(key)) throw new Error("Invalid private object key.");
  return path.join(config.PRIVATE_STORAGE_DIR, key);
}

export async function savePrivateObject(bytes: Buffer): Promise<{ key: string; checksum: string }> {
  await mkdir(config.PRIVATE_STORAGE_DIR, { recursive: true, mode: 0o700 });
  const key = randomBytes(32).toString("hex");
  const checksum = createHash("sha256").update(bytes).digest("hex");
  await writeFile(objectPath(key), bytes, { flag: "wx", mode: 0o600 });
  return { key, checksum };
}

export async function readPrivateObject(key: string): Promise<Buffer> {
  return readFile(objectPath(key));
}

export async function deletePrivateObject(key: string): Promise<void> {
  await unlink(objectPath(key));
}

export async function verifyPrivateStorageRuntime() {
  const probe = Buffer.from(`ImpactMatch private-storage probe ${randomBytes(16).toString("hex")}`);
  let key: string | undefined;
  try {
    const stored = await savePrivateObject(probe);
    key = stored.key;
    const retrieved = await readPrivateObject(key);
    if (!retrieved.equals(probe)) throw new Error("Private storage probe contents did not match.");
    await deletePrivateObject(key);
    key = undefined;
    return {
      configured: true,
      state: "verified",
      runtimeVerified: true,
      checkedAt: new Date().toISOString(),
      mode: "private_local_filesystem",
      productionReady: false,
      reason: "Synthetic file create/read/delete checks passed. Local filesystem storage is not a production persistent-storage guarantee.",
    };
  } catch {
    if (key) {
      try {
        await deletePrivateObject(key);
      } catch {
        return {
          configured: true,
          state: "error",
          runtimeVerified: false,
          checkedAt: new Date().toISOString(),
          mode: "private_local_filesystem",
          productionReady: false,
          reason: "Private storage verification failed and its temporary probe file could not be removed.",
        };
      }
    }
    return {
      configured: true,
      state: "error",
      runtimeVerified: false,
      checkedAt: new Date().toISOString(),
      mode: "private_local_filesystem",
      productionReady: false,
      reason: "Private storage could not complete its synthetic create/read/delete check.",
    };
  }
}

export function encryptPrivateText(plaintext: string): string | undefined {
  const key = encryptionKey();
  if (!key || key.length !== 32) return undefined;
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${nonce.toString("base64url")}.${tag.toString("base64url")}.${ciphertext.toString("base64url")}`;
}

export function decryptPrivateText(value: string): { status: "completed"; text: string } | { status: "unavailable"; error: string } {
  const key = encryptionKey();
  if (!key || key.length !== 32) {
    return { status: "unavailable", error: "OCR text cannot be decrypted because REQUEST_DATA_ENCRYPTION_KEY is not configured correctly." };
  }
  try {
    const [version, noncePart, tagPart, ciphertextPart] = value.split(".");
    if (version !== "v1" || !noncePart || !tagPart || ciphertextPart === undefined) {
      return { status: "unavailable", error: "Stored OCR text has an unsupported encrypted format." };
    }
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(noncePart, "base64url"));
    decipher.setAuthTag(Buffer.from(tagPart, "base64url"));
    const text = Buffer.concat([
      decipher.update(Buffer.from(ciphertextPart, "base64url")),
      decipher.final(),
    ]).toString("utf8");
    return { status: "completed", text };
  } catch {
    return { status: "unavailable", error: "Stored OCR text could not be decrypted; verify the configured encryption key." };
  }
}
