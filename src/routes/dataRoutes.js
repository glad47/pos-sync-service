/**
 * Data API Routes
 * Provides REST endpoints for POS to access synced data
 */

const express = require('express');
const router = express.Router();
const db = require('../config/database');
const productSyncService = require('../services/productSyncService');
const loyaltySyncService = require('../services/loyaltySyncService');
const syncOrchestrator = require('../services/syncOrchestrator');
const logger = require('../utils/logger');

/**
 * GET /api/data/all
 * Get all POS data (products, loyalty, promotions)
 */
router.get('/all', async (req, res) => {
    try {
        const result = await syncOrchestrator.getPosData();
        res.json(result);
    } catch (error) {
        logger.error('Failed to get all data:', error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * GET /api/data/products
 * Get all active products
 */
router.get('/products', async (req, res) => {
    try {
        const products = await productSyncService.getLocalProducts();
        res.json({
            success: true,
            data: products,
            count: products.length
        });
    } catch (error) {
        logger.error('Failed to get products:', error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * GET /api/data/products/:barcode
 * Get product by barcode
 */
router.get('/products/:barcode', async (req, res) => {
    try {
        const { barcode } = req.params;
        const product = await productSyncService.getProductByBarcode(barcode);
        
        if (!product) {
            return res.status(404).json({
                success: false,
                error: 'Product not found'
            });
        }

        res.json({
            success: true,
            data: product
        });
    } catch (error) {
        logger.error('Failed to get product:', error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * GET /api/data/products/search/:query
 * Search products by name or barcode
 */
router.get('/products/search/:query', async (req, res) => {
    try {
        const { query } = req.params;
        const searchTerm = `%${query}%`;
        
        const products = await db.query(`
            SELECT * FROM products 
            WHERE active = TRUE 
            AND (name LIKE ? OR barcode LIKE ?)
            ORDER BY name
            LIMIT 50
        `, [searchTerm, searchTerm]);

        res.json({
            success: true,
            data: products,
            count: products.length
        });
    } catch (error) {
        logger.error('Failed to search products:', error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * GET /api/data/loyalty
 * Get all active loyalty programs
 */
router.get('/loyalty', async (req, res) => {
    try {
        const programs = await loyaltySyncService.getActiveLoyaltyPrograms();
        res.json({
            success: true,
            data: programs,
            count: programs.length
        });
    } catch (error) {
        logger.error('Failed to get loyalty programs:', error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * GET /api/data/loyalty/product/:barcode
 * Get loyalty programs applicable to a product
 */
router.get('/loyalty/product/:barcode', async (req, res) => {
    try {
        const { barcode } = req.params;
        const programs = await loyaltySyncService.getLoyaltyForProduct(barcode);
        
        res.json({
            success: true,
            data: programs,
            count: programs.length
        });
    } catch (error) {
        logger.error('Failed to get loyalty for product:', error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * GET /api/data/promotions
 * Get all active promotions
 */
router.get('/promotions', async (req, res) => {
    try {
        const promotions = await loyaltySyncService.getActivePromotions();
        res.json({
            success: true,
            data: promotions,
            count: promotions.length
        });
    } catch (error) {
        logger.error('Failed to get promotions:', error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * GET /api/data/promotions/product/:barcode
 * Get promotions applicable to a product
 */
router.get('/promotions/product/:barcode', async (req, res) => {
    try {
        const { barcode } = req.params;
        const promotions = await loyaltySyncService.getPromotionsForProduct(barcode);
        
        res.json({
            success: true,
            data: promotions,
            count: promotions.length
        });
    } catch (error) {
        logger.error('Failed to get promotions for product:', error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * POST /api/data/cart/calculate
 * Calculate cart with applicable loyalty programs and promotions
 * Request body: { items: [{ barcode: string, quantity: number, price: number }] }
 */
router.post('/cart/calculate', async (req, res) => {
    try {
        const { items } = req.body;
        
        if (!items || !Array.isArray(items)) {
            return res.status(400).json({
                success: false,
                error: 'Items array is required'
            });
        }

        const result = {
            items: [],
            subtotal: 0,
            totalDiscount: 0,
            totalTax: 0,
            grandTotal: 0,
            appliedPrograms: []
        };

        for (const item of items) {
            const { barcode, quantity, price } = item;
            
            // Get product details
            const product = await productSyncService.getProductByBarcode(barcode);
            const itemPrice = price || (product ? parseFloat(product.price) : 0);
            const taxRate = product ? parseFloat(product.tax_rate) : 0.15;

            // Get applicable loyalty programs
            const loyaltyPrograms = await loyaltySyncService.getLoyaltyForProduct(barcode);
            
            // Get applicable promotions
            const promotions = await loyaltySyncService.getPromotionsForProduct(barcode);

            let itemSubtotal = itemPrice * quantity;
            let itemDiscount = 0;
            let freeItems = 0;
            let appliedProgram = null;

            // Check for BOGO programs
            for (const program of loyaltyPrograms) {
                if (program.type === 'BOGO') {
                    const buyQty = program.buy_quantity || 1;
                    const freeQty = program.free_quantity || 1;
                    
                    if (quantity >= buyQty) {
                        const eligibleSets = Math.floor(quantity / buyQty);
                        freeItems = eligibleSets * freeQty;
                        itemDiscount = freeItems * itemPrice;
                        appliedProgram = {
                            type: 'BOGO',
                            name: program.name,
                            freeItems,
                            discount: itemDiscount
                        };
                        break; // Apply first matching BOGO
                    }
                } else if (program.type === 'DISCOUNT' && program.discount_percent > 0) {
                    const discountAmount = itemSubtotal * (program.discount_percent / 100);
                    if (discountAmount > itemDiscount) {
                        itemDiscount = discountAmount;
                        appliedProgram = {
                            type: 'DISCOUNT',
                            name: program.name,
                            percentage: program.discount_percent,
                            discount: itemDiscount
                        };
                    }
                }
            }

            // Check promotions if no loyalty program applied better discount
            for (const promo of promotions) {
                let promoDiscount = 0;
                
                if (promo.discount_type === 'PERCENTAGE') {
                    promoDiscount = itemSubtotal * (promo.discount_value / 100);
                    if (promo.max_discount && promoDiscount > promo.max_discount) {
                        promoDiscount = promo.max_discount;
                    }
                } else if (promo.discount_type === 'FIXED_AMOUNT') {
                    promoDiscount = promo.discount_value * quantity;
                }

                if (promoDiscount > itemDiscount && itemSubtotal >= (promo.min_purchase || 0)) {
                    itemDiscount = promoDiscount;
                    appliedProgram = {
                        type: 'PROMOTION',
                        name: promo.name,
                        discountType: promo.discount_type,
                        discountValue: promo.discount_value,
                        discount: itemDiscount
                    };
                }
            }

            const itemTotal = itemSubtotal - itemDiscount;
            const itemTax = itemTotal * taxRate;

            result.items.push({
                barcode,
                name: product?.name || 'Unknown',
                quantity,
                unitPrice: itemPrice,
                subtotal: itemSubtotal,
                discount: itemDiscount,
                freeItems,
                taxRate,
                tax: itemTax,
                total: itemTotal + itemTax,
                appliedProgram
            });

            result.subtotal += itemSubtotal;
            result.totalDiscount += itemDiscount;
            result.totalTax += itemTax;

            if (appliedProgram) {
                result.appliedPrograms.push(appliedProgram);
            }
        }

        result.grandTotal = result.subtotal - result.totalDiscount + result.totalTax;

        res.json({
            success: true,
            data: result
        });

    } catch (error) {
        logger.error('Failed to calculate cart:', error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * GET /api/data/categories
 * Get all product categories
 */
router.get('/categories', async (req, res) => {
    try {
        const categories = await db.query(`
            SELECT DISTINCT category 
            FROM products 
            WHERE active = TRUE AND category IS NOT NULL
            ORDER BY category
        `);

        res.json({
            success: true,
            data: categories.map(c => c.category),
            count: categories.length
        });
    } catch (error) {
        logger.error('Failed to get categories:', error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * GET /api/data/products/category/:category
 * Get products by category
 */
router.get('/products/category/:category', async (req, res) => {
    try {
        const { category } = req.params;
        
        const products = await db.query(`
            SELECT * FROM products 
            WHERE active = TRUE AND category = ?
            ORDER BY name
        `, [category]);

        res.json({
            success: true,
            data: products,
            count: products.length
        });
    } catch (error) {
        logger.error('Failed to get products by category:', error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

module.exports = router;
