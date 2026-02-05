import { WebhookWorkflow } from "./webhook.workflow";

export class WebhookService {
    private workflow: WebhookWorkflow;
    constructor() {
        this.workflow = new WebhookWorkflow();
    }
    async processWebhook(type: "PAYIN" | "PAYOUT", providerId: string, legalEntityId: string, payload: any) {
        return this.workflow.execute(type, providerId, legalEntityId, payload);
    }
}

export const webhookService = new WebhookService();
