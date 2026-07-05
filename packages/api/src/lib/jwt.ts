import jwt, { type SignOptions } from "jsonwebtoken";
import { config } from "../config";

export interface AccessTokenPayload {
  sub: string; // userId
  email: string;
}

export function signAccessToken(payload: AccessTokenPayload): string {
  return jwt.sign(payload, config.jwt.accessSecret, { expiresIn: config.jwt.accessTtl as SignOptions["expiresIn"] });
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  return jwt.verify(token, config.jwt.accessSecret) as AccessTokenPayload;
}

export function signRefreshToken(payload: { sub: string; jti: string }): string {
  return jwt.sign(payload, config.jwt.refreshSecret, { expiresIn: config.jwt.refreshTtl as SignOptions["expiresIn"] });
}

export function verifyRefreshToken(token: string): { sub: string; jti: string } {
  return jwt.verify(token, config.jwt.refreshSecret) as { sub: string; jti: string };
}
