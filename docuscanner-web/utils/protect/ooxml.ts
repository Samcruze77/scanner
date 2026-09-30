// Password-protect a Word (.docx) document with Microsoft Office's own encryption:
// "ECMA-376 Agile Encryption", specified in [MS-OFFCRYPTO] section 2.3.4 (the format
// Word 2010 and later writes for File > Info > Protect Document > Encrypt with Password).
//
// The finished file is NOT a ZIP. It is an OLE / Compound File Binary container that
// holds the original, unchanged .docx package as one encrypted stream
// ("EncryptedPackage") plus a description of how it was encrypted ("EncryptionInfo"),
// exactly the layout Word produces, so Word asks for the password before opening it.
//
// Parameters (the ones Word itself writes): AES-256 in CBC mode, SHA-512, 100,000
// password-hashing rounds, 16-byte random salts, and an HMAC-SHA-512 over the encrypted
// package so tampering is detected. All the cryptography is the browser's own Web Crypto
// (AES-CBC, SHA-512, HMAC, getRandomValues): no cipher or hash is implemented here.
// The container is written by ./cfbWriter.ts and read back for verification with the `cfb`
// package (Apache-2.0, SheetJS), an independent implementation.
//
// Web Crypto's AES-CBC always adds/checks PKCS#7 padding but Office uses none, so:
//  - encrypting: the extra padding block Web Crypto appends is dropped (the blocks before
//    it are unaffected because CBC only chains forward);
//  - decrypting (used to verify our own output): a valid padding block is appended first.
//
// Runs in the browser and in Node (which has the same `crypto.subtle`), so the tests
// exercise this exact code.

import * as CFB from "cfb";
import { writeCfb, type CfbNode } from "./cfbWriter.ts";
import { ProtectError } from "./protect.ts";

const SEGMENT = 4096;
const SPIN_COUNT = 100_000;
const KEY_BYTES = 32; // AES-256
const BLOCK = 16;
const HASH_BYTES = 64; // SHA-512
const SALT_BYTES = 16;

// Block keys fixed by [MS-OFFCRYPTO] 2.3.4.11 - 2.3.4.14.
const BK_VERIFIER_INPUT = hex("fea7d2763b4b9e79");
const BK_VERIFIER_VALUE = hex("d7aa0f6d3061344e");
const BK_KEY_VALUE = hex("146e0be7abacd0d6");
const BK_HMAC_KEY = hex("5fb2ad010cb9e1f6");
const BK_HMAC_VALUE = hex("a0677f02b22c8433");

function hex(s: string): Uint8Array {
  return Uint8Array.from(s.match(/../g)!, (h) => parseInt(h, 16));
}

const subtle = (): SubtleCrypto => {
  const s = globalThis.crypto?.subtle;
  if (!s) throw new ProtectError("protect_unsupported_browser");
  return s;
};

const concat = (...parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};

const u32 = (n: number): Uint8Array => {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n, true);
  return b;
};

const random = (n: number): Uint8Array => crypto.getRandomValues(new Uint8Array(n));

async function sha512(...parts: Uint8Array[]): Promise<Uint8Array> {
  return new Uint8Array(await subtle().digest("SHA-512", concat(...parts) as BufferSource));
}

// Truncate, or pad with 0x36, to `n` bytes ([MS-OFFCRYPTO] 2.3.4.11).
function fit(bytes: Uint8Array, n: number): Uint8Array {
  if (bytes.length >= n) return bytes.slice(0, n);
  const out = new Uint8Array(n).fill(0x36);
  out.set(bytes);
  return out;
}

function utf16le(text: string): Uint8Array {
  const out = new Uint8Array(text.length * 2);
  const view = new DataView(out.buffer);
  for (let i = 0; i < text.length; i++) view.setUint16(i * 2, text.charCodeAt(i), true);
  return out;
}

// AES-256-CBC with no padding. `data.length` must be a multiple of 16.
async function aesEncrypt(key: Uint8Array, iv: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const k = await subtle().importKey("raw", key as BufferSource, "AES-CBC", false, ["encrypt"]);
  const withPadding = new Uint8Array(await subtle().encrypt({ name: "AES-CBC", iv: iv as BufferSource }, k, data as BufferSource));
  return withPadding.subarray(0, data.length);
}

