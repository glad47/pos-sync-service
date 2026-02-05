/**
 * POS Sync Service
 * Express.js server that syncs data between Odoo and local MySQL database
 */

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const logger = require('./utils/logger');
const syncOrchestrator = require('./services/syncOrchestrator');

// Import routes
const syncRoutes = require('./routes/syncRoutes');
const dataRoutes = require('./routes/dataRoutes');
const odooRoutes = require('./routes/odooRoutes');

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors({
    origin: process.env.CORS_ORIGIN || '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request logging middleware
app.use((req, res, next) => {
    logger.debug(`${req.method} ${req.path}`);
    next();
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        service: 'pos-sync-service',
        timestamp: new Date().toISOString()
    });
});

// API info endpoint
app.get('/api', (req, res) => {
    res.json({
        name: 'POS Sync Service API',
        version: '1.0.0',
        description: 'Sync service between Odoo and POS MySQL database',
        endpoints: {
            sync: {
                'GET /api/sync/status': 'Get sync status',
                'POST /api/sync/full': 'Trigger full sync',
                'POST /api/sync/products': 'Sync products only',
                'POST /api/sync/loyalty': 'Sync loyalty programs only',
                'GET /api/sync/products/stats': 'Get product sync stats',
                'GET /api/sync/loyalty/stats': 'Get loyalty sync stats',
                'POST /api/sync/cron/start': 'Start automatic sync',
                'POST /api/sync/cron/stop': 'Stop automatic sync'
            },
            data: {
                'GET /api/data/all': 'Get all POS data',
                'GET /api/data/products': 'Get all products',
                'GET /api/data/products/:barcode': 'Get product by barcode',
                'GET /api/data/products/search/:query': 'Search products',
                'GET /api/data/products/category/:category': 'Get products by category',
                'GET /api/data/categories': 'Get all categories',
                'GET /api/data/loyalty': 'Get all loyalty programs',
                'GET /api/data/loyalty/product/:barcode': 'Get loyalty for product',
                'GET /api/data/promotions': 'Get all promotions',
                'GET /api/data/promotions/product/:barcode': 'Get promotions for product',
                'POST /api/data/cart/calculate': 'Calculate cart with discounts'
            },
            odoo: {
                'GET /api/odoo/health': 'Check Odoo API connection health',
                'GET /api/odoo/all': 'Get all data from Odoo (products, loyalty, promotions)',
                'GET /api/odoo/products': 'Get all products directly from Odoo',
                'GET /api/odoo/products/:barcode': 'Get product by barcode from Odoo',
                'GET /api/odoo/loyalty': 'Get all loyalty programs from Odoo',
                'GET /api/odoo/loyalty/:programId': 'Get loyalty program by ID from Odoo',
                'GET /api/odoo/promotions': 'Get all promotions from Odoo',
                'GET /api/odoo/prices': 'Get all product prices from Odoo'
            }
        }
    });
});

// Mount routes
app.use('/api/sync', syncRoutes);
app.use('/api/data', dataRoutes);
app.use('/api/odoo', odooRoutes);

// Error handling middleware
app.use((err, req, res, next) => {
    logger.error('Unhandled error:', err);
    res.status(500).json({
        success: false,
        error: 'Internal server error',
        message: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({
        success: false,
        error: 'Not found',
        path: req.path
    });
});

// Graceful shutdown
const gracefulShutdown = async (signal) => {
    logger.info(`${signal} received. Starting graceful shutdown...`);
    
    try {
        await syncOrchestrator.cleanup();
        logger.info('Graceful shutdown completed');
        process.exit(0);
    } catch (error) {
        logger.error('Error during shutdown:', error);
        process.exit(1);
    }
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Start server
const startServer = async () => {
    try {
        // Initialize sync orchestrator
        await syncOrchestrator.initialize();

        // Start Express server
        app.listen(PORT, () => {
            logger.info('========================================');
            logger.info('POS Sync Service Started');
            logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
            logger.info(`Port: ${PORT}`);
            logger.info(`Odoo URL: ${process.env.ODOO_BASE_URL}`);
            logger.info(`MySQL: ${process.env.MYSQL_HOST}:${process.env.MYSQL_PORT}/${process.env.MYSQL_DATABASE}`);
            logger.info(`Auto Sync: ${process.env.AUTO_SYNC_ENABLED === 'true' ? 'Enabled' : 'Disabled'}`);
            logger.info('========================================');
        });

    } catch (error) {
        logger.error('Failed to start server:', error);
        process.exit(1);
    }
};

startServer();

module.exports = app;
