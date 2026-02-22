import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { config } from "./config.js";

export async function hashPassword(password) {
  return bcrypt.hash(password, 10);
}

export async function verifyPassword(password, hashed) {
  return bcrypt.compare(password, hashed);
}

export function signToken(user) {
  return jwt.sign(
    {
      sub: String(user.id),
      email: user.email
    },
    config.jwtSecret,
    { expiresIn: config.jwtExpiresIn }
  );
}

export function readBearerToken(req) {
  const raw = req.headers.authorization;
  const authHeader = Array.isArray(raw) ? raw[0] : raw || "";
  if (!authHeader.startsWith("Bearer ")) {
    return "";
  }
  return authHeader.slice(7).trim();
}

export function verifyToken(token) {
  return jwt.verify(token, config.jwtSecret);
}

export function requireAuth(req, res, next) {
  try {
    const token = readBearerToken(req);
    if (!token) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    const payload = verifyToken(token);
    req.user = {
      id: Number(payload.sub),
      email: payload.email
    };
    next();
  } catch {
    res.status(401).json({ error: "invalid token" });
  }
}
