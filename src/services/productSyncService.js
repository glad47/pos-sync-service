/**
 * Product Sync Service
 * Handles synchronization of products between Odoo and local MySQL database
 */

const db = require('../config/database');
const { odooApi } = require('../config/odooClient');
const logger = require('../utils/logger');

class ProductSyncService {
    constructor() {
        this.syncStats = {
            created: 0,
            updated: 0,
            skipped: 0,
            errors: 0,
            lastSync: null
        };
    }

    /**
     * Reset sync statistics
     */
    resetStats() {
        this.syncStats = {
            created: 0,
            updated: 0,
            skipped: 0,
            errors: 0,
            lastSync: null
        };
    }

    /**
     * Get current sync statistics
     */
    getStats() {
        return { ...this.syncStats };
    }

    /**
     * Check if product exists in local database
     * @param {string} barcode 
     */
    async productExists(barcode) {
        const result = await db.query(
            'SELECT id, updated_at FROM products WHERE barcode = ?',
            [barcode]
        );
        return result.length > 0 ? result[0] : null;
    }

    /**
     * Create a new product in local database
     * @param {Object} product - Product data from Odoo
     */
    async createProduct(product) {
        try {
            const sql = `
                INSERT INTO products (
                    barcode, name, description, price, stock, 
                    category, tax_rate, active, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
            `;
            
            const params = [
                product.barcode,
                product.name || 'Unknown Product',
                product.description || null,
                product.list_price || product.price || 0,
                product.stock || 0,
                product.category || 'General',
                product.tax_rate || 0.15, // Default 15% VAT for Saudi Arabia
                product.active !== false
            ];

            const result = await db.query(sql, params);
            this.syncStats.created++;
            logger.info(`Created product: ${product.barcode} - ${product.name}`);
            return result.insertId;
        } catch (error) {
            this.syncStats.errors++;
            logger.error(`Failed to create product ${product.barcode}:`, error.message);
            throw error;
        }
    }

    /**
     * Update existing product in local database
     * @param {Object} product - Product data from Odoo
     * @param {number} existingId - Existing product ID
     */
    async updateProduct(product, existingId) {
        try {
            const sql = `
                UPDATE products SET
                    name = ?,
                    description = ?,
                    price = ?,
                    stock = ?,
                    category = ?,
                    tax_rate = ?,
                    active = ?,
                    updated_at = NOW()
                WHERE id = ?
            `;

            const params = [
                product.name || 'Unknown Product',
                product.description || null,
                product.list_price || product.price || 0,
                product.stock || 0,
                product.category || 'General',
                product.tax_rate || 0.15,
                product.active !== false,
                existingId
            ];

            await db.query(sql, params);
            this.syncStats.updated++;
            logger.info(`Updated product: ${product.barcode} - ${product.name}`);
        } catch (error) {
            this.syncStats.errors++;
            logger.error(`Failed to update product ${product.barcode}:`, error.message);
            throw error;
        }
    }

    /**
     * Sync a single product
     * @param {Object} product - Product data from Odoo
     */
    async syncProduct(product) {
        if (!product.barcode) {
            logger.warn('Skipping product without barcode:', product.name);
            this.syncStats.skipped++;
            return null;
        }

        try {
            const existing = await this.productExists(product.barcode);
            
            if (existing) {
                await this.updateProduct(product, existing.id);
                return { action: 'updated', id: existing.id };
            } else {
                const newId = await this.createProduct(product);
                return { action: 'created', id: newId };
            }
        } catch (error) {
            logger.error(`Error syncing product ${product.barcode}:`, error.message);
            return { action: 'error', error: error.message };
        }
    }

    /**
     * Transform Odoo product data to local format
     * @param {Object} odooProduct - Raw product data from Odoo
     */
    transformOdooProduct(odooProduct) {
        // Handle different data structures from Odoo
        const data = odooProduct.data || odooProduct;
        
        return {
            barcode: data.barcode,
            name: this.extractName(data.name),
            description: data.description || null,
            list_price: parseFloat(data.list_price) || 0,
            stock: parseInt(data.stock || data.qty_available) || 0,
            category: data.category || data.categ_id?.name || 'General',
            tax_rate: this.calculateTaxRate(data),
            active: data.active !== false
        };
    }

