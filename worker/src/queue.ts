import { Queue } from "bullmq";
import { requiredEnv } from "@/lib/server/env";

export const OMR_QUEUE_NAME = "omr";

let queue: Queue | null = null;

export function getRedisConnection() {
  const url = new URL(requiredEnv("REDIS_URL"));
  return {
    host: url.hostname,
    port: url.port ? Number(url.port) : 6379,
    username: url.username || undefined,
    password: url.password || undefined,
    tls: url.protocol === "rediss:" ? {} : undefined,
    maxRetriesPerRequest: null
  };
}

export function getOmrQueue(): Queue {
  if (!queue) {
    queue = new Queue(OMR_QUEUE_NAME, { connection: getRedisConnection() });
  }
  return queue;
}
