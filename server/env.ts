import { existsSync } from "node:fs";

if (existsSync(".env") && typeof process.loadEnvFile === "function") process.loadEnvFile(".env");

const isProd = process.env.NODE_ENV === "production";

export const env = {
  isProd,
  isTest: process.env.NODE_ENV === "test" || !!process.env.VITEST,
  port: Number(process.env.PORT ?? 3000),
  databaseUrl: process.env.DATABASE_URL ?? "postgresql://monkey:monkey@localhost:5432/monkeytype",
  appUrl: (process.env.APP_URL ?? "http://localhost:5173").replace(/\/$/, ""),
  smtpUrl: process.env.SMTP_URL || "",
  mailFrom: process.env.MAIL_FROM || "Monkeytype <no-reply@example.com>",
};
