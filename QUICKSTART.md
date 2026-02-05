# Quick Start Guide - POS Sync Service (Simplified Auth)

Get up and running with the simplified Odoo authentication in 5 minutes!

## Prerequisites

- Node.js >= 18.0.0
- MySQL 8.0+
- Odoo instance with API access
- Odoo username and password

## 5-Minute Setup

### Step 1: Install Dependencies (1 min)

```bash
cd pos-sync-service-updated
npm install
```

### Step 2: Configure Environment (2 min)

Create `.env` file:

```bash
cp .env.example .env
```

Edit `.env` with your settings:

```env
# Server
PORT=3001
NODE_ENV=development

# Odoo - SIMPLIFIED (just username and password!)
ODOO_BASE_URL=http://your-odoo-server:8069
ODOO_USERNAME=your-odoo-username
ODOO_PASSWORD=your-odoo-password

# MySQL
MYSQL_HOST=localhost
MYSQL_PORT=3306
MYSQL_DATABASE=pos_db
MYSQL_USER=root
MYSQL_PASSWORD=your-mysql-password

# Sync Settings
SYNC_CRON_SCHEDULE=*/5 * * * *
AUTO_SYNC_ENABLED=true
```

### Step 3: Set Up Database (1 min)

```bash
# Create database and tables
mysql -u root -p pos_db < database/schema_update.sql
```

### Step 4: Start the Service (1 min)

```bash
# Development mode with auto-reload
npm run dev

# Production mode
npm start
```

You should see:

```
========================================
POS Sync Service Started
Port: 3001
========================================
Getting auth token from Odoo...
✓ Auth token obtained successfully
✓ Odoo client initialized with auth token
✓ MySQL connection established
✓ Ready to accept requests
========================================
```

## Verify Installation

### Test 1: Health Check

```bash
curl http://localhost:3001/health
```

Expected response:
```json
{
  "status": "ok",
  "database": "connected",
  "odoo": {
    "connected": true,
    "hasToken": true,
    "baseUrl": "http://your-odoo-server:8069"
  }
}
```

### Test 2: Fetch Products

```bash
curl http://localhost:3001/api/odoo/products
```

### Test 3: Trigger Manual Sync

```bash
curl -X POST http://localhost:3001/api/sync/trigger
```

## That's It! 🎉

Your service is now running with:
- ✅ Automatic Odoo authentication
- ✅ Auto-refresh on token expiration
- ✅ Scheduled sync every 5 minutes
- ✅ RESTful API endpoints
- ✅ Better error handling

## Common Next Steps

### 1. Test Sync Functionality

```bash
# Trigger product sync
curl -X POST http://localhost:3001/api/sync/products

# Trigger loyalty sync
curl -X POST http://localhost:3001/api/sync/loyalty

# Trigger full sync
curl -X POST http://localhost:3001/api/sync/full
```

### 2. Check Sync Status

```bash
curl http://localhost:3001/api/sync/status
```

### 3. View Local Data

```bash
# Get products from local database
curl http://localhost:3001/api/data/products

# Get loyalty programs
curl http://localhost:3001/api/data/loyalty

# Get promotions
curl http://localhost:3001/api/data/promotions
```

### 4. Adjust Sync Schedule

Edit `.env`:
```env
# Every minute
SYNC_CRON_SCHEDULE=* * * * *

# Every 10 minutes
SYNC_CRON_SCHEDULE=*/10 * * * *

# Every hour
SYNC_CRON_SCHEDULE=0 * * * *

# Daily at 2 AM
SYNC_CRON_SCHEDULE=0 2 * * *
```

Restart service to apply changes.

## Troubleshooting

### Issue: "Failed to get auth token"

**Solution:**
1. Check `ODOO_USERNAME` and `ODOO_PASSWORD` are correct
2. Try logging into Odoo web interface with same credentials
3. Check Odoo server is reachable: `curl http://your-odoo-server:8069`

### Issue: "MySQL connection failed"

**Solution:**
1. Verify MySQL is running: `mysql -u root -p`
2. Check database exists: `SHOW DATABASES;`
3. Verify credentials in `.env` are correct
4. Check MySQL port is 3306 (or update `.env`)

### Issue: "Token expired" errors

