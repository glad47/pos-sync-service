/**
 * Odoo Proxy API Routes
 * Provides REST endpoints to fetch data directly from Odoo API
 * These endpoints act as a proxy - fetching from Odoo and returning directly
 */

const express = require('express');
const router = express.Router();
const { odooApi } = require('../config/odooClient');
const logger = require('../utils/logger');

/**
 * GET /api/odoo/products
 * Get all products directly from Odoo (no local database)
 */
router.get('/products', async (req, res) => {
    try {
        logger.info('Fetching all products from Odoo...');
        
        const response = await odooApi.getAllProducts();
        
        if (response.status === 'error' || response.error) {
            return res.status(500).json({
                success: false,
                error: response.message || response.error || 'Failed to fetch products from Odoo'
            });
        }

        const products = response.data || [];
        
        logger.info(`Fetched ${products.length} products from Odoo`);
        
        res.json({
            success: true,
            source: 'odoo',
            data: products,
            count: products.length,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        logger.error('Failed to fetch products from Odoo:', error.message);
        res.status(500).json({
            success: false,
            error: error.message,
            source: 'odoo'
        });
    }
});

/**
 * GET /api/odoo/products/:barcode
 * Get a specific product by barcode from Odoo
 */
router.get('/products/:barcode', async (req, res) => {
    try {
        const { barcode } = req.params;
        logger.info(`Fetching product ${barcode} from Odoo...`);
        
        const response = await odooApi.getAllProducts();
        
        if (response.status === 'error' || response.error) {
            return res.status(500).json({
                success: false,
                error: response.message || response.error || 'Failed to fetch products from Odoo'
            });
        }

        const products = response.data || [];
        const product = products.find(p => p.barcode === barcode);
        
        if (!product) {
            return res.status(404).json({
                success: false,
                error: 'Product not found in Odoo',
                barcode
            });
        }
        
        res.json({
            success: true,
            source: 'odoo',
            data: product,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        logger.error(`Failed to fetch product ${req.params.barcode} from Odoo:`, error.message);
        res.status(500).json({
            success: false,
            error: error.message,
            source: 'odoo'
        });
    }
});

/**
 * GET /api/odoo/loyalty
 * Get all loyalty programs directly from Odoo
 */
router.get('/loyalty', async (req, res) => {
    try {
        logger.info('Fetching all loyalty programs from Odoo...');
        
        const response = await odooApi.getAllLoyaltyPrograms();
        
        if (response.status === 'error' || response.error) {
            return res.status(500).json({
                success: false,
                error: response.message || response.error || 'Failed to fetch loyalty programs from Odoo'
            });
        }

        const programs = response.data || [];
        
        // Deduplicate programs by program_id
        const programsMap = new Map();
        for (const program of programs) {
            const programId = program.program_id;
            if (!programsMap.has(programId)) {
                programsMap.set(programId, program);
            }
        }
        
        const uniquePrograms = Array.from(programsMap.values());
        
        logger.info(`Fetched ${uniquePrograms.length} loyalty programs from Odoo`);
        
        res.json({
            success: true,
            source: 'odoo',
            data: uniquePrograms,
            count: uniquePrograms.length,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        logger.error('Failed to fetch loyalty programs from Odoo:', error.message);
        res.status(500).json({
            success: false,
            error: error.message,
            source: 'odoo'
        });
    }
});

/**
 * GET /api/odoo/loyalty/:programId
 * Get a specific loyalty program by ID from Odoo
 */
router.get('/loyalty/:programId', async (req, res) => {
    try {
        const { programId } = req.params;
        logger.info(`Fetching loyalty program ${programId} from Odoo...`);
        
        const response = await odooApi.getLoyaltyProgramById(parseInt(programId));
        
        if (response.status === 'error' || response.error) {
            return res.status(500).json({
                success: false,
                error: response.message || response.error || 'Failed to fetch loyalty program from Odoo'
            });
        }
        
        const program = response.data || response;
        
        if (!program || (Array.isArray(program) && program.length === 0)) {
            return res.status(404).json({
                success: false,
                error: 'Loyalty program not found in Odoo',
                programId
            });
        }
        
        res.json({
            success: true,
            source: 'odoo',
            data: program,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        logger.error(`Failed to fetch loyalty program ${req.params.programId} from Odoo:`, error.message);
        res.status(500).json({
            success: false,
            error: error.message,
            source: 'odoo'
        });
    }
});

/**
 * GET /api/odoo/promotions
 * Get all promotions directly from Odoo
 */
router.get('/promotions', async (req, res) => {
    try {
        logger.info('Fetching all promotions from Odoo...');
        
        const response = await odooApi.getAllPromotions();
        
        if (response.status === 'error' || response.error) {
            return res.status(500).json({
                success: false,
                error: response.message || response.error || 'Failed to fetch promotions from Odoo'
            });
        }

        const promotions = response.data || [];
        
        logger.info(`Fetched ${promotions.length} promotions from Odoo`);
        
        res.json({
            success: true,
            source: 'odoo',
            data: promotions,
            count: promotions.length,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        logger.error('Failed to fetch promotions from Odoo:', error.message);
        res.status(500).json({
            success: false,
            error: error.message,
            source: 'odoo'
        });
    }
});

/**
 * GET /api/odoo/prices
 * Get all product prices directly from Odoo
 */
router.get('/prices', async (req, res) => {
    try {
        logger.info('Fetching all product prices from Odoo...');
        
        const response = await odooApi.getProductPrices();
        
        if (response.status === 'error' || response.error) {
            return res.status(500).json({
                success: false,
                error: response.message || response.error || 'Failed to fetch product prices from Odoo'
            });
        }

        const prices = response.data || [];
        
        logger.info(`Fetched ${prices.length} product prices from Odoo`);
        
        res.json({
            success: true,
            source: 'odoo',
            data: prices,
            count: prices.length,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        logger.error('Failed to fetch product prices from Odoo:', error.message);
        res.status(500).json({
            success: false,
            error: error.message,
            source: 'odoo'
        });
    }
});

/**
 * GET /api/odoo/all
 * Get all data (products, loyalty, promotions) from Odoo in a single call
 */
router.get('/all', async (req, res) => {
    try {
        logger.info('Fetching all data from Odoo...');
        
        // Fetch all data in parallel
        const [productsResponse, loyaltyResponse, promotionsResponse] = await Promise.all([
            odooApi.getAllProducts().catch(err => ({ status: 'error', error: err.message })),
            odooApi.getAllLoyaltyPrograms().catch(err => ({ status: 'error', error: err.message })),
            odooApi.getAllPromotions().catch(err => ({ status: 'error', error: err.message }))
        ]);
        
        // Process products
        const products = productsResponse.status !== 'error' ? (productsResponse.data || []) : [];
        
        // Process loyalty programs (deduplicate)
        let loyaltyPrograms = [];
        if (loyaltyResponse.status !== 'error') {
            const programsMap = new Map();
            for (const program of (loyaltyResponse.data || [])) {
                const programId = program.program_id;
                if (!programsMap.has(programId)) {
                    programsMap.set(programId, program);
                }
            }
            loyaltyPrograms = Array.from(programsMap.values());
        }
        
        // Process promotions
        const promotions = promotionsResponse.status !== 'error' ? (promotionsResponse.data || []) : [];
        
        logger.info(`Fetched from Odoo - Products: ${products.length}, Loyalty: ${loyaltyPrograms.length}, Promotions: ${promotions.length}`);
        
        res.json({
            success: true,
            source: 'odoo',
            data: {
                products,
                loyalty: loyaltyPrograms,
                promotions
            },
            counts: {
                products: products.length,
                loyalty: loyaltyPrograms.length,
                promotions: promotions.length
            },
            errors: {
                products: productsResponse.status === 'error' ? productsResponse.error : null,
                loyalty: loyaltyResponse.status === 'error' ? loyaltyResponse.error : null,
                promotions: promotionsResponse.status === 'error' ? promotionsResponse.error : null
            },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        logger.error('Failed to fetch all data from Odoo:', error.message);
        res.status(500).json({
            success: false,
            error: error.message,
            source: 'odoo'
        });
    }
});

/**
 * GET /api/odoo/health
 * Check Odoo API connection health
 */
router.get('/health', async (req, res) => {
    try {
        logger.info('Checking Odoo API connection...');
        
        const isConnected = await odooApi.testConnection();
        
        res.json({
            success: true,
            odoo: {
                connected: isConnected,
                baseUrl: process.env.ODOO_BASE_URL
            },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        logger.error('Odoo health check failed:', error.message);
        res.status(500).json({
            success: false,
            odoo: {
                connected: false,
                baseUrl: process.env.ODOO_BASE_URL,
                error: error.message
            },
            timestamp: new Date().toISOString()
        });
    }
});

module.exports = router;
