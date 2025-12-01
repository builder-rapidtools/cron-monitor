/**
 * Cron Monitor - Dead-simple cron job monitoring
 * Ping a URL, get alerted when jobs fail
 */

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // CORS headers
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    // Routes
    if (url.pathname === '/') {
      return new Response(getDashboardHTML(), {
        headers: { 'Content-Type': 'text/html', ...corsHeaders }
      });
    }

    if (url.pathname.startsWith('/ping/')) {
      return handlePing(request, env, corsHeaders);
    }

    if (url.pathname === '/api/monitors' && request.method === 'POST') {
      return handleCreateMonitor(request, env, corsHeaders);
    }

    if (url.pathname === '/api/monitors' && request.method === 'GET') {
      return handleListMonitors(request, env, corsHeaders);
    }

    if (url.pathname.match(/^\/api\/monitors\/[^\/]+$/)) {
      const monitorId = url.pathname.split('/')[3];
      if (request.method === 'GET') {
        return handleGetMonitor(monitorId, env, corsHeaders);
      }
      if (request.method === 'DELETE') {
        return handleDeleteMonitor(monitorId, env, corsHeaders);
      }
    }

    return new Response('Not Found', { status: 404, headers: corsHeaders });
  },

  // Scheduled job to check for missed pings
  async scheduled(event, env, ctx) {
    await checkMissedPings(env);
  }
};

async function handlePing(request, env, corsHeaders) {
  const url = new URL(request.url);
  const monitorId = url.pathname.split('/')[2];

  if (!monitorId) {
    return new Response('Missing monitor ID', { status: 400, headers: corsHeaders });
  }

  try {
    const now = Date.now();

    // Get monitor
    const monitor = await env.DB.prepare(
      'SELECT * FROM monitors WHERE id = ?'
    ).bind(monitorId).first();

    if (!monitor) {
      return new Response('Monitor not found', { status: 404, headers: corsHeaders });
    }

    // Record ping
    await env.DB.prepare(
      'INSERT INTO pings (monitor_id, timestamp, status) VALUES (?, ?, ?)'
    ).bind(monitorId, now, 'success').run();

    // Update monitor
    await env.DB.prepare(
      'UPDATE monitors SET last_ping = ?, status = ?, failure_count = 0 WHERE id = ?'
    ).bind(now, 'up', monitorId).run();

    return new Response('OK', {
      headers: { 'Content-Type': 'text/plain', ...corsHeaders }
    });
  } catch (error) {
    return new Response(`Error: ${error.message}`, {
      status: 500,
      headers: corsHeaders
    });
  }
}

async function handleCreateMonitor(request, env, corsHeaders) {
  try {
    const body = await request.json();
    const { name, schedule, grace_seconds, alert_email, alert_webhook } = body;

    if (!name || !schedule) {
      return new Response('Missing required fields: name, schedule', {
        status: 400,
        headers: corsHeaders
      });
    }

    // Generate monitor ID
    const monitorId = generateId();
    const now = Date.now();

    // Create monitor
    await env.DB.prepare(`
      INSERT INTO monitors (id, name, schedule, grace_seconds, alert_email, alert_webhook, created_at, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      monitorId,
      name,
      schedule,
      grace_seconds || 60,
      alert_email || null,
      alert_webhook || null,
      now,
      'new'
    ).run();

    const monitor = {
      id: monitorId,
      name,
      schedule,
      grace_seconds: grace_seconds || 60,
      ping_url: `https://${new URL(request.url).host}/ping/${monitorId}`,
      created_at: now,
      status: 'new'
    };

    return new Response(JSON.stringify(monitor), {
      headers: { 'Content-Type': 'application/json', ...corsHeaders }
    });
  } catch (error) {
    return new Response(`Error: ${error.message}`, {
      status: 500,
      headers: corsHeaders
    });
  }
}

async function handleListMonitors(request, env, corsHeaders) {
  try {
    const result = await env.DB.prepare(`
      SELECT id, name, schedule, grace_seconds, created_at, last_ping, status, failure_count
      FROM monitors
      ORDER BY created_at DESC
    `).all();

    const monitors = result.results.map(m => ({
      ...m,
      ping_url: `https://${new URL(request.url).host}/ping/${m.id}`
    }));

    return new Response(JSON.stringify(monitors), {
      headers: { 'Content-Type': 'application/json', ...corsHeaders }
    });
  } catch (error) {
    return new Response(`Error: ${error.message}`, {
      status: 500,
      headers: corsHeaders
    });
  }
}

async function handleGetMonitor(monitorId, env, corsHeaders) {
  try {
    const monitor = await env.DB.prepare(
      'SELECT * FROM monitors WHERE id = ?'
    ).bind(monitorId).first();

    if (!monitor) {
      return new Response('Monitor not found', { status: 404, headers: corsHeaders });
    }

    // Get recent pings
    const pings = await env.DB.prepare(`
      SELECT timestamp, status
      FROM pings
      WHERE monitor_id = ?
      ORDER BY timestamp DESC
      LIMIT 50
    `).bind(monitorId).all();

    return new Response(JSON.stringify({
      ...monitor,
      recent_pings: pings.results
    }), {
      headers: { 'Content-Type': 'application/json', ...corsHeaders }
    });
  } catch (error) {
    return new Response(`Error: ${error.message}`, {
      status: 500,
      headers: corsHeaders
    });
  }
}

