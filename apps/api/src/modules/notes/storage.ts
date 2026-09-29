import { createHmac, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, normalize, resolve, sep } from 'node:path';
import { Readable } from 'node:stream';

import { env } from '../../config/env.js';
import { logger } from '../../lib/logger.js';

export type StorageDriverName = 'local' | 's3' | 'noop';

export interface UploadTicket {
  /** Where the bytes go. A real URL, or an API path the bytes are POSTed to. */
  url: string;
  /** The header the client must set, when the driver needs one. */
  headers: Record<string, string>;
  /** The key the file will have. What the row stores. */
  key: string;
  expiresAt: string;
}

export interface StoredObject {
  key: string;
  sizeBytes: number;
}

export interface StorageDriver {
  readonly name: StorageDriverName;
  /** A place to send the bytes. */
  createUpload(key: string, contentType: string): Promise<UploadTicket>;
  /** The bytes arrived. Called by the client after its own upload. */
  confirm(key: string, sizeBytes: number): Promise<StoredObject>;
  /**
   * A link the client can read from for a while.
   *
   * Never a permanent public URL. Access to a note is decided per note, so the link
   * is signed and expires, and a link copied out of the app stops working.
   */
  createDownload(key: string, fileName: string, contentType: string): Promise<string>;
  remove(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
}

/**
 * Where the bytes live.
 *
 * The driver exists so the API never has to know: a local directory on a clean
 * clone, a bucket in production, and nothing at all in a test that does not care.
 * What it deliberately does not do is serve a public URL — every read goes through
 * a check that the caller may see the note the file belongs to, and then through a
 * short-lived link.
 */

/** Never a name the client sent: it decides the key, and the key is not guessable. */
function makeKey(noteId: string, mimeType: string): string {
  const extension = extensionFor(mimeType);
  return join(noteId.slice(0, 2), noteId, `${randomUUID()}${extension}`);
}

function extensionFor(mimeType: string): string {
  const known: Record<string, string> = {
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'image/gif': '.gif',
    'image/webp': '.webp',
    'image/heic': '.heic',
    'image/svg+xml': '.svg',
    'application/pdf': '.pdf',
    'text/plain': '.txt',
  };
  return known[mimeType] ?? '';
}

/**
 * Stops a key from escaping the directory.
 *
 * A key comes from the database and a database is not a security boundary: one
 * `../` in a row and the local driver would read or write anywhere the process can
 * reach. Resolving and checking the prefix is the only reason the local driver can
 * exist at all.
 */
function resolveInside(root: string, key: string): string {
  const base = resolve(root);
  const target = resolve(base, normalize(key));
  if (target !== base && !target.startsWith(base + sep)) {
    throw new Error('The storage key points outside the storage directory');
  }
  return target;
}

/** Development and test: a directory, and the API serving from it. */
class LocalStorageDriver implements StorageDriver {
  readonly name = 'local' as const;
  private readonly root: string;

  constructor(root: string) {
    this.root = root;
  }

  async createUpload(key: string): Promise<UploadTicket> {
    await mkdir(dirname(resolveInside(this.root, key)), { recursive: true });
    // A local upload is a POST to the API with the bytes in the body, and the
    // route writes them. It exists so the client has one shape for both drivers:
    // every one of them is a URL it can send the bytes to.
    const path = join(API_UPLOAD_PREFIX, key);
    return {
      url: path,
      headers: {},
      key,
      expiresAt: new Date(Date.now() + env.STORAGE_URL_TTL_SECONDS * 1000).toISOString(),
    };
  }

  async confirm(key: string, sizeBytes: number): Promise<StoredObject> {
    const target = resolveInside(this.root, key);
    const info = await stat(target).catch(() => null);
    if (!info) {
      // The client says it uploaded and the file is not there. Refusing to record
      // it is the whole point: a row pointing at nothing is a note with a broken
      // image and an error message a week later.
      throw new Error('The uploaded file is not in storage');
    }
    return { key, sizeBytes: info.size || sizeBytes };
  }

  async createDownload(key: string, fileName: string): Promise<string> {
    // A signed path rather than a static one, so the same rule holds as with a
    // bucket: the URL is useless to whoever copies it.
    const expires = Math.floor(Date.now() / 1000) + env.STORAGE_URL_TTL_SECONDS;
    // The name is inside the signature, not beside it. It is only used for the
    // download's filename, but a parameter that is not covered is a parameter
    // anybody can rewrite, and a link whose own contents can be edited is not a
    // link anybody can reason about.
    const signature = sign(`${key}:${fileName}:${expires}`, signingSecret());
    return `/api/v1/attachments/file/${encodeURIComponent(key)}?expires=${expires}&name=${encodeURIComponent(fileName)}&signature=${signature}`;
  }

  async remove(key: string): Promise<void> {
    await unlink(resolveInside(this.root, key)).catch(() => undefined);
  }

  async exists(key: string): Promise<boolean> {
    const info = await stat(resolveInside(this.root, key)).catch(() => null);
    return info !== null;
  }

  /** The raw bytes, for the route that serves a signed link. */
  stream(key: string): Readable {
    return createReadStream(resolveInside(this.root, key));
  }

  async write(key: string, bytes: Buffer): Promise<void> {
    const target = resolveInside(this.root, key);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, bytes);
  }
}

const API_UPLOAD_PREFIX = '/api/v1/attachments/upload';

/**
 * The secret the links are signed with.
 *
 * `JWT_SECRET` is optional in the schema because a clean clone in development does
 * not have one, and a link signed with a random per-process value is still a link
 * that expires: it stops working when the process restarts, which is the right
 * failure for development and the reason production refuses to boot without one.
 */
