# POS Sync Service

A Node.js/Express service that synchronizes products and loyalty programs between Odoo ERP and a local MySQL database for the POS system.

## Features

- **Automatic Sync**: Scheduled synchronization using cron jobs
- **Manual Sync**: API endpoints for on-demand synchronization
- **Incremental Sync**: Only syncs changed records since last sync
- **Full Sync**: Complete data refresh when needed
- **Product Sync**: Syncs products with prices, categories, and tax rates
- **Loyalty Program Sync**: Supports BOGO and discount programs
- **Promotion Sync**: Syncs percentage and fixed amount promotions
- **Cart Calculator**: API to calculate cart totals with applied discounts
- **RESTful API**: Full REST API for all operations

## Architecture

```
┌──────────────────┐     ┌──────────────────┐     ┌──────────────────┐
│                  │     │                  │     │                  │
│   Odoo ERP       │◄───►│  Sync Service    │◄───►│  MySQL Database  │
│   (Source)       │     │  (Node.js)       │     │  (POS Local)     │
│                  │     │                  │     │                  │
└──────────────────┘     └──────────────────┘     └──────────────────┘
         │                       │                        │
         │                       │                        │
         └───────────────────────┴────────────────────────┘
                                 │
                         ┌───────▼───────┐
                         │               │
                         │   POS System  │
                         │   (React)     │
                         │               │
                         └───────────────┘
```

## Prerequisites

- Node.js >= 18.0.0
- MySQL 8.0+
- Odoo with sync module installed
- Network access between services

## Installation

1. **Clone/Copy the service**:
   ```bash
   cd pos-sync-service
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Configure environment**:
   ```bash
   cp .env.example .env
   # Edit .env with your settings
   ```

4. **Set up MySQL database**:
   ```bash
   # Run the schema from pos_frontend/database/schema.sql
   mysql -u root -p pos_db < schema.sql
   ```

5. **Start the service**:
   ```bash
   # Development mode with auto-reload
   npm run dev
   
   # Production mode
   npm start
   ```

## Configuration

### Environment Variables

```env
# Server
PORT=3001
NODE_ENV=development

# Odoo API - SIMPLIFIED AUTHENTICATION
# Now uses username/password instead of pre-generated token
# The service automatically obtains and refreshes tokens
ODOO_BASE_URL=http://localhost:8069
ODOO_USERNAME=your-username
ODOO_PASSWORD=your-password

# MySQL Database
MYSQL_HOST=localhost
MYSQL_PORT=3306
MYSQL_DATABASE=pos_db
MYSQL_USER=root
MYSQL_PASSWORD=password

# Sync Settings
SYNC_CRON_SCHEDULE=*/5 * * * *  # Every 5 minutes
AUTO_SYNC_ENABLED=true
SYNC_ON_STARTUP=true

# Logging
LOG_LEVEL=info
LOG_FILE=logs/sync.log
```

## API Endpoints

### Sync Operations

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/sync/status` | Get sync status |
| POST | `/api/sync/full` | Trigger full sync |
| POST | `/api/sync/products` | Sync products only |
| POST | `/api/sync/loyalty` | Sync loyalty/promotions only |
| GET | `/api/sync/products/stats` | Get product sync stats |
| GET | `/api/sync/loyalty/stats` | Get loyalty sync stats |
| POST | `/api/sync/cron/start` | Start automatic sync |
| POST | `/api/sync/cron/stop` | Stop automatic sync |

### Data Access

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/data/all` | Get all POS data |
| GET | `/api/data/products` | Get all products |
| GET | `/api/data/products/:barcode` | Get product by barcode |
| GET | `/api/data/products/search/:query` | Search products |
| GET | `/api/data/products/category/:category` | Get by category |
| GET | `/api/data/categories` | Get all categories |
| GET | `/api/data/loyalty` | Get all loyalty programs |
| GET | `/api/data/loyalty/product/:barcode` | Get loyalty for product |
| GET | `/api/data/promotions` | Get all promotions |
| GET | `/api/data/promotions/product/:barcode` | Get promotions for product |
| POST | `/api/data/cart/calculate` | Calculate cart totals |

### Health Check

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | Service health check |
| GET | `/api` | API documentation |

### Odoo Direct Access (Proxy)

These endpoints fetch data directly from Odoo without storing in local database.

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/odoo/health` | Check Odoo API connection |
| GET | `/api/odoo/all` | Get all data from Odoo |
| GET | `/api/odoo/products` | Get all products from Odoo |
| GET | `/api/odoo/products/:barcode` | Get product by barcode from Odoo |
| GET | `/api/odoo/loyalty` | Get all loyalty programs from Odoo |
| GET | `/api/odoo/loyalty/:programId` | Get loyalty program by ID from Odoo |
| GET | `/api/odoo/promotions` | Get all promotions from Odoo |
| GET | `/api/odoo/prices` | Get all product prices from Odoo |

## Usage Examples

### Trigger Full Sync

```bash
curl -X POST http://localhost:3001/api/sync/full
```

### Get Sync Status

```bash
curl http://localhost:3001/api/sync/status
```

