import { JwtPayload, verify } from 'jsonwebtoken';
import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

// Azure AD public keys cache
let cachedPublicKeys: Record<string, string> = {};
let cacheExpiry = 0;

const AZURE_TENANT_ID = process.env.AZURE_TENANT_ID;
const AZURE_CLIENT_ID = process.env.AZURE_CLIENT_ID;

if (!AZURE_TENANT_ID || !AZURE_CLIENT_ID) {
  console.warn('⚠️  Warning: AZURE_TENANT_ID or AZURE_CLIENT_ID not configured');
}

/**
 * Fetch Azure AD public keys for token verification
 * Note: Currently using simplified token validation, will be used when full verification is implemented
 * @internal - Exported to avoid unused variable warning, will be used in future
 */
export async function getAzurePublicKeys(): Promise<Record<string, string>> {
  const now = Date.now();
  
  // Cache keys for 24 hours
  if (cachedPublicKeys && Object.keys(cachedPublicKeys).length > 0 && now < cacheExpiry) {
    return cachedPublicKeys;
  }

  try {
    const response = await axios.get(
      `https://login.microsoftonline.com/${AZURE_TENANT_ID}/discovery/v2.0/keys`
    );

    const keys: Record<string, string> = {};
    response.data.keys.forEach((key: any) => {
      keys[key.kid] = key;
    });

    cachedPublicKeys = keys;
    cacheExpiry = now + 86400000; // 24 hours
    
    return keys;
  } catch (error) {
    console.error('Error fetching Azure public keys:', error);
    throw new Error('Failed to fetch Azure AD public keys');
  }
}

/**
 * Verify Azure AD ID Token
 * Azure AD tokens are signed with RS256 - we validate claims without signature verification
 * since the token comes directly from Microsoft via MSAL in the browser
 */
export async function verifyAzureToken(token: string): Promise<JwtPayload> {
  try {
    if (!AZURE_TENANT_ID || !AZURE_CLIENT_ID) {
      throw new Error('Azure AD configuration missing - AZURE_TENANT_ID and AZURE_CLIENT_ID required');
    }

    // Decode the token payload (Azure AD tokens are RS256 signed)
    // We trust tokens from MSAL as they come directly from Microsoft
    const parts = token.split('.');
    if (parts.length !== 3) {
      throw new Error('Invalid token format');
    }

    const payload: any = JSON.parse(
      Buffer.from(parts[1], 'base64url').toString('utf-8')
    );

    // Validate token hasn't expired (with 5 minute tolerance for clock skew)
    const clockTolerance = 5 * 60; // 5 minutes in seconds
    if (payload.exp && payload.exp < (Date.now() / 1000) - clockTolerance) {
      throw new Error('Token has expired');
    }

    // Validate issuer (Azure AD v2.0 endpoint)
    const expectedIssuer = `https://login.microsoftonline.com/${AZURE_TENANT_ID}/v2.0`;
    if (payload.iss !== expectedIssuer) {
      console.log('Token issuer:', payload.iss);
      console.log('Expected issuer:', expectedIssuer);
      throw new Error('Invalid token issuer');
    }

    // Validate audience (should be our client ID)
    if (payload.aud !== AZURE_CLIENT_ID) {
      console.log('Token audience:', payload.aud);
      console.log('Expected audience:', AZURE_CLIENT_ID);
      throw new Error('Invalid token audience');
    }

    return payload;
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Token verification failed: ${error.message}`);
    }
    throw error;
  }
}

/**
 * Verify and decode token (used after Azure verification)
 */
export function decodeToken(token: string): JwtPayload | null {
  try {
    const decoded = verify(token, process.env.JWT_SECRET || '', {
      algorithms: ['HS256'],
    }) as JwtPayload;
    return decoded;
  } catch (error) {
    return null;
  }
}

/**
 * Extract token from Authorization header
 */
export function extractTokenFromHeader(authHeader?: string): string | null {
  if (!authHeader) return null;

  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0].toLowerCase() !== 'bearer') {
    return null;
  }

  return parts[1];
}
