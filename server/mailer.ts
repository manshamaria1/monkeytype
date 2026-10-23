import nodemailer from "nodemailer";
import { env } from "./env";

export interface Mail {
  to: string;
  subject: string;
  text: string;
}

export interface Mailer {
  send(mail: Mail): Promise<void>;
  /** Last messages, kept only for the log mailer (used by tests). */
  outbox?: Mail[];
}

/** Without SMTP configured, emails are printed to the server log (development only). */
export function createMailer(): Mailer {
  if (env.smtpUrl) {
    const transport = nodemailer.createTransport(env.smtpUrl);
    return {
      async send(mail) {
        await transport.sendMail({ from: env.mailFrom, ...mail });
      },
    };
  }
  const outbox: Mail[] = [];
  return {
    outbox,
    async send(mail) {
      outbox.push(mail);
      if (outbox.length > 50) outbox.shift();
      if (!env.isTest) console.log(`[mail:log] to=${mail.to} subject="${mail.subject}"\n${mail.text}\n`);
    },
  };
}
