import { Router, Response } from 'express';
import jwt from 'jsonwebtoken';
import { AuthRequest, LoginRequest, LoginResponse } from '../types/auth';
import { authMiddleware } from '../middleware/authMiddleware';
import { UserRepository } from '../repositories';
import { verifyAzureToken } from '../services/authService';

const router = Router();

/**
 * POST /api/auth/login
 * Exchange Azure AD token for JWT and user info
 * Expected body: { idToken: string }
 */
router.post('/login', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { idToken } = req.body as LoginRequest;

    if (!idToken) {
      res.status(400).json({ error: 'idToken is required' });
      return;
    }

    // Verify Azure AD token
    const azurePayload = await verifyAzureToken(idToken);

    // Extract user info
    const email = (azurePayload.email || azurePayload.preferred_username || '') as string;
    const name = (azurePayload.name || 'Unknown') as string;
    const oid = (azurePayload.oid || '') as string;

    if (!email || !oid) {
      res.status(400).json({ error: 'Invalid token: missing email or OID' });
      return;
    }

    // Find or create user in database
    let user = await UserRepository.findByEmail(email);

    if (!user) {
      // Create new user (will need admin to assign role)
      user = await UserRepository.create({
        email,
        name,
        role: 'supervisor', // Default role (admin will override)
      });
    }

    if (!user.active) {
      res.status(403).json({ error: 'User account is inactive' });
      return;
    }

    // Generate JWT for internal use
    const accessToken = jwt.sign(
      {
        oid,
        email,
        name,
        userId: user.id,
        role: user.role,
      },
      process.env.JWT_SECRET || 'dev-secret',
      { expiresIn: '24h' }
    );

    const response: LoginResponse = {
      accessToken,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
      },
    };

    res.json(response);
  } catch (error) {
    console.error('Login error:', error);
    if (error instanceof Error) {
      res.status(401).json({ error: error.message });
    } else {
      res.status(401).json({ error: 'Authentication failed' });
    }
  }
});

/**
 * GET /api/auth/me
 * Get current user info
 */
router.get('/me', authMiddleware, (req: AuthRequest, res: Response): void => {
  if (!req.user) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  res.json({
    user: req.user,
  });
});

/**
 * POST /api/auth/refresh
 * Refresh JWT token
 */
router.post('/refresh', authMiddleware, (req: AuthRequest, res: Response): void => {
  if (!req.user) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  // Generate new token
  const accessToken = jwt.sign(
    {
      oid: req.user.azureOid,
      email: req.user.email,
      name: req.user.name,
      userId: req.user.id,
      role: req.user.role,
    },
    process.env.JWT_SECRET || 'dev-secret',
    { expiresIn: '24h' }
  );

  res.json({ accessToken });
});

/**
 * POST /api/auth/logout
 * Logout (client-side token removal)
 */
router.post('/logout', authMiddleware, (_req: AuthRequest, res: Response): void => {
  // JWT logout is stateless - client removes token
  res.json({ message: 'Logout successful' });
});

export default router;