async function aesDecrypt(key: Uint8Array, iv: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const k = await subtle().importKey("raw", key as BufferSource, "AES-CBC", false, ["encrypt", "decrypt"]);
  // Append one block that decrypts to valid PKCS#7 padding (sixteen 0x10 bytes): it is
  // E(0x10*16 xor lastCipherBlock), which CBC-encrypting that block with IV = lastCipherBlock gives.
  const last = data.subarray(data.length - BLOCK);
  const pad = new Uint8Array(await subtle().encrypt({ name: "AES-CBC", iv: last as BufferSource }, k, new Uint8Array(BLOCK).fill(BLOCK)));
  const extended = concat(data, pad.subarray(0, BLOCK));
  return new Uint8Array(await subtle().decrypt({ name: "AES-CBC", iv: iv as BufferSource }, k, extended as BufferSource));
}

export interface CryptoHooks {
  signal?: AbortSignal;
  // 0..1 across the whole operation.
  onProgress?: (fraction: number) => void;
}

function checkAbort(signal?: AbortSignal) {
  if (signal?.aborted) throw new ProtectError("protect_cancelled");
}

// The password hash: H0 = SHA512(salt || UTF-16LE password), Hn = SHA512(n as uint32 LE || Hn-1),
// n = 0 .. spinCount-1 ([MS-OFFCRYPTO] 2.3.4.11). Shared by all three block keys.
async function iteratedHash(password: string, salt: Uint8Array, spin: number, hooks: CryptoHooks, from: number, to: number): Promise<Uint8Array> {
  let h = await sha512(salt, utf16le(password));
  for (let i = 0; i < spin; i++) {
    h = await sha512(u32(i), h);
    if (i % 2000 === 0) {
      checkAbort(hooks.signal);
      hooks.onProgress?.(from + ((to - from) * i) / spin);
    }
  }
  return h;
}

async function blockKey(iterated: Uint8Array, block: Uint8Array): Promise<Uint8Array> {
  return fit(await sha512(iterated, block), KEY_BYTES);
}

const b64 = (bytes: Uint8Array): string => {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};
const fromB64 = (s: string): Uint8Array => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

// ---- the encryption descriptor (EncryptionInfo stream) -----------------------------------------

interface Descriptor {
  keyDataSalt: Uint8Array;
  encryptedHmacKey: Uint8Array;
  encryptedHmacValue: Uint8Array;
  spinCount: number;
  passwordSalt: Uint8Array;
  encryptedVerifierHashInput: Uint8Array;
  encryptedVerifierHashValue: Uint8Array;
  encryptedKeyValue: Uint8Array;
}