async function handleDeleteMonitor(monitorId, env, corsHeaders) {
  try {
    await env.DB.prepare('DELETE FROM pings WHERE monitor_id = ?').bind(monitorId).run();
    await env.DB.prepare('DELETE FROM monitors WHERE id = ?').bind(monitorId).run();

    return new Response('OK', { headers: corsHeaders });
  } catch (error) {
    return new Response(`Error: ${error.message}`, {
      status: 500,
      headers: corsHeaders
    });
  }
}

async function checkMissedPings(env) {
  const now = Date.now();

  // Get all active monitors
  const monitors = await env.DB.prepare(`
    SELECT * FROM monitors WHERE status IN ('up', 'new', 'down')
  `).all();

  for (const monitor of monitors.results) {
    const expectedInterval = parseSchedule(monitor.schedule);
    const graceMs = monitor.grace_seconds * 1000;
    const lastPing = monitor.last_ping || monitor.created_at;
    const timeSinceLastPing = now - lastPing;

    if (timeSinceLastPing > expectedInterval + graceMs) {
      // Monitor is down!
      const newFailureCount = monitor.failure_count + 1;

      await env.DB.prepare(`
        UPDATE monitors SET status = ?, failure_count = ? WHERE id = ?
      `).bind('down', newFailureCount, monitor.id).run();

      // Send alert (if configured)
      if (monitor.alert_email) {
        // TODO: Send email alert
        console.log(`ALERT: Monitor ${monitor.name} is down`);
      }

      if (monitor.alert_webhook) {
        await sendWebhookAlert(monitor);
      }
    }
  }
}

function parseSchedule(schedule) {
  // Parse schedule string to milliseconds
  // Examples: "5m", "1h", "30s"
  const match = schedule.match(/^(\d+)([smhd])$/);
  if (!match) return 3600000; // Default: 1 hour

  const value = parseInt(match[1]);
  const unit = match[2];

  switch (unit) {
    case 's': return value * 1000;
    case 'm': return value * 60 * 1000;
    case 'h': return value * 60 * 60 * 1000;
    case 'd': return value * 24 * 60 * 60 * 1000;
    default: return 3600000;
  }
}

async function sendWebhookAlert(monitor) {
  try {
    await fetch(monitor.alert_webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        monitor_id: monitor.id,
        monitor_name: monitor.name,
        status: 'down',
        last_ping: monitor.last_ping,
        failure_count: monitor.failure_count,
        timestamp: Date.now()
      })
    });
  } catch (error) {
    console.error('Failed to send webhook alert:', error);
  }
}

function generateId() {
  return Math.random().toString(36).substring(2, 15) +
         Math.random().toString(36).substring(2, 15);
}

