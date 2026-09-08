import { Response } from 'express';
import { z, ZodError } from 'zod';

/**
 * A domain error that carries an HTTP status code. Throw it from anywhere
 * (including inside a prisma.$transaction callback) to abort with a precise
 * client-facing status + message; `handleError` maps it to the response.
 */
export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
  }
}

export function validateRequest(schema: z.ZodSchema) {
  return (req: any, res: Response, next: (err?: any) => void): void => {
    try {
      schema.parse(req.body);
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        res.status(400).json({
          success: false,
          error: 'Validation failed',
          details: error.errors.map((e) => ({
            field: e.path.join('.'),
            message: e.message,
          })),
        });
        return;
      }
      next(error);
    }
  };
}

export function handleError(error: unknown, res: Response): void {
  console.error('Server error:', error);

  if (error instanceof z.ZodError) {
    res.status(400).json({ success: false, error: 'Validation error', details: error.errors });
    return;
  }

  // An HttpError (or any error carrying a numeric `status`) propagates its own
  // status code + message. This lets code inside a prisma.$transaction throw a
  // domain error (e.g. 400 insufficient balance) and roll back, while the client
  // still receives the precise status instead of a generic 500.
  if (error instanceof HttpError) {
    res.status(error.status).json({ success: false, message: error.message });
    return;
  }

  if (error instanceof Error) {
    const status = (error as Error & { status?: number }).status;
    if (typeof status === 'number' && status >= 400 && status <= 599) {
      res.status(status).json({ success: false, message: error.message });
      return;
    }
    res.status(500).json({ success: false, error: error.message });
    return;
  }

  res.status(500).json({ success: false, error: 'Internal server error' });
}
