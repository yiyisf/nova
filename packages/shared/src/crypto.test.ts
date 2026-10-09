import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret, loadMasterKey, randomToken, safeEqual } from "./crypto.ts";

describe("crypto", () => {
  it("round-trips AES-GCM secrets", () => {
    const key = loadMasterKey("a".repeat(64));
    const payload = encryptSecret("sk-test-key", key);
    expect(payload.startsWith("v1:")).toBe(true);
    expect(decryptSecret(payload, key)).toBe("sk-test-key");
  });

  it("rejects tampered ciphertext", () => {
    const key = loadMasterKey("b".repeat(64));
    const payload = encryptSecret("hello", key);
    const broken = payload.slice(0, -2) + "aa";
    expect(() => decryptSecret(broken, key)).toThrow();
  });

  it("derives a 32-byte key from a passphrase", () => {
    const key = loadMasterKey("passphrase-not-hex");
    expect(key.length).toBe(32);
  });

  it("compares tokens in constant time", () => {
    const token = randomToken();
    expect(safeEqual(token, token)).toBe(true);
    expect(safeEqual(token, randomToken())).toBe(false);
  });
});
