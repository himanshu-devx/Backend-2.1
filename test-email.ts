import { MailerSend, EmailParams, Sender, Recipient } from "mailersend";
import dotenv from "dotenv";

dotenv.config();

const MAILERSEND_API_KEY = process.env.MAILERSEND_API_KEY;
const MAILERSEND_FROM_EMAIL = process.env.MAILERSEND_FROM_EMAIL;
const MAILERSEND_FROM_NAME = process.env.MAILERSEND_FROM_NAME || "Wisipay Test";

async function testEmail() {
    if (!MAILERSEND_API_KEY || !MAILERSEND_FROM_EMAIL) {
        console.error("Missing MAILERSEND_API_KEY or MAILERSEND_FROM_EMAIL in .env");
        return;
    }

    const mailersend = new MailerSend({ apiKey: MAILERSEND_API_KEY });
    const sentFrom = new Sender(MAILERSEND_FROM_EMAIL, MAILERSEND_FROM_NAME);
    const recipients = [new Recipient(MAILERSEND_FROM_EMAIL, "Self Test")];

    const emailParams = new EmailParams()
        .setFrom(sentFrom)
        .setTo(recipients)
        .setReplyTo(sentFrom)
        .setSubject("Wisipay Email Test")
        .setHtml("<strong>Email service is working correctly!</strong>")
        .setText("Email service is working correctly!");

    try {
        console.log("Attempting to send test email to:", MAILERSEND_FROM_EMAIL);
        const result = await mailersend.email.send(emailParams);
        console.log("Test email sent success:", JSON.stringify(result, null, 2));
    } catch (error: any) {
        console.error("Test email failed:");
        console.error(error.message);
        if (error.body) {
            console.error(JSON.stringify(error.body, null, 2));
        }
    }
}

testEmail();
