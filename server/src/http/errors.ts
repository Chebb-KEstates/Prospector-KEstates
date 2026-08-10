/**
 * One error shape for the whole API:
 *   { error: { code, message, details? } }
 *
 * `message` is written to be shown to a user as-is — the frontend surfaces it
 * directly, the way the reference implementation surfaced signIn()'s strings
 * ("Email or password not recognised. Accounts are created by your manager.").
 * `code` is what client code should branch on; never parse the message.
 */
export class ApiError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  toPayload() {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.details !== undefined ? { details: this.details } : {}),
      },
    };
  }
}

export const badRequest = (msg: string, details?: unknown) =>
  new ApiError(400, 'bad_request', msg, details);

export const unauthorized = (msg = 'Please sign in to continue.') =>
  new ApiError(401, 'unauthorized', msg);

export const forbidden = (msg = 'You do not have permission to do that.') =>
  new ApiError(403, 'forbidden', msg);

export const notFound = (msg = 'Not found.') =>
  new ApiError(404, 'not_found', msg);

export const conflict = (msg: string, details?: unknown) =>
  new ApiError(409, 'conflict', msg, details);

export const payloadTooLarge = (msg: string) =>
  new ApiError(413, 'payload_too_large', msg);

export const unprocessable = (msg: string, details?: unknown) =>
  new ApiError(422, 'unprocessable', msg, details);

export const tooManyRequests = (msg: string) =>
  new ApiError(429, 'too_many_requests', msg);