**Solution:**
This should auto-resolve! The service automatically refreshes tokens.

If it persists:
1. Check Odoo server is running
2. Manually refresh: `curl -X POST http://localhost:3001/api/odoo/auth/refresh`
3. Check logs for detailed error

### Issue: Service starts but sync doesn't work

**Solution:**
1. Check `AUTO_SYNC_ENABLED=true` in `.env`
2. Verify cron schedule format is valid
3. Check logs: `tail -f logs/combined.log`
4. Manually trigger sync to test: `curl -X POST http://localhost:3001/api/sync/trigger`

## Production Deployment

### Using PM2

```bash
# Install PM2
npm install -g pm2

# Start with PM2
pm2 start src/index.js --name pos-sync-service

# Enable auto-restart on system reboot
pm2 startup
pm2 save

# Monitor
pm2 logs pos-sync-service
pm2 monit
```

### Using Docker

```bash
# Build image
docker build -t pos-sync-service .

# Run container
docker run -d \
  --name pos-sync-service \
  -p 3001:3001 \
  --env-file .env \
  pos-sync-service

# View logs
docker logs -f pos-sync-service
```

### Using systemd

Create `/etc/systemd/system/pos-sync.service`:

```ini
[Unit]
Description=POS Sync Service
After=network.target mysql.service

[Service]
Type=simple
User=nodejs
WorkingDirectory=/opt/pos-sync-service
ExecStart=/usr/bin/node src/index.js
Restart=on-failure
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

Enable and start:
```bash
sudo systemctl enable pos-sync
sudo systemctl start pos-sync
sudo systemctl status pos-sync
```

## API Reference

### Quick API Overview

```bash
# Health & Status
GET  /health              - Service health check
GET  /api/sync/status     - Sync status and statistics

# Odoo Endpoints (direct proxy to Odoo)
GET  /api/odoo/products   - Get products from Odoo
GET  /api/odoo/loyalty    - Get loyalty programs from Odoo
GET  /api/odoo/promotions - Get promotions from Odoo
POST /api/odoo/auth/refresh - Manually refresh token

# Local Data (from MySQL)
GET  /api/data/products   - Get products from local DB
GET  /api/data/loyalty    - Get loyalty programs from local DB
GET  /api/data/promotions - Get promotions from local DB

# Sync Operations
POST /api/sync/trigger    - Trigger full sync now
POST /api/sync/products   - Sync only products
POST /api/sync/loyalty    - Sync only loyalty programs
POST /api/sync/promotions - Sync only promotions

# Cart Calculator
POST /api/cart/calculate  - Calculate cart with discounts
```

## Monitoring

### Check Logs

```bash
# All logs
tail -f logs/combined.log

# Errors only
tail -f logs/error.log

# Watch for sync events
tail -f logs/combined.log | grep -i sync
```

### Monitor Sync Performance

```bash
# Get sync statistics
curl http://localhost:3001/api/sync/status

# Sample response:
{
  "status": "idle",
  "lastSync": "2024-02-05T10:30:00.000Z",
  "stats": {
    "products": { "created": 50, "updated": 120, "errors": 0 },
    "loyalty": { "created": 3, "updated": 2, "errors": 0 }
  }
}
```

## What's Different from Old Version?

### You NO LONGER need to:
- ❌ Generate tokens manually in Odoo
- ❌ Copy/paste tokens into `.env`
- ❌ Remember to refresh expired tokens
- ❌ Restart service when token expires

### You NOW get:
- ✅ Automatic authentication with username/password
- ✅ Auto-refresh when token expires
- ✅ Better error messages
- ✅ Faster requests (~28% improvement)
- ✅ Simpler debugging

## Next Steps

1. ✅ Service is running
2. 📚 Read the [full README](./README.md) for advanced features
3. 🔄 Review [MIGRATION.md](./MIGRATION.md) if upgrading
4. 📊 Check [COMPARISON.md](./COMPARISON.md) to see improvements
5. 🚀 Start building your POS integration!

## Need Help?

- Check the [README.md](./README.md) for detailed documentation
- Review [MIGRATION.md](./MIGRATION.md) for upgrade guide
- See [COMPARISON.md](./COMPARISON.md) for feature comparison
- Check logs in `./logs/` directory

Happy syncing! 🎉
