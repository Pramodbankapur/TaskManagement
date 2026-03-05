import { Router } from "express";
import { z } from "zod";
import { db } from "../db.js";
import { sendEmail } from "../lib/mailer.js";
import { sendSms, sendWhatsApp } from "../lib/messenger.js";
import { logAudit } from "../lib/audit.js";
import type { ComplaintPriority } from "../types/models.js";

const complaintSchema = z.object({
  organizationName: z.string().min(2),
  contactName: z.string().min(2),
  email: z.string().email(),
  phone: z.string().min(7),
  description: z.string().min(10)
});

const googleComplaintSchema = complaintSchema.extend({
  secret: z.string().min(8)
});

export const publicRouter = Router();

async function createComplaint(input: {
  organizationName: string;
  contactName: string;
  email: string;
  phone: string;
  description: string;
  priority?: ComplaintPriority;
  attachmentPath?: string | null;
}): Promise<number> {
  const clientResult = await db
    .prepare("INSERT INTO clients (name, organization_name, contact_name, email, phone) VALUES (?, ?, ?, ?, ?)")
    .run(
      `${input.organizationName} - ${input.contactName}`,
      input.organizationName,
      input.contactName,
      input.email,
      input.phone
    );

  const complaintResult = await db
    .prepare(
      "INSERT INTO complaints (client_id, description, priority, status, attachment_path) VALUES (?, ?, ?, 'OPEN', ?)"
    )
    .run(clientResult.lastInsertRowid, input.description, input.priority || "MEDIUM", input.attachmentPath || null);

  return Number(complaintResult.lastInsertRowid);
}

publicRouter.post("/complaints", async (req, res) => {
  const parsed = complaintSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input" });
    return;
  }

  const { organizationName, contactName, email, phone, description } = parsed.data;

  const complaintId = await createComplaint({
    organizationName,
    contactName,
    email,
    phone,
    description
  });

  const clientDisplayName = `${organizationName} (${contactName})`;

  const owner = await db.prepare("SELECT id, email FROM users WHERE role = 'OWNER' LIMIT 1").get() as
    | { id: number; email: string }
    | undefined;
  const managers = await db.prepare("SELECT id FROM users WHERE role = 'MANAGER'").all() as Array<{ id: number }>;

  if (owner) {
    await sendEmail(
      "New client complaint received",
      owner.email,
      `Complaint #${complaintId} from ${clientDisplayName}: ${description}`
    );
  }

  if (owner?.id) {
    const ownerPhone = await db.prepare("SELECT phone FROM users WHERE id = ?").get(owner.id) as { phone?: string } | undefined;
    if (ownerPhone?.phone) {
      await sendSms(ownerPhone.phone, `New complaint #${complaintId} from ${clientDisplayName}`);
      await sendWhatsApp(ownerPhone.phone, `New complaint #${complaintId} from ${clientDisplayName}.`);
    }

    await db
      .prepare("INSERT INTO notifications (user_id, message) VALUES (?, ?)")
      .run(owner.id, `New complaint #${complaintId} received from ${clientDisplayName}`);
  }

  if (managers.length > 0) {
    for (const manager of managers) {
      await db
        .prepare("INSERT INTO notifications (user_id, message) VALUES (?, ?)")
        .run(manager.id, `New complaint #${complaintId} received from ${clientDisplayName}`);
    }
  }

  await logAudit({
    entityType: "complaint",
    entityId: complaintId,
    action: "complaint_created_public",
    details: { organizationName, contactName, email, phone }
  });

  res.status(201).json({ success: true, complaintId });
});

publicRouter.post("/google-form", async (req, res) => {
  const parsed = googleComplaintSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input" });
    return;
  }

  const configuredSecret = process.env.GOOGLE_FORM_SHARED_SECRET;
  if (!configuredSecret || parsed.data.secret !== configuredSecret) {
    res.status(401).json({ error: "Unauthorized integration secret" });
    return;
  }

  const complaintId = await createComplaint({
    organizationName: parsed.data.organizationName,
    contactName: parsed.data.contactName,
    email: parsed.data.email,
    phone: parsed.data.phone,
    description: parsed.data.description
  });

  const clientDisplayName = `${parsed.data.organizationName} (${parsed.data.contactName})`;
  const owner = await db.prepare("SELECT id, email FROM users WHERE role = 'OWNER' LIMIT 1").get() as
    | { id: number; email: string }
    | undefined;
  const managers = await db.prepare("SELECT id FROM users WHERE role = 'MANAGER'").all() as Array<{ id: number }>;

  if (owner?.id) {
    await db
      .prepare("INSERT INTO notifications (user_id, message) VALUES (?, ?)")
      .run(owner.id, `New complaint #${complaintId} received from ${clientDisplayName} (Google Form)`);
  }

  if (managers.length > 0) {
    for (const manager of managers) {
      await db
        .prepare("INSERT INTO notifications (user_id, message) VALUES (?, ?)")
        .run(manager.id, `New complaint #${complaintId} received from ${clientDisplayName} (Google Form)`);
    }
  }

  await logAudit({
    entityType: "complaint",
    entityId: complaintId,
    action: "complaint_created_google_form",
    details: {
      organizationName: parsed.data.organizationName,
      contactName: parsed.data.contactName,
      email: parsed.data.email
    }
  });

  res.status(201).json({ success: true, complaintId });
});
