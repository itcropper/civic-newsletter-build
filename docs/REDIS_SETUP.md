# Redis Setup Guide

The civic newsletter system uses Redis for per-city story queues. A lightweight managed instance is recommended.

## Recommended: Upstash Redis

1. Go to [upstash.com](https://upstash.com) and sign up (free tier available)
2. Create a new Redis database:
   - Name: `civic-newsletter`
   - Region: US-West-1 (closest to Ashland, OR)
   - Type: Regional (single region is fine for this use case)
3. Copy the connection string from the dashboard — it looks like:
   ```
   rediss://default:YOUR_PASSWORD@usw1-some-id.upstash.io:6379
   ```
4. Add it to your `.env` file as `REDIS_URL`

## Alternative: Railway Redis

1. Go to [railway.app](https://railway.app)
2. Create a new project → Add Redis
3. Copy the `REDIS_URL` from the Variables tab

## How Redis is used

The system uses Redis for one purpose: per-city story queues.

Key pattern: `city:{city_name}:queue`

When a story passes QC (Agent 6 — Verdict), it gets pushed to the city's Redis queue:
```
RPUSH city:Ashland:queue '{"story_id": "uuid-here"}'
```

When the newsletter builder runs (Agent 7), it reads and clears the queue atomically:
```
LRANGE city:Ashland:queue 0 -1  → read all
DEL city:Ashland:queue           → clear after assembly
```

## Verify connectivity

After configuring Redis, you can test with:
```bash
node -e "
import Redis from 'ioredis';
const r = new Redis(process.env.REDIS_URL);
await r.set('test', 'ok');
console.log(await r.get('test'));
await r.del('test');
r.disconnect();
"
```
