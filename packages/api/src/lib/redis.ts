import Redis from "ioredis";
import { config } from "../config";

export const redis = new Redis(config.redisUrl, { maxRetriesPerRequest: null, lazyConnect: false });

/** Separate connection for pub/sub — ioredis puts a client in subscriber mode exclusively once subscribed. */
export const redisSub = new Redis(config.redisUrl, { maxRetriesPerRequest: null, lazyConnect: false });
