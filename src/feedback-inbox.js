import { DurableObject } from "cloudflare:workers";
import { commitFeedback } from "./feedback.js";

export class FeedbackInbox extends DurableObject {
  async save(record) {
    return commitFeedback(this.env, record);
  }
}
