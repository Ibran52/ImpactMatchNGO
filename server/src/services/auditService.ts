import mongoose from "mongoose";
import { AuditLog } from "../models.js";

type AuditEvent = {
  actorId: string;
  action: string;
  resourceType: string;
  resourceId: string;
  previousStatus?: string;
  newStatus?: string;
  reason?: string;
};

export async function recordAuditEvent(event: AuditEvent): Promise<void> {
  await AuditLog.create({
    actorId: new mongoose.Types.ObjectId(event.actorId),
    action: event.action,
    resourceType: event.resourceType,
    resourceId: event.resourceId,
    previousStatus: event.previousStatus,
    newStatus: event.newStatus,
    reason: event.reason,
    occurredAt: new Date(),
  });
}
