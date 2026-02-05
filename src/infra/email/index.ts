// src/infra/email/index.ts
import { SmtpEmailProvider } from "./provider";
import { EmailService } from "@/services/email.service";

export const emailService = new EmailService(new SmtpEmailProvider());