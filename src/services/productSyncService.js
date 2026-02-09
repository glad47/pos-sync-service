/**
 * Product Sync Service
 * Handles synchronization of products between Odoo and local MySQL database
 * Compares using id and only updates changed records
 * Now handles both active and inactive products correctly
 * 
 * FIXED: Archive/unarchive detection now works correctly
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
            unchanged: 0,
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
            unchanged: 0,
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
     * Load all local products indexed by id
     * @returns {Map<number, Object>} Map of id to product data
     */
    async loadLocalProducts() {
        const products = await db.query('SELECT * FROM products');
        const productMap = new Map();
        
        for (const product of products) {
            if (product.id) {
                productMap.set(product.id, product);
            }
        }
        
        logger.info(`Loaded ${productMap.size} local products`);
        return productMap;
    }

    /**
     * Check if product data has changed
     * @param {Object} odooProduct - Transformed product from Odoo
     * @param {Object} localProduct - Existing product from local DB
     * @returns {boolean} True if product has changes
     */
    hasChanges(odooProduct, localProduct) {
        // Helper to normalize active field (handles both boolean and numeric)
        const normalizeActive = (v) => {
            if (typeof v === 'boolean') return v ? 1 : 0;
            if (typeof v === 'number') return v ? 1 : 0;
            if (v === 'true' || v === '1') return 1;
            if (v === 'false' || v === '0') return 0;
            return v !== false && v !== 0 ? 1 : 0;
        };

        // Helper to normalize numeric values
        const normalizeNumber = (v, defaultVal = 0) => {
            const num = parseFloat(v);
            return isNaN(num) ? defaultVal : num;
        };

        const normalizeInt = (v, defaultVal = 0) => {
            const num = parseInt(v);
            return isNaN(num) ? defaultVal : num;
        };

        // Compare relevant fields
        const fieldsToCompare = [
            { odoo: 'template_id', local: 'template_id' },
            { odoo: 'name', local: 'name' },
            { odoo: 'description', local: 'description' },
            { odoo: 'barcode', local: 'barcode' },
            { odoo: 'list_price', local: 'price' },
            { odoo: 'stock', local: 'stock' },
            { odoo: 'category', local: 'category' },
            { odoo: 'tax_rate', local: 'tax_rate' },
            { odoo: 'active', local: 'active' }
        ];

        for (const field of fieldsToCompare) {
            let odooValue = odooProduct[field.odoo];
            let localValue = localProduct[field.local];

            // Normalize values based on field type
            if (field.odoo === 'active') {
                odooValue = normalizeActive(odooValue);
                localValue = normalizeActive(localValue);
            } else if (field.odoo === 'template_id' || field.odoo === 'stock') {
                odooValue = normalizeInt(odooValue, null);
                localValue = normalizeInt(localValue, null);
            } else if (field.odoo === 'list_price' || field.odoo === 'tax_rate') {
                odooValue = normalizeNumber(odooValue, 0);
                localValue = normalizeNumber(localValue, 0);
            }

            // Handle null/undefined comparison
            if (odooValue === null || odooValue === undefined) odooValue = null;
            if (localValue === null || localValue === undefined) localValue = null;

            // Compare values
            if (odooValue !== localValue) {
                logger.debug(`Field ${field.odoo} changed: "${localValue}" -> "${odooValue}"`);
                return true;
            }
        }

        return false;
    }

    /**
     * Create a new product in local database
     * @param {Object} product - Product data from Odoo
     */
    async createProduct(product) {
        try {
            const sql = `
                INSERT INTO products (
                    id, template_id, barcode, name, description, 
                    price, stock, category, tax_rate, active, 
                    created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
            `;
            
            const params = [
                product.id ?? null,
                product.template_id ?? null,
                product.barcode ?? null,
                product.name ?? 'Unknown Product',
                product.description ?? null,
                product.list_price ?? 0,
                product.stock ?? 0,
                product.category ?? 'General',
                product.tax_rate ?? 0.15,
                product.active !== false ? 1 : 0
            ];

            await db.query(sql, params);
            this.syncStats.created++;
            logger.info(`Created product: [${product.id}] ${product.name} (active=${product.active})`);
            return product.id;
        } catch (error) {
            this.syncStats.errors++;
            logger.error(`Failed to create product ${product.id}:`, error.message);
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
                    template_id = ?,
                    barcode = ?,
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
                product.template_id ?? null,
                product.barcode ?? null,
                product.name ?? 'Unknown Product',
                product.description ?? null,
                product.list_price ?? 0,
                product.stock ?? 0,
                product.category ?? 'General',
                product.tax_rate ?? 0.15,
                product.active !== false ? 1 : 0,
                existingId
            ];

            await db.query(sql, params);
            this.syncStats.updated++;
            logger.info(`Updated product: [${product.id}] ${product.name} (active=${product.active})`);
        } catch (error) {
            this.syncStats.errors++;
            logger.error(`Failed to update product ${product.id}:`, error.message);
            throw error;
        }
    }

    /**
     * Transform Odoo product data to local format
     * @param {Object} odooProduct - Raw product data from Odoo
     */
    transformOdooProduct(odooProduct) {
        const data = odooProduct.data || odooProduct;
        
        // Debug: log first product structure to understand the data
        // logger.debug('Raw Odoo product data:', JSON.stringify(data));
        
        // Handle different field naming from Odoo API
        // If product_id exists, use it as id; otherwise id is actually template_id
        let productId, templateId;
        
        if (data.product_id !== undefined && data.product_id !== null) {
            // API returns: id=template_id, product_id=product_id
            productId = data.product_id;
            templateId = data.template_id ?? data.id;
        } else {
            // API returns: id=product_id, template_id=template_id
            productId = data.id;
            templateId = data.template_id;
        }
        
        // Active status: product is active only if the 'active' field is true
        // The API now returns both active and inactive products
        // If template_active and product_active are provided, both must be true
        let isActive;
        if (data.template_active !== undefined && data.product_active !== undefined) {
            isActive = data.template_active && data.product_active;
        } else if (data.active !== undefined) {
            isActive = data.active;
        } else {
            isActive = true; // Default to active if no status provided
        }
        
        return {
            id: productId ?? null,
            template_id: templateId ?? null,
            barcode: data.barcode ?? null,
            name: this.extractName(data.name),
            description: this.extractName(data.description),
            list_price: parseFloat(data.list_price) || 0,
            stock: parseInt(data.stock || data.qty_available) || 0,
            category: this.extractCategory(data.category),
            tax_rate: parseFloat(data.tax_rate) || 0.15,
            active: isActive
        };
    }

    /**
     * Extract category from various formats
     * @param {Object|string} category 
     */
    extractCategory(category) {
        if (typeof category === 'string') return category;
        if (typeof category === 'object' && category !== null) {
            return category.en_US || category.ar_001 || category.en || Object.values(category)[0] || 'General';
        }
        return 'General';
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
     * Full sync - Load all from Odoo, compare with local, update only changes
     */
    async syncAllProducts() {
        this.resetStats();
        const startTime = Date.now();
        
        try {
            logger.info('Starting product sync from Odoo...');
            
            // Step 1: Load all products from Odoo
            logger.info('Loading products from Odoo...');
            const response = await odooApi.getAllProducts();
            
            // if (response.status !== 'success') {
            //     throw new Error(response.message || 'Failed to get products from Odoo');
            // }

            const odooProducts = response;
            logger.info(`Loaded ${odooProducts.length} products from Odoo`);

            // Step 2: Load all local products indexed by id
            logger.info('Loading local products...');
            const localProductsMap = await this.loadLocalProducts();

            // Step 3: Process each Odoo product
            logger.info('Comparing and syncing products...');
            
            // Debug: log first product to see data structure
            if (odooProducts.length > 0) {
                logger.debug('First product raw data:', JSON.stringify(odooProducts[0]));
            }
            
            for (const odooProduct of odooProducts) {
                const product = this.transformOdooProduct(odooProduct);
                
                // Skip products without valid id
                if (!product.id) {
                    logger.warn(`Skipping product without id: ${product.name}`);
                    this.syncStats.skipped++;
                    continue;
                }

                // Skip products without template_id (required field in DB)
                if (!product.template_id) {
                    logger.warn(`Skipping product without template_id: [${product.id}] ${product.name}`);
                    this.syncStats.skipped++;
                    continue;
                }

                try {
                    const existingProduct = localProductsMap.get(product.id);
                    
                    if (existingProduct) {
                        // Product exists - check if it has changes
                        if (this.hasChanges(product, existingProduct)) {
                            await this.updateProduct(product, existingProduct.id);
                        } else {
                            this.syncStats.unchanged++;
                            logger.debug(`No changes for: [${product.id}] ${product.name}`);
                        }
                    } else {
                        // New product - create it
                        await this.createProduct(product);
                    }
                } catch (error) {
                    logger.error(`Error processing product ${product.id}:`, error.message);
                    // Continue with next product
                }
            }

            this.syncStats.lastSync = new Date().toISOString();
            
            const duration = Date.now() - startTime;
            logger.info(`Product sync completed in ${duration}ms`, this.syncStats);
            
            return {
                success: true,
                stats: this.getStats(),
                duration,
                summary: {
                    totalFromOdoo: odooProducts.length,
                    totalLocal: localProductsMap.size,
                    created: this.syncStats.created,
                    updated: this.syncStats.updated,
                    unchanged: this.syncStats.unchanged,
                    skipped: this.syncStats.skipped,
                    errors: this.syncStats.errors
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
     * Get all local products (active and inactive)
     */
    async getAllLocalProducts() {
        return await db.query('SELECT * FROM products ORDER BY name');
    }

    /**
     * Get active local products only
     */
    async getLocalProducts() {
        return await db.query('SELECT * FROM products WHERE active = TRUE ORDER BY name');
    }

    /**
     * Get product by id
     * @param {number} id 
     */
    async getProductById(id) {
        const result = await db.query('SELECT * FROM products WHERE id = ?', [id]);
        return result.length > 0 ? result[0] : null;
    }

    /**
     * Get product by template_id
     * @param {number} templateId 
     */
    async getProductByTemplateId(templateId) {
        const result = await db.query('SELECT * FROM products WHERE template_id = ?', [templateId]);
        return result.length > 0 ? result[0] : null;
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
     * @param {number} id 
     * @param {number} price 
     */
    async updatePrice(id, price) {
        await db.query(
            'UPDATE products SET price = ?, updated_at = NOW() WHERE id = ?',
            [price, id]
        );
        logger.info(`Updated price for product ${id}: ${price}`);
    }

    /**
     * Activate/Deactivate product
     * @param {number} id 
     * @param {boolean} active 
     */
    async updateActiveStatus(id, active) {
        await db.query(
            'UPDATE products SET active = ?, updated_at = NOW() WHERE id = ?',
            [active ? 1 : 0, id]
        );
        logger.info(`Updated active status for product ${id}: ${active}`);
    }
}

module.exports = new ProductSyncService();