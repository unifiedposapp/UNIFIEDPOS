// Structured logging middleware (§39)
import { Request, Response, NextFunction } from 'express';

interface LogEntry {
  timestamp: string;
  level: 'info' | 'warn' | 'error' | 'debug';
  message: string;
  method?: string;
  path?: string;
  statusCode?: number;
  duration?: number;
  requestId?: string;
  organizationId?: string;
  userId?: string;
  deviceId?: string;
  error?: string;
  metadata?: Record<string, any>;
}

function formatLog(entry: LogEntry): string {
  return JSON.stringify(entry);
}

export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const start = Date.now();
  const requestId = `req_${Date.now()}_${Math.random().toString(36).substring(7)}`;
  
  (req as any).requestId = requestId;

  res.on('finish', () => {
    const duration = Date.now() - start;
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level: res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info',
      message: `${req.method} ${req.path}`,
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      duration,
      requestId,
    };

    if (res.statusCode >= 500) {
      console.error(formatLog(entry));
    } else if (res.statusCode >= 400) {
      console.warn(formatLog(entry));
    } else {
      console.log(formatLog(entry));
    }
  });

  next();
}

export function auditLogger(action: string, resourceType: string) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level: 'info',
      message: `Audit: ${action}`,
      method: req.method,
      path: req.path,
      metadata: {
        action,
        resourceType,
        body: req.body ? Object.keys(req.body) : [],
      },
    };
    console.log(formatLog(entry));
    next();
  };
}

export function errorLogger(err: Error, req: Request, _res: Response, next: NextFunction): void {
  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level: 'error',
    message: err.message,
    method: req.method,
    path: req.path,
    error: err.stack,
    requestId: (req as any).requestId,
  };
  console.error(formatLog(entry));
  next(err);
}

export function createLogEntry(level: LogEntry['level'], message: string, metadata?: Record<string, any>): void {
  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    metadata,
  };
  
  switch (level) {
    case 'error': console.error(formatLog(entry)); break;
    case 'warn': console.warn(formatLog(entry)); break;
    case 'debug': console.debug(formatLog(entry)); break;
    default: console.log(formatLog(entry));
  }
}
