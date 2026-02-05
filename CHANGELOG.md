# Changelog

All notable changes to the POS Sync Service will be documented in this file.

## [2.0.0] - 2024 - Simplified Odoo Authentication

### 🎉 Major Changes

#### Simplified Authentication System
- **BREAKING**: Replaced token-based auth with username/password authentication
- Authentication token is now automatically obtained and managed
- Auto-refresh mechanism for expired tokens (401 errors)
- No more manual token generation or management required

### ✨ New Features

#### Enhanced odooApi Methods
- **`getAllData()`** - Fetch products, loyalty programs, and promotions in parallel
- **`refreshToken()`** - Manually refresh authentication token
- **`getAuthStatus()`** - Check current authentication status

#### Improved Request Handling
- Removed JSON-RPC wrapper for cleaner API requests
- Changed from POST to GET for read-only endpoints (better HTTP semantics)
- Automatic token retry logic on 401 unauthorized errors
- Better error logging with detailed context

#### Developer Experience
- Better log messages with ✓ (success) and ✗ (failure) symbols
- More informative error messages
- Token initialization on module load
- Graceful degradation if initial token fetch fails

### 🔧 Technical Improvements

#### Code Quality
- Simplified `odooClient.js` from ~220 lines to ~300 lines (with more features)
- Removed axios interceptors in favor of explicit request handling
- Better separation of concerns
- More consistent error handling

#### Performance
- Parallel requests support via `Promise.all()`
- Reduced network overhead by removing JSON-RPC wrapper
- In-memory token caching

### 📝 Configuration Changes

#### Environment Variables
```diff
# Old configuration
- ODOO_API_TOKEN=your-token-here

# New configuration
+ ODOO_USERNAME=your-username
+ ODOO_PASSWORD=your-password
```

### 🔄 Migration Path

For existing deployments:

1. Update `.env` file with `ODOO_USERNAME` and `ODOO_PASSWORD`
2. Remove `ODOO_API_TOKEN` from `.env`
3. Restart the service
4. No code changes required - all existing API methods work the same

### 📚 API Compatibility

All existing API methods remain unchanged:
- ✅ `getAllProducts()`
- ✅ `getProductsSync()`
- ✅ `getProductPrices()`
- ✅ `getAllLoyaltyPrograms()`
- ✅ `getLoyaltySync()`
- ✅ `getLoyaltyProgramById(id)`
- ✅ `getAllPromotions()`
- ✅ `testConnection()`

### 🐛 Bug Fixes
- Fixed token expiration handling (now auto-refreshes)
- Better error messages when Odoo is unreachable
- Improved timeout handling

### 🔒 Security Improvements
- Token stored only in memory (not in environment variables)
- Token automatically refreshed when expired
- Credentials only used during authentication

---

## [1.0.0] - Previous Version

### Features
- Product synchronization
- Loyalty program synchronization
- Promotion synchronization
- Scheduled sync via cron
- Manual sync endpoints
- Cart calculation API
- MySQL database integration
