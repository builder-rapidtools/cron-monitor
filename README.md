<div align="center">

<img src="logo.svg" alt="Cron Monitor" width="120" height="120" />

# Cron Monitor

![Cron Monitoring](https://img.shields.io/badge/cron-monitoring-blue)
![License](https://img.shields.io/badge/license-MIT-green)
![Cloudflare Workers](https://img.shields.io/badge/cloudflare-workers-orange)

### Dead-simple cron job monitoring

Ping a URL, get alerted when jobs fail • Self-hosted • Free tier

[Live Demo](https://cron.rapidtools.dev) • [Quick Start](#quick-start) • [Sponsor](#sponsor)

</div>

---

## Why This Exists

Silent cron failures cost companies millions. Healthchecks.io makes $111k/year solving this problem, but most tools are too complex.

**Cron Monitor is stupidly simple:**
1. Add `curl https://cron.rapidtools.dev/ping/YOUR_ID` to your cron job
2. Get alerted if it doesn't run on schedule
3. That's it

## Features

- ✅ **Dead Simple**: One curl command in your cron job
- ✅ **Instant Alerts**: Webhook notifications when jobs fail
- ✅ **Global Edge**: Runs on Cloudflare's network (sub-50ms)
- ✅ **Free Tier**: Monitor up to 5 jobs forever
- ✅ **Self-Hosted**: Deploy your own instance in 2 minutes
- ✅ **Zero Dependencies**: Pure JavaScript, no external services

## Quick Start

### Option 1: Use Hosted Service

1. Go to https://cron.rapidtools.dev
2. Create a monitor
3. Add the ping URL to your cron job:

```bash
# Example: Backup job that runs every hour
0 * * * * /path/to/backup.sh && curl https://cron.rapidtools.dev/ping/abc123
```

### Option 2: Self-Host (2 minutes)

```bash
# Clone repo
git clone https://github.com/builder-rapidtools/cron-monitor
cd cron-monitor

# Install
npm install

# Create D1 database
npx wrangler d1 create cron-monitor-db

# Update wrangler.toml with database_id from above

# Initialize database
npx wrangler d1 execute cron-monitor-db --file=./schema.sql

# Deploy
npm run deploy
```

Your service will be live at: `https://cron-monitor.YOUR-SUBDOMAIN.workers.dev`

## Usage Examples

### Basic Monitoring

```bash
# Create monitor via API
curl -X POST https://cron.rapidtools.dev/api/monitors \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Daily backup",
    "schedule": "1d",
    "grace_seconds": 300
  }'

# Returns: { "id": "abc123", "ping_url": "https://..." }

# Add to cron job
0 2 * * * /backup.sh && curl https://cron.rapidtools.dev/ping/abc123
```

### With Slack Alerts

```bash
# Create monitor with webhook
curl -X POST https://cron.rapidtools.dev/api/monitors \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Hourly sync",
    "schedule": "1h",
    "grace_seconds": 60,
    "alert_webhook": "https://hooks.slack.com/services/YOUR/WEBHOOK/URL"
  }'
```

### Schedule Formats

- `5m` - Every 5 minutes
- `1h` - Every hour
- `12h` - Every 12 hours
- `1d` - Once per day

## API

### Create Monitor

```http
POST /api/monitors
Content-Type: application/json

{
  "name": "Job name",
  "schedule": "1h",
  "grace_seconds": 60,
  "alert_webhook": "https://hooks.slack.com/..."
}
```

### List Monitors

```http
GET /api/monitors
```

### Get Monitor Details

```http
GET /api/monitors/:id
```

### Ping Endpoint

```http
GET /ping/:id
```

### Delete Monitor

```http
DELETE /api/monitors/:id
```

## How It Works

1. **Create Monitor**: Define job name and expected schedule
2. **Ping URL**: Your cron job hits the ping endpoint on success
3. **Background Check**: Scheduled worker checks for missed pings every minute
4. **Alert**: Sends webhook notification if job is late (schedule + grace period)

## Architecture

- **Runtime**: Cloudflare Workers (V8 isolates, global edge network)
- **Database**: Cloudflare D1 (SQLite at the edge)
- **Monitoring**: Scheduled worker runs every minute
- **Alerts**: Webhook POST requests (Slack, Discord, custom)

## Self-Hosting

### Requirements

- Cloudflare account (free tier works)
- Wrangler CLI
- 2 minutes

### Setup

```bash
# 1. Create D1 database
npx wrangler d1 create cron-monitor-db

# 2. Copy database ID to wrangler.toml
# Replace database_id = "TBD" with the ID from step 1

# 3. Initialize schema
npx wrangler d1 execute cron-monitor-db --file=./schema.sql

# 4. Deploy
npx wrangler deploy

# 5. Set up scheduled trigger (optional - for alerts)
# In Cloudflare dashboard: Workers → cron-monitor → Triggers → Add Cron Trigger
# Schedule: */1 * * * * (every minute)
```

### Configuration

Edit `wrangler.toml`:

```toml
[[routes]]
pattern = "cron.yourdomain.com/*"
zone_name = "yourdomain.com"
```

## Pricing

**Hosted Service (cron.rapidtools.dev):**
- Free: 5 monitors
- Pro: $9/month - 20 monitors
- Team: $29/month - 100 monitors + team features

**Self-Hosted (Cloudflare):**
- Free tier: 100k requests/day + 100k D1 reads/day
- Covers most personal/small business use
- $0/month for typical usage

## Why Self-Host?

- Full control over data
- No vendor lock-in
- Unlimited monitors
- Customize alerts and logic
- Learn Cloudflare Workers

## Comparison

| Feature | Cron Monitor | Healthchecks.io | Cronitor |
|---------|--------------|-----------------|----------|
| Free tier | 5 monitors | 20 checks | 5 monitors |
| Self-hosted | ✅ Easy | ✅ Complex | ❌ No |
| Global edge | ✅ Yes | ❌ No | ✅ Yes |
| Setup time | < 1 min | 2-3 min | 2-3 min |
| Open source | ✅ MIT | ✅ BSD | ❌ No |

## Roadmap

- [ ] Email alerts (via Cloudflare Email Workers)
- [ ] SMS alerts (via Twilio integration)
- [ ] Status page generation
- [ ] Uptime percentage tracking
- [ ] Grace period per monitor
- [ ] Multiple alert channels per monitor

## Contributing

PRs welcome! Please open an issue first to discuss changes.

## Sponsor

This project is built and maintained by **RapidTools**. If you find it useful:

- ⭐ Star this repo
- ☕ Support development:
  - [Ko-fi](https://ko-fi.com/rapidtools) - One-time or monthly
  - [Buy Me a Coffee](https://buymeacoffee.com/rapidtools)
  - [GitHub Sponsors](https://github.com/sponsors/builder-rapidtools) (coming soon)
- 🐦 Share it with others

Every contribution helps keep this project maintained and improved!

## License

MIT © RapidTools

---

<div align="center">

**Built by [RapidTools](https://rapidtools.dev)** • Self-hosted tools for developers

[Website](https://rapidtools.dev) • [More Projects](https://github.com/builder-rapidtools) • [Sponsor](https://github.com/sponsors/builder-rapidtools)

</div>
