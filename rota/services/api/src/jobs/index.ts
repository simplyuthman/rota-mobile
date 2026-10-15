/**
 * =============================================================================
 * Rota API — BullMQ Jobs & Repeatable Workers Stub
 * =============================================================================
 * AGENTS.md §2.1 & §4 (L-01, L-02):
 * Heavy or unreliable work runs in BullMQ on Redis instance #2 (queue instance).
 * Notification jobs in the DB are the source of truth; BullMQ executes.
 */

export interface JobDefinition<T = unknown> {
  name: string;
  data: T;
}

export class JobQueue {
  async enqueue<T>(_queueName: string, _job: JobDefinition<T>): Promise<void> {
    // Stub for Phase 6 (notifications) and Phase 7 (webhooks/billing)
  }
}

export const jobQueue = new JobQueue();
