/**
 * A name-based UUID (version 5, RFC 4122), computed the same way on every runtime.
 *
 * Why it exists here and not in a library: the journal needs one identifier per
 * person per day, computed on the phone and checked on the server, and both must
 * get the same answer without talking to each other. `crypto.subtle` is
 * asynchronous and missing on some runtimes, and a dependency that only works in
 * Node would make the phone and the API disagree. So the hash is the pure SHA-1
 * below, and the tests check it against the values the RFC and Python produce.
 *
 * SHA-1 is used here for naming, not for security: nothing depends on it being
 * collision resistant, only on it being the same everywhere.
 */

/** SHA-1 of a byte array. Pure, so it runs unchanged in Hermes, the browser and Node. */
export function sha1(bytes: Uint8Array): Uint8Array {
  const bitLength = bytes.length * 8;
  // The message, a single 0x80 bit, zeros, and the length in bits as 64 bits.
  const paddedLength = Math.ceil((bytes.length + 9) / 64) * 64;
  const data = new Uint8Array(paddedLength);
  data.set(bytes);
  data[bytes.length] = 0x80;
  const view = new DataView(data.buffer);
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x100000000));
  view.setUint32(paddedLength - 4, bitLength >>> 0);

  let h0 = 0x67452301;
  let h1 = 0xefcdab89;
  let h2 = 0x98badcfe;
  let h3 = 0x10325476;
  let h4 = 0xc3d2e1f0;
  const w = new Uint32Array(80);

  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let i = 0; i < 16; i += 1) w[i] = view.getUint32(offset + i * 4);
    for (let i = 16; i < 80; i += 1) {
      w[i] = rotateLeft(w[i - 3]! ^ w[i - 8]! ^ w[i - 14]! ^ w[i - 16]!, 1);
    }

    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    for (let i = 0; i < 80; i += 1) {
      let f: number;
      let k: number;
      if (i < 20) {
        f = (b & c) | (~b & d);
        k = 0x5a827999;
      } else if (i < 40) {
        f = b ^ c ^ d;
        k = 0x6ed9eba1;
      } else if (i < 60) {
        f = (b & c) | (b & d) | (c & d);
        k = 0x8f1bbcdc;
      } else {
        f = b ^ c ^ d;
        k = 0xca62c1d6;
      }
      const temp = (rotateLeft(a, 5) + f + e + k + w[i]!) | 0;
      e = d;
      d = c;
      c = rotateLeft(b, 30);
      b = a;
      a = temp;
    }
    h0 = (h0 + a) | 0;
    h1 = (h1 + b) | 0;
    h2 = (h2 + c) | 0;
    h3 = (h3 + d) | 0;
    h4 = (h4 + e) | 0;
  }

  const out = new Uint8Array(20);
  const result = new DataView(out.buffer);
  [h0, h1, h2, h3, h4].forEach((h, index) => result.setUint32(index * 4, h >>> 0));
  return out;
}

function rotateLeft(value: number, bits: number): number {
  return (value << bits) | (value >>> (32 - bits));
}

/** UTF-8 bytes of a string, written out by hand so no runtime's TextEncoder is needed. */
function utf8(text: string): Uint8Array {
  const out: number[] = [];
  for (const character of text) {
    const code = character.codePointAt(0)!;
    if (code < 0x80) {
      out.push(code);
    } else if (code < 0x800) {
      out.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else if (code < 0x10000) {
      out.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    } else {
      out.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f),
      );
    }
  }
  return Uint8Array.from(out);
}

const UUID_SHAPE = /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i;

function uuidBytes(uuid: string): Uint8Array {
  if (!UUID_SHAPE.test(uuid)) throw new Error(`not a UUID: ${uuid}`);
  const hex = uuid.replace(/-/g, '');
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i += 1) bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

/**
 * The version 5 UUID of `name` inside the namespace `namespace`.
 *
 * The same pair always gives the same id, on every device, and that is the whole
 * point: two phones that write the same day offline agree on which row it is.
 */
export function uuidV5(namespace: string, name: string): string {
  const namespaceBytes = uuidBytes(namespace);
  const nameBytes = utf8(name);
  const input = new Uint8Array(namespaceBytes.length + nameBytes.length);
  input.set(namespaceBytes);
  input.set(nameBytes, namespaceBytes.length);

  const bytes = sha1(input).slice(0, 16);
  // The version (5) and the RFC 4122 variant are written into the hash.
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;

  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