function descriptorXml(d: Descriptor): string {
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n` +
    `<encryption xmlns="http://schemas.microsoft.com/office/2006/encryption" xmlns:p="http://schemas.microsoft.com/office/2006/keyEncryptor/password" xmlns:c="http://schemas.microsoft.com/office/2006/keyEncryptor/certificate">` +
    `<keyData saltSize="${SALT_BYTES}" blockSize="${BLOCK}" keyBits="256" hashSize="${HASH_BYTES}" cipherAlgorithm="AES" cipherChaining="ChainingModeCBC" hashAlgorithm="SHA512" saltValue="${b64(d.keyDataSalt)}"/>` +
    `<dataIntegrity encryptedHmacKey="${b64(d.encryptedHmacKey)}" encryptedHmacValue="${b64(d.encryptedHmacValue)}"/>` +
    `<keyEncryptors><keyEncryptor uri="http://schemas.microsoft.com/office/2006/keyEncryptor/password">` +
    `<p:encryptedKey spinCount="${d.spinCount}" saltSize="${SALT_BYTES}" blockSize="${BLOCK}" keyBits="256" hashSize="${HASH_BYTES}" cipherAlgorithm="AES" cipherChaining="ChainingModeCBC" hashAlgorithm="SHA512" saltValue="${b64(d.passwordSalt)}" ` +
    `encryptedVerifierHashInput="${b64(d.encryptedVerifierHashInput)}" encryptedVerifierHashValue="${b64(d.encryptedVerifierHashValue)}" encryptedKeyValue="${b64(d.encryptedKeyValue)}"/>` +
    `</keyEncryptor></keyEncryptors></encryption>`
  );
}

// Version 4.4 (Agile), flags 0x40, then the XML ([MS-OFFCRYPTO] 2.3.4.10).
function encryptionInfoStream(d: Descriptor): Uint8Array {
  return concat(Uint8Array.from([4, 0, 4, 0, 0x40, 0, 0, 0]), new TextEncoder().encode(descriptorXml(d)));
}

function attr(xml: string, element: string, name: string): string {
  const tag = new RegExp(`<${element}\\b[^>]*>`).exec(xml)?.[0];
  const value = tag ? new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1] : undefined;
  if (value === undefined) throw new ProtectError("protect_unverified");
  return value;
}

function parseDescriptor(stream: Uint8Array): Descriptor {
  const head = Array.from(stream.subarray(0, 8)).join(",");
  if (head !== "4,0,4,0,64,0,0,0") throw new ProtectError("protect_unverified");
  const xml = new TextDecoder().decode(stream.subarray(8));
  const enc = "p:encryptedKey";
  const expect = (element: string, name: string, value: string) => {
    if (attr(xml, element, name) !== value) throw new ProtectError("protect_unverified");
  };
  expect("keyData", "cipherAlgorithm", "AES");
  expect("keyData", "cipherChaining", "ChainingModeCBC");
  expect("keyData", "hashAlgorithm", "SHA512");
  expect("keyData", "keyBits", "256");
  expect("keyData", "blockSize", "16");
  expect("keyData", "hashSize", "64");
  expect(enc, "hashAlgorithm", "SHA512");
  expect(enc, "keyBits", "256");
  return {
    keyDataSalt: fromB64(attr(xml, "keyData", "saltValue")),
    encryptedHmacKey: fromB64(attr(xml, "dataIntegrity", "encryptedHmacKey")),
    encryptedHmacValue: fromB64(attr(xml, "dataIntegrity", "encryptedHmacValue")),
    spinCount: Number(attr(xml, enc, "spinCount")),
    passwordSalt: fromB64(attr(xml, enc, "saltValue")),
    encryptedVerifierHashInput: fromB64(attr(xml, enc, "encryptedVerifierHashInput")),
    encryptedVerifierHashValue: fromB64(attr(xml, enc, "encryptedVerifierHashValue")),
    encryptedKeyValue: fromB64(attr(xml, enc, "encryptedKeyValue")),
  };
}

// ---- data spaces: fixed structures Word writes next to the encrypted package -------------------
// [MS-OFFCRYPTO] 2.3.4.? / [MS-CFB]-hosted "\x06DataSpaces" storage. They say "the package is
// encrypted with the standard strong-encryption transform".

// UNICODE-LP-P4: byte length, the UTF-16LE text, then zero padding up to a multiple of 4 bytes.
const lenStr = (text: string): Uint8Array => {
  const bytes = utf16le(text);
  return concat(u32(bytes.length), bytes, new Uint8Array((4 - (bytes.length % 4)) % 4));
};
const version = (): Uint8Array => concat(Uint8Array.from([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]));

function dataSpaceVersion(): Uint8Array {
  return concat(lenStr("Microsoft.Container.DataSpaces"), version());
}

function dataSpaceMap(): Uint8Array {
  const entry = concat(u32(1), u32(0), lenStr("EncryptedPackage"), lenStr("StrongEncryptionDataSpace"));
  return concat(u32(8), u32(1), u32(entry.length + 4), entry);
}

function strongEncryptionDataSpace(): Uint8Array {
  return concat(u32(8), u32(1), lenStr("StrongEncryptionTransform"));
}

function primary(): Uint8Array {
  const id = lenStr("{FF9A3F03-56EF-4613-BDD5-5A41C1D07246}");
  // The header length covers the length field, the type and the transform id only.
  const header = concat(u32(4 + 4 + id.length), u32(1), id);
  const name = lenStr("Microsoft.Container.EncryptionTransform");
  const transformInfo = concat(u32(0), u32(0), u32(0), u32(4));
  return concat(header, name, version(), transformInfo);
}

// ---- encrypt ------------------------------------------------------------------------------------

export interface EncryptedDocx {
  // The complete Office-encrypted file (an OLE container), ready to be saved as .docx.
  data: Uint8Array;
}

export async function encryptDocx(pkg: Uint8Array, password: string, hooks: CryptoHooks = {}): Promise<EncryptedDocx> {
  const secretKey = random(KEY_BYTES);
  const keyDataSalt = random(SALT_BYTES);
  const passwordSalt = random(SALT_BYTES);
  const verifierInput = random(SALT_BYTES);

  // 1. The key that unlocks the secret key comes from the password.
  const iterated = await iteratedHash(password, passwordSalt, SPIN_COUNT, hooks, 0, 0.6);
  const [kInput, kValue, kKey] = await Promise.all([
    blockKey(iterated, BK_VERIFIER_INPUT),
    blockKey(iterated, BK_VERIFIER_VALUE),
    blockKey(iterated, BK_KEY_VALUE),
  ]);
  const iv = fit(passwordSalt, BLOCK);
  const encryptedVerifierHashInput = await aesEncrypt(kInput, iv, verifierInput);
  const encryptedVerifierHashValue = await aesEncrypt(kValue, iv, await sha512(verifierInput));
  const encryptedKeyValue = await aesEncrypt(kKey, iv, secretKey);

  // 2. The package: an 8-byte original size, then 4096-byte segments, each with its own IV.
  const segments = Math.ceil(pkg.length / SEGMENT);
  const body = new Uint8Array(8 + segments * SEGMENT);
  new DataView(body.buffer).setBigUint64(0, BigInt(pkg.length), true);
  let used = 8;
  for (let i = 0; i < segments; i++) {
    if (i % 64 === 0) {
      checkAbort(hooks.signal);
      hooks.onProgress?.(0.6 + (0.35 * i) / segments);
    }
    const plain = pkg.subarray(i * SEGMENT, (i + 1) * SEGMENT);
    // The last segment is padded with zeros up to a whole block; the true size is in the header.
    const padded = plain.length % BLOCK === 0 ? plain : concat(plain, new Uint8Array(BLOCK - (plain.length % BLOCK)));
    const segmentIv = fit(await sha512(keyDataSalt, u32(i)), BLOCK);
    const encrypted = await aesEncrypt(secretKey, segmentIv, padded);
    body.set(encrypted, used);
    used += encrypted.length;
  }
  const encryptedPackage = body.subarray(0, used);

  // 3. Integrity: HMAC-SHA512 over the whole EncryptedPackage stream, keyed by a random salt
  //    that is itself stored encrypted.
  const hmacSalt = random(HASH_BYTES);
  const hmacKey = await subtle().importKey("raw", hmacSalt as BufferSource, { name: "HMAC", hash: "SHA-512" }, false, ["sign"]);
  const hmac = new Uint8Array(await subtle().sign("HMAC", hmacKey, encryptedPackage as BufferSource));
  const encryptedHmacKey = await aesEncrypt(secretKey, fit(await sha512(keyDataSalt, BK_HMAC_KEY), BLOCK), hmacSalt);
  const encryptedHmacValue = await aesEncrypt(secretKey, fit(await sha512(keyDataSalt, BK_HMAC_VALUE), BLOCK), hmac);

  const info = encryptionInfoStream({
    keyDataSalt,
    encryptedHmacKey,
    encryptedHmacValue,
    spinCount: SPIN_COUNT,
    passwordSalt,
    encryptedVerifierHashInput,
    encryptedVerifierHashValue,
    encryptedKeyValue,
  });

  const dataSpaces: CfbNode = {
    name: "\u0006DataSpaces",
    children: [
      { name: "Version", data: dataSpaceVersion() },
      { name: "DataSpaceMap", data: dataSpaceMap() },
      { name: "DataSpaceInfo", children: [{ name: "StrongEncryptionDataSpace", data: strongEncryptionDataSpace() }] },
      { name: "TransformInfo", children: [{ name: "StrongEncryptionTransform", children: [{ name: "\u0006Primary", data: primary() }] }] },
    ],
  };
  const written = writeCfb({
    name: "Root Entry",
    children: [dataSpaces, { name: "EncryptionInfo", data: info }, { name: "EncryptedPackage", data: encryptedPackage }],
  });
  hooks.onProgress?.(1);
  return { data: written };
}

// ---- verify (decrypt our own output and compare) ------------------------------------------------

export const CFB_MAGIC = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

export function looksLikeOfficeEncrypted(data: Uint8Array): boolean {
  return CFB_MAGIC.every((b, i) => data[i] === b);
}

// Reads the container back, checks the descriptor, opens it with the password, checks the
// password verifier and the HMAC, decrypts every segment and compares it to `original`.
// Throws protect_unverified on ANY discrepancy. Nothing is returned that could be downloaded.
export async function verifyEncryptedDocx(encrypted: Uint8Array, original: Uint8Array, password: string, hooks: CryptoHooks = {}): Promise<void> {
  try {
    if (!looksLikeOfficeEncrypted(encrypted)) throw new ProtectError("protect_unverified");
    // A plain .docx starts with "PK": never acceptable output.
    if (encrypted[0] === 0x50 && encrypted[1] === 0x4b) throw new ProtectError("protect_unverified");
    const cfb = CFB.read(encrypted as never, { type: "array" });
    const infoEntry = CFB.find(cfb, "/EncryptionInfo");
    const pkgEntry = CFB.find(cfb, "/EncryptedPackage");
    for (const name of ["/\u0006DataSpaces/Version", "/\u0006DataSpaces/DataSpaceMap", "/\u0006DataSpaces/DataSpaceInfo/StrongEncryptionDataSpace", "/\u0006DataSpaces/TransformInfo/StrongEncryptionTransform/\u0006Primary"]) {
      if (!CFB.find(cfb, name)) throw new ProtectError("protect_unverified");
    }
    if (!infoEntry?.content || !pkgEntry?.content) throw new ProtectError("protect_unverified");
    const d = parseDescriptor(Uint8Array.from(infoEntry.content as ArrayLike<number>));
    const stream = Uint8Array.from(pkgEntry.content as ArrayLike<number>);

    // Password -> keys -> verifier must match (this is what makes Word accept/reject a password).
    const iterated = await iteratedHash(password, d.passwordSalt, d.spinCount, hooks, 0, 0.5);
    const iv = fit(d.passwordSalt, BLOCK);
    const verifierInput = await aesDecrypt(await blockKey(iterated, BK_VERIFIER_INPUT), iv, d.encryptedVerifierHashInput);
    const verifierHash = await aesDecrypt(await blockKey(iterated, BK_VERIFIER_VALUE), iv, d.encryptedVerifierHashValue);
    const expected = await sha512(verifierInput.subarray(0, SALT_BYTES));
    if (!equal(verifierHash.subarray(0, HASH_BYTES), expected)) throw new ProtectError("protect_unverified");
    const secretKey = (await aesDecrypt(await blockKey(iterated, BK_KEY_VALUE), iv, d.encryptedKeyValue)).subarray(0, KEY_BYTES);

    // Integrity value.
    const hmacSalt = (await aesDecrypt(secretKey, fit(await sha512(d.keyDataSalt, BK_HMAC_KEY), BLOCK), d.encryptedHmacKey)).subarray(0, HASH_BYTES);
    const hmacExpected = (await aesDecrypt(secretKey, fit(await sha512(d.keyDataSalt, BK_HMAC_VALUE), BLOCK), d.encryptedHmacValue)).subarray(0, HASH_BYTES);
    const hmacKey = await subtle().importKey("raw", hmacSalt as BufferSource, { name: "HMAC", hash: "SHA-512" }, false, ["verify"]);
    if (!(await subtle().verify("HMAC", hmacKey, hmacExpected as BufferSource, stream as BufferSource))) throw new ProtectError("protect_unverified");

    // Decrypt the package segment by segment and compare with the original bytes.
    const size = Number(new DataView(stream.buffer, stream.byteOffset, 8).getBigUint64(0, true));
    if (size !== original.length) throw new ProtectError("protect_unverified");
    const segments = Math.ceil(size / SEGMENT);
    const lastLength = size - (segments - 1) * SEGMENT;
    if (segments === 0 || stream.length !== 8 + (segments - 1) * SEGMENT + Math.ceil(lastLength / BLOCK) * BLOCK) throw new ProtectError("protect_unverified");
    for (let i = 0; i < segments; i++) {
      if (i % 64 === 0) {
        checkAbort(hooks.signal);
        hooks.onProgress?.(0.5 + (0.5 * i) / segments);
      }
      const start = 8 + i * SEGMENT;
      const cipher = stream.subarray(start, Math.min(start + SEGMENT, stream.length));
      const plain = await aesDecrypt(secretKey, fit(await sha512(d.keyDataSalt, u32(i)), BLOCK), cipher);
      const want = original.subarray(i * SEGMENT, Math.min((i + 1) * SEGMENT, size));
      if (!equal(plain.subarray(0, want.length), want)) throw new ProtectError("protect_unverified");
    }
  } catch (error) {
    if (error instanceof ProtectError) throw error;
    throw new ProtectError("protect_unverified");
  }
}

function equal(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

// Exposed so the tests can pin these bytes to the reference values.
export const dataSpaceStructures = { version: dataSpaceVersion, map: dataSpaceMap, strongEncryptionDataSpace, primary };
