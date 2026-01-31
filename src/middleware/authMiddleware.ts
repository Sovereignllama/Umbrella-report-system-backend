import { Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { AuthRequest, TokenPayload } from '../types/auth';
import { UserRepository } from '../repositories';
import { extractTokenFromHeader } from '../services/authService';

/**
 * Middleware to verify JWT token in Authorization header
 * Sets req.user if token is valid
 */
export async function authMiddleware(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const authHeader = req.headers.authorization;
    const token = extractTokenFromHeader(authHeader);

    if (!token) {
      res.status(401).json({ error: 'No authorization token provided' });
      return;
    }

    // Verify JWT
    const decoded = jwt.verify(token, process.env.JWT_SECRET || '') as TokenPayload;

    // Fetch user from database with role
    const user = await UserRepository.findByEmail(decoded.email);
    
    if (!user) {
      res.status(401).json({ error: 'User not found' });
      return;
    }

    if (!user.active) {
      res.status(403).json({ error: 'User account is inactive' });
      return;
    }

    // Attach user to request
    req.user = {
      id: user.id,
      email: user.email,
      name: user.name,
      azureOid: decoded.oid,
      role: user.role,
    };

    next();
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      res.status(401).json({ error: 'Token has expired' });
    } else if (error instanceof jwt.JsonWebTokenError) {
      res.status(401).json({ error: 'Invalid token' });
    } else {
      console.error('Auth middleware error:', error);
      res.status(401).json({ error: 'Authentication failed' });
    }
  }
}

/**
 * Middleware to check if user has specific role (admin always has access)
 */
export function requireRole(...roles: Array<'admin' | 'supervisor' | 'boss'>) {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    // Admin always has full access
    if (req.user.role === 'admin') {
      next();
      return;
    }

    if (!roles.includes(req.user.role)) {
      res.status(403).json({ error: 'Insufficient permissions' });
      return;
    }

    next();
  };
}

/**
 * Middleware to require admin role
 */
export function requireAdmin(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): void {
  if (!req.user) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  if (req.user.role !== 'admin') {
    res.status(403).json({ error: 'Admin access required' });
    return;
  }

  next();
}

/**
 * Middleware to require supervisor or boss (admin always has access)
 */
export function requireSupervisorOrBoss(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): void {
  if (!req.user) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  // Admin always has full access
  if (req.user.role === 'admin') {
    next();
    return;
  }

  if (req.user.role !== 'supervisor' && req.user.role !== 'boss') {
    res.status(403).json({ error: 'Supervisor or Boss access required' });
    return;
  }

  next();
}

/**
 * Middleware to require supervisor role (admin always has access)
 */
export function requireSupervisor(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): void {
  if (!req.user) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  // Admin always has full access
  if (req.user.role === 'admin') {
    next();
    return;
  }

  if (req.user.role !== 'supervisor') {
    res.status(403).json({ error: 'Supervisor access required' });
    return;
  }

  next();
}
