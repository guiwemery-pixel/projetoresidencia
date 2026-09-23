import 'express';

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
      sessionId?: string;
    }
  }
}

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  timezone: string;
}
