import nodemailer from "nodemailer";

/**
 * Envio de e-mail via SMTP do Gmail (senha de app). OPCIONAL: sem `GMAIL_USER` e
 * `GMAIL_APP_PASSWORD` é no-op (como a IA sem chaves e o ntfy sem tópico). O destino é
 * `EMAIL_TO`, com `LEILOESBR_EMAIL` (o único e-mail autorizado no app) como padrão.
 */
export function emailEnabled(): boolean {
  return Boolean(process.env["GMAIL_USER"] && process.env["GMAIL_APP_PASSWORD"]);
}

/** Escapa texto para interpolar em HTML de e-mail. */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

let transport: nodemailer.Transporter | null = null;

function getTransport(): nodemailer.Transporter {
  transport ??= nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: { user: process.env["GMAIL_USER"], pass: process.env["GMAIL_APP_PASSWORD"] },
    connectionTimeout: 15_000,
    socketTimeout: 30_000,
  });
  return transport;
}

/** Envia um e-mail (texto + HTML). Lança em falha de SMTP; o chamador decide se é best-effort. */
export async function sendEmail(msg: {
  subject: string;
  text: string;
  html: string;
}): Promise<void> {
  const to = process.env["EMAIL_TO"] || process.env["LEILOESBR_EMAIL"];
  if (!to) throw new Error("defina EMAIL_TO (ou LEILOESBR_EMAIL) para enviar e-mail");
  await getTransport().sendMail({
    from: `Garimpo de Vinil <${process.env["GMAIL_USER"]}>`,
    to,
    subject: msg.subject,
    text: msg.text,
    html: msg.html,
  });
}
