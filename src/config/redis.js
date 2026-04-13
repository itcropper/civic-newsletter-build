import Redis from 'ioredis';
import dotenv from 'dotenv';
dotenv.config();

let redis = null;

export function getRedis() {
  if (!redis) {
    redis = new Redis(process.env.REDIS_URL, {
      maxRetriesPerRequest: 3,
      retryStrategy(times) {
        return Math.min(times * 200, 2000);
      }
    });
  }
  return redis;
}

/**
 * Redis key helpers — all namespaced by city
 */
export const keys = {
  queue: (cityName) => `city:${cityName}:queue`,
  lock: (cityName, job) => `city:${cityName}:lock:${job}`,
  lastRun: (cityName) => `city:${cityName}:last_run`,
};
