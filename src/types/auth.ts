import { Request } from 'express';

export interface TokenPayload {
  oid: string; // Azure AD Object ID
  email: string;
  name: string;
  iat: number;
  exp: number;
}

export interface AuthRequest extends Request {
  user?: {
    id: string;
    email: string;
    name: string;
    azureOid: string; // Azure AD Object ID
    role: 'admin' | 'supervisor' | 'boss';
  };
  query: Record<string, string | string[] | undefined>;
}

export interface LoginRequest {
  idToken: string; // JWT from Azure AD
}

export interface LoginResponse {
  accessToken: string;
  user: {
    id: string;
    email: string;
    name: string;
    role: 'admin' | 'supervisor' | 'boss';
  };
}
