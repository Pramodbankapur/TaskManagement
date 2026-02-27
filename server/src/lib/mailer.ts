import nodemailer from "nodemailer";

const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM, EMAIL_MODE } = process.env;

const canSendEmail = Boolean(SMTP_HOST && SMTP_USER && SMTP_PASS);

let cachedTransporter: nodemailer.Transporter | null = null;
let transportMode: "SMTP" | "ETHEREAL" | "SIMULATED" = "SIMULATED";
let lastEmailDebug: { to: string; subject: string; mode: string; previewUrl?: string | null; at: string } | null = null;

async function getTransporter(): Promise<nodemailer.Transporter | null> {
  if (cachedTransporter) return cachedTransporter;

  if (canSendEmail) {
    transportMode = "SMTP";
    cachedTransporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: Number(SMTP_PORT || 587),
      secure: false,
      auth: { user: SMTP_USER, pass: SMTP_PASS }
    });
    return cachedTransporter;
  }

  if (EMAIL_MODE === "SIMULATED") {
    transportMode = "SIMULATED";
    return null;
  }

  // Free testing mode with inbox preview links.
  const account = await nodemailer.createTestAccount();
  transportMode = "ETHEREAL";
  cachedTransporter = nodemailer.createTransport({
    host: "smtp.ethereal.email",
    port: 587,
    secure: false,
    auth: { user: account.user, pass: account.pass }
  });
  return cachedTransporter;
}

export async function sendEmail(subject: string, to: string, text: string): Promise<void> {
  const overrideTo = process.env.MAIL_OVERRIDE_TO?.trim();
  const targetTo = overrideTo ? overrideTo : to;
  const finalSubject = overrideTo ? `[TEST-OVERRIDE for ${to}] ${subject}` : subject;
  const finalText =
    overrideTo
      ? `Original recipient: ${to}\n\n${text}`
      : text;

  const transporter = await getTransporter();
  if (!transporter) {
    console.log(`[email-simulated] to=${targetTo} subject=${finalSubject} text=${finalText}`);
    lastEmailDebug = { to: targetTo, subject: finalSubject, mode: "SIMULATED", at: new Date().toISOString(), previewUrl: null };
    return;
  }

  const info = await transporter.sendMail({
    from: SMTP_FROM || "noreply@example.com",
    to: targetTo,
    subject: finalSubject,
    text: finalText
  });

  if (transportMode === "ETHEREAL") {
    const preview = nodemailer.getTestMessageUrl(info);
    lastEmailDebug = {
      to: targetTo,
      subject: finalSubject,
      mode: "ETHEREAL",
      previewUrl: typeof preview === "string" ? preview : null,
      at: new Date().toISOString()
    };
    console.log(`[email-ethereal] to=${targetTo} preview=${preview || "not_available"}`);
  } else {
    lastEmailDebug = { to: targetTo, subject: finalSubject, mode: "SMTP", previewUrl: null, at: new Date().toISOString() };
  }
}

export function getMailerDebug() {
  return {
    mode: transportMode,
    lastEmail: lastEmailDebug
  };
}
