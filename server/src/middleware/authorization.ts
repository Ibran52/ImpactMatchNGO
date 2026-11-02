import type { NextFunction, Request, Response } from "express";
import type { Role } from "../types/domain.js";

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ message: "Please sign in to continue." });
    return;
  }
  next();
}

export function requireRole(...roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user || !roles.includes(req.user.role)) {
      res.status(403).json({ message: "You don’t have permission to do that." });
      return;
    }
    next();
  };
}

export function requireResourceOwnerOrRole(
  getOwnerId: (req: Request) => Promise<string | null>,
  ...allowedRoles: Role[]
) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!req.user) {
      res.status(401).json({ message: "Please sign in to continue." });
      return;
    }
    if (allowedRoles.includes(req.user.role)) {
      next();
      return;
    }
    const ownerId = await getOwnerId(req);
    if (ownerId !== req.user.id) {
      res.status(403).json({ message: "You don’t have permission to access this resource." });
      return;
    }
    next();
  };
}