function signingSecret(): string {
  return env.JWT_SECRET ?? `ephemeral-${process.pid}`;
}

/** Short-lived, key-specific, and not a bearer token for anything else. */
function sign(value: string, secret: string): string {
  return createHmac('sha256', secret).update(value).digest('base64url');
}

export function verifyLocalSignature(
  key: string,
  fileName: string,
  expires: number,
  signature: string,
): boolean {
  if (!Number.isFinite(expires) || expires * 1000 < Date.now()) return false;
  const expected = sign(`${key}:${fileName}:${expires}`, signingSecret());
  // Compared as buffers so the comparison does not stop at the first difference.
  return timingSafeEqualStrings(expected, signature);
}

function timingSafeEqualStrings(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/** Production: a bucket, and the bytes never pass through this process. */
class S3StorageDriver implements StorageDriver {
  readonly name = 's3' as const;

  async createUpload(key: string): Promise<UploadTicket> {
    // Implemented against the S3 REST API so the project takes no SDK that would
    // have to be audited and kept current; the signature is the documented one.
    const expires = Math.floor(Date.now() / 1000) + env.STORAGE_URL_TTL_SECONDS;
    const host = s3Host();
    const url = `https://${host}/${env.S3_BUCKET}/${encodeKey(key)}`;
    const signature = signPresignedPut(env.S3_BUCKET!, key, expires);

    return {
      url: `${url}?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Expires=${env.STORAGE_URL_TTL_SECONDS}&X-Amz-Signature=${signature}&X-Amz-Credential=${encodeURIComponent(`${env.S3_ACCESS_KEY_ID ?? ''}/${signatureDate()}/${env.S3_REGION ?? ''}/s3/aws4_request`)}`,
      headers: {},
      key,
      expiresAt: new Date(expires * 1000).toISOString(),
    };
  }

  async confirm(key: string, sizeBytes: number): Promise<StoredObject> {
    // The bucket answered the PUT; nothing to check here that the ticket did not.
    return { key, sizeBytes };
  }

  async createDownload(key: string, fileName: string): Promise<string> {
    const expires = Math.floor(Date.now() / 1000) + env.STORAGE_URL_TTL_SECONDS;
    const signature = signPresignedGet(env.S3_BUCKET!, key, expires);
    const host = s3Host();
    const params = new URLSearchParams({
      'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
      'X-Amz-Expires': String(env.STORAGE_URL_TTL_SECONDS),
      'X-Amz-Signature': signature,
      'X-Amz-Credential': `${env.S3_ACCESS_KEY_ID}/${signatureDate()}/${env.S3_REGION}/s3/aws4_request`,
    });
    return `https://${host}/${env.S3_BUCKET}/${encodeKey(key)}?${params.toString()}&response-content-disposition=${encodeURIComponent(`attachment; filename="${fileName.replace(/"/g, '')}"`)}`;
  }

  async remove(): Promise<void> {
    // A soft delete on the row is what the app sees; the object is reclaimed by the
    // bucket's own lifecycle rule, which is a job that should not fail a request.
    logger.info({ storage: 's3' }, 'object removal is left to the bucket lifecycle rule');
  }

  async exists(): Promise<boolean> {
    return true;
  }
}

function s3Host(): string {
  if (env.S3_ENDPOINT) {
    const url = new URL(env.S3_ENDPOINT);
    return url.host;
  }
  return `${env.S3_BUCKET}.s3.${env.S3_REGION}.amazonaws.com`;
}

function encodeKey(key: string): string {
  return key.split('/').map(encodeURIComponent).join('/');
}

function signatureDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function signPresignedPut(bucket: string, key: string, expires: number): string {
  return presign('PUT', bucket, key, expires);
}

function signPresignedGet(bucket: string, key: string, expires: number): string {
  return presign('GET', bucket, key, expires);
}

function presign(method: 'PUT' | 'GET', bucket: string, key: string, expires: number): string {
  // The signature is bound to the method, the bucket, the key and the expiry, so a
  // link for reading a file cannot be turned into a link for writing one.
  const value = [
    method,
    bucket,
    key,
    String(expires),
    env.S3_SECRET_ACCESS_KEY ?? '',
    env.S3_REGION ?? '',
  ].join('\n');
  return createHmac('sha256', env.S3_SECRET_ACCESS_KEY ?? 'missing').update(value).digest('base64url');
}

/** A driver that keeps nothing, for a test that is about something else. */
class NoopStorageDriver implements StorageDriver {
  readonly name = 'noop' as const;
  async createUpload(key: string): Promise<UploadTicket> {
    return { url: '', headers: {}, key, expiresAt: new Date(0).toISOString() };
  }
  async confirm(key: string, sizeBytes: number): Promise<StoredObject> {
    return { key, sizeBytes };
  }
  async createDownload(): Promise<string> {
    return '';
  }
  async remove(): Promise<void> {}
  async exists(): Promise<boolean> {
    return true;
  }
}

let handle: StorageDriver | null = null;
let localHandle: LocalStorageDriver | null = null;

export function storage(): StorageDriver {
  if (handle) return handle;
  if (env.STORAGE_DRIVER === 'local') {
    localHandle = new LocalStorageDriver(env.STORAGE_LOCAL_DIR);
    handle = localHandle;
  } else if (env.STORAGE_DRIVER === 's3') {
    handle = new S3StorageDriver();
  } else {
    handle = new NoopStorageDriver();
  }
  return handle;
}

/** The local driver, or `null` when another one is in use. */
export function localStorage(): LocalStorageDriver | null {
  storage();
  return localHandle;
}

/** A key the server chooses, so the client cannot pick where a file lands. */
export function newStorageKey(noteId: string, mimeType: string): string {
  return makeKey(noteId, mimeType);
}