### Get All Products

```bash
curl http://localhost:3001/api/data/products
```

### Search Products

```bash
curl http://localhost:3001/api/data/products/search/coffee
```

### Calculate Cart

```bash
curl -X POST http://localhost:3001/api/data/cart/calculate \
  -H "Content-Type: application/json" \
  -d '{
    "items": [
      {"barcode": "1001", "quantity": 3, "price": 2.50},
      {"barcode": "2001", "quantity": 2, "price": 2.50}
    ]
  }'
```

### Get All Data from Odoo (Direct)

```bash
curl http://localhost:3001/api/odoo/all
```

### Get Products from Odoo (Direct)

```bash
curl http://localhost:3001/api/odoo/products
```

### Get Loyalty Programs from Odoo (Direct)

```bash
curl http://localhost:3001/api/odoo/loyalty
```

### Check Odoo Connection

```bash
curl http://localhost:3001/api/odoo/health
```

## Loyalty Program Types

### 1. BOGO (Buy One Get One)

Buy X items, get Y items free.

```json
{
  "type": "BOGO",
  "buy_quantity": 2,
  "free_quantity": 1,
  "product_barcode": "1001"
}
```

### 2. Discount

Percentage discount on products.

```json
{
  "type": "DISCOUNT",
  "discount_percent": 10,
  "min_purchase": 50,
  "product_barcode": null,
  "category": "Beverages"
}
```

### 3. Promotion

Fixed amount or percentage discount.

```json
{
  "discount_type": "PERCENTAGE",
  "discount_value": 15,
  "min_purchase": 100,
  "max_discount": 50
}
```

## Odoo Setup

Add the endpoints from `odoo_endpoints.py` to your existing Odoo module.

### Required Odoo Endpoints

The sync service expects these endpoints on Odoo:

- `GET /api/sync/product` - Incremental product sync
- `GET /api/sync/loyalty` - Incremental loyalty sync
- `POST /api/products/prices` - Get product prices
- `POST /api/loyalty/programs` - Get all loyalty programs

## Database Schema

The service works with these MySQL tables:

- `products` - Product catalog
- `loyalty_programs` - BOGO and discount programs
- `promotions` - Promotional discounts
- `pos_sessions` - POS session management
- `orders` - Order records
- `order_items` - Order line items

## Scripts

```bash
# Run full sync
npm run sync

# Sync products only
npm run sync:products

# Sync loyalty only
npm run sync:loyalty

# Development mode
npm run dev

# Production mode
npm start
```

## Logging

Logs are written to:
- Console (colored output)
- `logs/sync.log` (all logs)
- `logs/error.log` (errors only)

Log levels: `error`, `warn`, `info`, `debug`

## Error Handling

The service handles:
- Network failures (with retry)
- Database connection issues
- Invalid data formats
- Duplicate records
- Missing required fields

## Troubleshooting

### Connection Issues

1. Check Odoo URL and token in `.env`
2. Verify MySQL credentials
3. Check network connectivity
4. Review logs in `logs/` directory

### Sync Failures

1. Check Odoo API responses
2. Verify data format compatibility
3. Check for database constraints
4. Review error logs

### Performance Issues

1. Adjust sync interval in cron schedule
2. Check database indexes
3. Monitor memory usage
4. Consider batch processing for large datasets

## Recent Updates - Simplified Odoo Authentication

### What Changed?

The Odoo API client has been updated to use a **simpler authentication approach**:

#### Before (Old Approach):
- Required pre-generating an API token from Odoo
- Token needed to be manually stored in `.env` file
- No automatic token refresh on expiration
- Used complex JSON-RPC wrapper format for requests

#### After (New Simplified Approach):
- Uses **username and password** authentication
- Automatically obtains authentication token on startup
- **Auto-refreshes token** when it expires (401 errors)
- Simpler, cleaner API requests without JSON-RPC wrapper
- Better error handling and logging
- Token stored in memory (more secure, no manual management)

### Migration Guide

If you're upgrading from the old version:

1. **Update your `.env` file**:
   ```env
   # Remove this:
   # ODOO_API_TOKEN=your-old-token
   
   # Add these instead:
   ODOO_USERNAME=your-odoo-username
   ODOO_PASSWORD=your-odoo-password
   ```

2. **No code changes needed** - The API methods remain the same:
   ```javascript
   await odooApi.getAllProducts();
   await odooApi.getAllLoyaltyPrograms();
   await odooApi.getAllPromotions();
   // etc.
   ```

3. **Benefits you'll get**:
   - No more manual token management
   - Automatic token refresh on expiration
   - Better error messages and logging
   - Simplified debugging

### New Features

- **`odooApi.refreshToken()`** - Manually refresh token if needed
- **`odooApi.getAllData()`** - Fetch all data (products, loyalty, promotions) in parallel
- **`odooApi.getAuthStatus()`** - Check if token is valid and see base URL
- Better logging with ✓ and ✗ symbols for success/failure

## Contributing

1. Fork the repository
2. Create feature branch
3. Make changes
4. Test thoroughly
5. Submit pull request

## License

ISC License