function getDashboardHTML() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Cron Monitor - Dead-simple cron job monitoring</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: #f9fafb;
      color: #111827;
      line-height: 1.6;
    }
    .container {
      max-width: 1200px;
      margin: 0 auto;
      padding: 20px;
    }
    header {
      background: white;
      border-bottom: 1px solid #e5e7eb;
      padding: 20px;
      margin-bottom: 30px;
    }
    h1 {
      color: #1f2937;
      font-size: 28px;
      font-weight: 700;
    }
    .tagline {
      color: #6b7280;
      font-size: 16px;
      margin-top: 5px;
    }
    .sponsor-banner {
      background: #fffbeb;
      border: 1px solid #fcd34d;
      border-radius: 8px;
      padding: 15px 20px;
      margin-bottom: 30px;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .sponsor-banner a {
      background: #f59e0b;
      color: white;
      padding: 8px 16px;
      border-radius: 6px;
      text-decoration: none;
      font-weight: 600;
    }
    .card {
      background: white;
      border-radius: 8px;
      padding: 24px;
      margin-bottom: 24px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1);
    }
    .card h2 {
      font-size: 20px;
      margin-bottom: 16px;
      color: #1f2937;
    }
    .form-group {
      margin-bottom: 16px;
    }
    label {
      display: block;
      font-weight: 600;
      margin-bottom: 6px;
      color: #374151;
      font-size: 14px;
    }
    input, select {
      width: 100%;
      padding: 10px 12px;
      border: 1px solid #d1d5db;
      border-radius: 6px;
      font-size: 14px;
    }
    button {
      background: #3b82f6;
      color: white;
      padding: 10px 20px;
      border: none;
      border-radius: 6px;
      font-weight: 600;
      cursor: pointer;
      font-size: 14px;
    }
    button:hover {
      background: #2563eb;
    }
    .monitor-list {
      list-style: none;
    }
    .monitor-item {
      padding: 16px;
      border-bottom: 1px solid #e5e7eb;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .monitor-item:last-child {
      border-bottom: none;
    }
    .status {
      display: inline-block;
      padding: 4px 12px;
      border-radius: 12px;
      font-size: 12px;
      font-weight: 600;
    }
    .status.up { background: #d1fae5; color: #065f46; }
    .status.down { background: #fee2e2; color: #991b1b; }
    .status.new { background: #e0e7ff; color: #3730a3; }
    code {
      background: #f3f4f6;
      padding: 2px 6px;
      border-radius: 4px;
      font-size: 13px;
      font-family: 'Monaco', monospace;
    }
    .features {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
      gap: 20px;
      margin: 30px 0;
    }
    .feature {
      text-align: center;
      padding: 20px;
    }
    .feature h3 {
      font-size: 18px;
      margin-bottom: 8px;
    }
    footer {
      text-align: center;
      padding: 40px 20px;
      color: #6b7280;
      font-size: 14px;
    }
  </style>
</head>
<body>
  <header>
    <div class="container">
      <h1>⏰ Cron Monitor</h1>
      <p class="tagline">Dead-simple cron job monitoring. Ping a URL, get alerted when jobs fail.</p>
    </div>
  </header>

  <div class="container">
    <div class="sponsor-banner">
      <span>❤️ <strong>Like this service?</strong> Support via GitHub Sponsors</span>
      <a href="https://github.com/sponsors/builder-rapidtools" target="_blank">Sponsor</a>
    </div>

    <div class="features">
      <div class="feature">
        <h3>✅ Simple Setup</h3>
        <p>Add one curl command to your cron job. That's it.</p>
      </div>
      <div class="feature">
        <h3>🔔 Instant Alerts</h3>
        <p>Get notified immediately when your cron jobs fail.</p>
      </div>
      <div class="feature">
        <h3>🆓 Free Tier</h3>
        <p>Monitor up to 5 jobs for free. Forever.</p>
      </div>
    </div>

    <div class="card">
      <h2>Create Monitor</h2>
      <form id="createForm">
        <div class="form-group">
          <label>Monitor Name</label>
          <input type="text" id="name" placeholder="Daily backup job" required />
        </div>
        <div class="form-group">
          <label>Schedule (how often it runs)</label>
          <input type="text" id="schedule" placeholder="1h (examples: 5m, 1h, 12h, 1d)" required />
        </div>
        <div class="form-group">
          <label>Grace Period (seconds)</label>
          <input type="number" id="grace" value="60" />
        </div>
        <div class="form-group">
          <label>Alert Webhook URL (optional)</label>
          <input type="url" id="webhook" placeholder="https://hooks.slack.com/..." />
        </div>
        <button type="submit">Create Monitor</button>
      </form>
    </div>

    <div class="card">
      <h2>Your Monitors</h2>
      <ul class="monitor-list" id="monitorList">
        <li style="text-align: center; color: #6b7280; padding: 40px;">
          Loading monitors...
        </li>
      </ul>
    </div>

    <div class="card">
      <h2>How It Works</h2>
      <ol style="padding-left: 20px;">
        <li>Create a monitor above</li>
        <li>Add the ping URL to your cron job:<br><code>curl https://cron.rapidtools.dev/ping/YOUR_MONITOR_ID</code></li>
        <li>Get alerted if your job doesn't run on schedule</li>
      </ol>
    </div>
  </div>

  <footer>
    <p>Built by <a href="https://rapidtools.dev">RapidTools</a> |
       <a href="https://github.com/builder-rapidtools/cron-monitor">Open Source</a> |
       <a href="https://github.com/sponsors/builder-rapidtools">Sponsor</a>
    </p>
  </footer>

  <script>
    const API_BASE = '';

    async function loadMonitors() {
      try {
        const res = await fetch('/api/monitors');
        const monitors = await res.json();

        const list = document.getElementById('monitorList');
        if (monitors.length === 0) {
          list.innerHTML = '<li style="text-align: center; color: #6b7280; padding: 40px;">No monitors yet. Create one above!</li>';
          return;
        }

        list.innerHTML = monitors.map(m => \`
          <li class="monitor-item">
            <div>
              <strong>\${m.name}</strong><br>
              <small style="color: #6b7280;">Schedule: \${m.schedule} | Ping: <code>\${m.ping_url}</code></small>
            </div>
            <span class="status \${m.status}">\${m.status.toUpperCase()}</span>
          </li>
        \`).join('');
      } catch (error) {
        console.error('Failed to load monitors:', error);
      }
    }

    document.getElementById('createForm').addEventListener('submit', async (e) => {
      e.preventDefault();

      const monitor = {
        name: document.getElementById('name').value,
        schedule: document.getElementById('schedule').value,
        grace_seconds: parseInt(document.getElementById('grace').value),
        alert_webhook: document.getElementById('webhook').value || null
      };

      try {
        const res = await fetch('/api/monitors', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(monitor)
        });

        const created = await res.json();
        alert('Monitor created!\\n\\nPing URL: ' + created.ping_url + '\\n\\nAdd this to your cron job');

        e.target.reset();
        loadMonitors();
      } catch (error) {
        alert('Failed to create monitor: ' + error.message);
      }
    });

    loadMonitors();
  </script>
</body>
</html>`;
}