    /**
     * Extract name from Odoo's multilingual format
     * @param {Object|string} name 
     */
    extractName(name) {
        if (typeof name === 'string') return name;
        if (typeof name === 'object' && name !== null) {
            return name.ar_001 || name.en_US || name.en || Object.values(name)[0] || 'Unknown';
        }
        return 'Unknown Product';
    }

    /**
     * Calculate tax rate from Odoo data
     * @param {Object} data 
     */
    calculateTaxRate(data) {
        // Default to 15% VAT for Saudi Arabia
        if (data.tax_rate) return parseFloat(data.tax_rate);
        if (data.taxes_id && Array.isArray(data.taxes_id) && data.taxes_id.length > 0) {
            // If tax data is available, try to extract rate
            const tax = data.taxes_id[0];
            if (typeof tax === 'object' && tax.amount) {
                return parseFloat(tax.amount) / 100;
            }
        }
        return 0.15; // Default 15% VAT
    }

    /**
     * Full sync from Odoo API
     * Uses the sync endpoint to get changed products
     */
    async syncFromOdoo() {
        this.resetStats();
        const startTime = Date.now();
        
        try {
            logger.info('Starting product sync from Odoo...');
            
            // Get sync data from Odoo
            const syncData = await odooApi.getProductsSync();
            
            if (!syncData.success) {
                throw new Error(syncData.error || 'Failed to get sync data from Odoo');
            }

            const { changes } = syncData;
            const allChanges = [
                ...(changes.created || []),
                ...(changes.updated || [])
            ];

            logger.info(`Processing ${allChanges.length} product changes...`);

            // Process each product change
            for (const change of allChanges) {
                const product = this.transformOdooProduct(change);
                await this.syncProduct(product);
            }

            this.syncStats.lastSync = new Date().toISOString();
            
            const duration = Date.now() - startTime;
            logger.info(`Product sync completed in ${duration}ms`, this.syncStats);
            
            return {
                success: true,
                stats: this.getStats(),
                duration,
                syncInfo: {
                    lastSyncTime: syncData.last_sync_time,
                    currentSyncTime: syncData.current_sync_time
                }
            };

        } catch (error) {
            logger.error('Product sync failed:', error.message);
            return {
                success: false,
                error: error.message,
                stats: this.getStats()
            };
        }
    }

    /**
     * Full sync using prices endpoint (alternative method)
     * Gets all products with their prices
     */
    async syncAllProducts() {
        this.resetStats();
        const startTime = Date.now();
        
        try {
            logger.info('Starting full product sync from Odoo...');
            
            // Get all product prices from Odoo
            const response = await odooApi.getProductPrices();
            
            if (response.status !== 'success') {
                throw new Error(response.message || 'Failed to get products from Odoo');
            }

            const products = response.data || [];
            logger.info(`Processing ${products.length} products...`);

            // Process each product
            for (const productData of products) {
                const product = this.transformOdooProduct(productData);
                await this.syncProduct(product);
            }

            this.syncStats.lastSync = new Date().toISOString();
            
            const duration = Date.now() - startTime;
            logger.info(`Full product sync completed in ${duration}ms`, this.syncStats);
            
            return {
                success: true,
                stats: this.getStats(),
                duration
            };

        } catch (error) {
            logger.error('Full product sync failed:', error.message);
            return {
                success: false,
                error: error.message,
                stats: this.getStats()
            };
        }
    }

    /**
     * Get all local products
     */
    async getLocalProducts() {
        return await db.query('SELECT * FROM products WHERE active = TRUE ORDER BY name');
    }

    /**
     * Get product by barcode
     * @param {string} barcode 
     */
    async getProductByBarcode(barcode) {
        const result = await db.query('SELECT * FROM products WHERE barcode = ?', [barcode]);
        return result.length > 0 ? result[0] : null;
    }

    /**
     * Update product price only
     * @param {string} barcode 
     * @param {number} price 
     */
    async updatePrice(barcode, price) {
        await db.query(
            'UPDATE products SET price = ?, updated_at = NOW() WHERE barcode = ?',
            [price, barcode]
        );
        logger.info(`Updated price for ${barcode}: ${price}`);
    }
}

module.exports = new ProductSyncService();
