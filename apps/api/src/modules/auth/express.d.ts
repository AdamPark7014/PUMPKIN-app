import type { AuthenticatedUser } from './auth.types';

declare global {
  namespace Express {
    interface Request {
      authSource?: 'bearer' | 'cookie';
    }

    interface User extends AuthenticatedUser {}
  }
}

export {};
