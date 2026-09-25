import type { ApiErrorCode } from '@orbit-hub/contracts';

export interface HttpErrorOptions {
  status: number;
  code: ApiErrorCode;
  message: string;
  fields?: Record<string, string>;
  cause?: unknown;
}

/** Errors that reach the client are always shaped like `apiErrorSchema`. */
export class HttpError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode;
  readonly fields: Record<string, string> | undefined;

  constructor(options: HttpErrorOptions) {
    super(options.message, { cause: options.cause });
    this.name = 'HttpError';
    this.status = options.status;
    this.code = options.code;
    this.fields = options.fields;
  }

  static badRequest(message: string, fields?: Record<string, string>) {
    return new HttpError({ status: 400, code: 'bad_request', message, fields });
  }

  static validation(message: string, fields?: Record<string, string>) {
    return new HttpError({ status: 422, code: 'validation_failed', message, fields });
  }

  static unauthorized(message = 'Authentication required') {
    return new HttpError({ status: 401, code: 'unauthorized', message });
  }

  static forbidden(message = 'You do not have access to this resource') {
    return new HttpError({ status: 403, code: 'forbidden', message });
  }

  static notFound(message = 'Resource not found') {
    return new HttpError({ status: 404, code: 'not_found', message });
  }

  static conflict(message: string) {
    return new HttpError({ status: 409, code: 'conflict', message });
  }

  static notImplemented(message: string) {
    return new HttpError({ status: 501, code: 'not_implemented', message });
  }

  static internal(message = 'Internal server error', cause?: unknown) {
    return new HttpError({ status: 500, code: 'internal_error', message, cause });
  }
}
