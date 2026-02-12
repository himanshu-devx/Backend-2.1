import { ZeptoMailEmailProvider } from "./provider";
import { EmailService } from "@/services/email.service";

export const emailService = new EmailService(new ZeptoMailEmailProvider());
