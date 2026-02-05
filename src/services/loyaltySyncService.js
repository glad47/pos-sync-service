/**
 * Loyalty & Promotion Sync Service
 * Handles synchronization of loyalty programs (BOGO) and promotions between Odoo and local MySQL database
 */

const db = require('../config/database');
const { odooApi } = require('../config/odooClient');
const logger = require('../utils/logger');

class LoyaltySyncService {
    constructor() {
        this.syncStats = {
            loyalty: { created: 0, updated: 0, skipped: 0, errors: 0 },
            promotions: { created: 0, updated: 0, skipped: 0, errors: 0 },
            lastSync: null
        };
    }

    /**
     * Reset sync statistics
     */
    resetStats() {
        this.syncStats = {
            loyalty: { created: 0, updated: 0, skipped: 0, errors: 0 },
            promotions: { created: 0, updated: 0, skipped: 0, errors: 0 },
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
     * Check if loyalty program exists in local database by Odoo ID
     * @param {number} odooId - Program ID from Odoo
     */
    async loyaltyExistsByOdooId(odooId) {
        // First check if we have odoo_id column, if not use name matching
        try {
            const result = await db.query(
                'SELECT id, updated_at FROM loyalty_programs WHERE odoo_program_id = ?',
                [odooId]
            );
            return result.length > 0 ? result[0] : null;
        } catch (error) {
            // Column might not exist, try by product_barcode and name
            return null;
        }
    }

    /**
     * Check if loyalty program exists by product barcode
     * @param {string} productBarcode 
     * @param {string} name 
     */
    async loyaltyExists(productBarcode, name) {
        const result = await db.query(
            'SELECT id, updated_at FROM loyalty_programs WHERE product_barcode = ? AND name = ?',
            [productBarcode, name]
        );
        return result.length > 0 ? result[0] : null;
    }

    /**
     * Check if promotion exists
     * @param {number} odooId - Promotion ID from Odoo
     */
    async promotionExistsByOdooId(odooId) {
        try {
            const result = await db.query(
                'SELECT id, updated_at FROM promotions WHERE odoo_promotion_id = ?',
                [odooId]
            );
            return result.length > 0 ? result[0] : null;
        } catch (error) {
            return null;
        }
    }

    /**
     * Check if promotion exists by product barcode
     * @param {string} productBarcode 
     * @param {string} name 
     */
    async promotionExists(productBarcode, name) {
        const result = await db.query(
            'SELECT id, updated_at FROM promotions WHERE product_barcode = ? AND name = ?',
            [productBarcode, name]
        );
        return result.length > 0 ? result[0] : null;
    }

    /**
     * Create a new loyalty program (BOGO)
     * @param {Object} program - Loyalty program data
     */
    async createLoyaltyProgram(program) {
        try {
            const sql = `
                INSERT INTO loyalty_programs (
                    name, type, buy_quantity, free_quantity, 
                    discount_percent, product_barcode, category,
                    start_date, end_date, active, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
            `;

            const params = [
                program.name,
                program.type || 'BOGO',
                program.buy_quantity || 1,
                program.free_quantity || 1,
                program.discount_percent || 0,
                program.product_barcode || null,
                program.category || null,
                program.start_date || new Date(),
                program.end_date || new Date(Date.now() + 365 * 24 * 60 * 60 * 1000), // 1 year default
                program.active !== false
            ];

            const result = await db.query(sql, params);
            this.syncStats.loyalty.created++;
            logger.info(`Created loyalty program: ${program.name}`);
            return result.insertId;
        } catch (error) {
            this.syncStats.loyalty.errors++;
            logger.error(`Failed to create loyalty program ${program.name}:`, error.message);
            throw error;
        }
    }

    /**
     * Update existing loyalty program
     * @param {Object} program - Loyalty program data
     * @param {number} existingId - Existing program ID
     */
    async updateLoyaltyProgram(program, existingId) {
        try {
            const sql = `
                UPDATE loyalty_programs SET
                    name = ?,
                    type = ?,
                    buy_quantity = ?,
                    free_quantity = ?,
                    discount_percent = ?,
                    product_barcode = ?,
                    category = ?,
                    start_date = ?,
                    end_date = ?,
                    active = ?,
                    updated_at = NOW()
                WHERE id = ?
            `;

            const params = [
                program.name,
                program.type || 'BOGO',
                program.buy_quantity || 1,
                program.free_quantity || 1,
                program.discount_percent || 0,
                program.product_barcode || null,
                program.category || null,
                program.start_date || new Date(),
                program.end_date || new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
                program.active !== false,
                existingId
            ];

            await db.query(sql, params);
            this.syncStats.loyalty.updated++;
            logger.info(`Updated loyalty program: ${program.name}`);
        } catch (error) {
            this.syncStats.loyalty.errors++;
            logger.error(`Failed to update loyalty program ${program.name}:`, error.message);
            throw error;
        }
    }

    /**
     * Create a new promotion
     * @param {Object} promotion - Promotion data
     */
    async createPromotion(promotion) {
        try {
            const sql = `
                INSERT INTO promotions (
                    name, description, discount_type, discount_value,
                    min_purchase, max_discount, product_barcode, category,
                    start_date, end_date, active, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
            `;

            const params = [
                promotion.name,
                promotion.description || null,
                promotion.discount_type || 'PERCENTAGE',
                promotion.discount_value || 0,
                promotion.min_purchase || 0,
                promotion.max_discount || null,
                promotion.product_barcode || null,
                promotion.category || null,
                promotion.start_date || new Date(),
                promotion.end_date || new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
                promotion.active !== false
            ];

            const result = await db.query(sql, params);
            this.syncStats.promotions.created++;
            logger.info(`Created promotion: ${promotion.name}`);
            return result.insertId;
        } catch (error) {
            this.syncStats.promotions.errors++;
            logger.error(`Failed to create promotion ${promotion.name}:`, error.message);
            throw error;
        }
    }

    /**
     * Update existing promotion
     * @param {Object} promotion - Promotion data
     * @param {number} existingId - Existing promotion ID
     */
    async updatePromotion(promotion, existingId) {
        try {
            const sql = `
                UPDATE promotions SET
                    name = ?,
                    description = ?,
                    discount_type = ?,
                    discount_value = ?,
                    min_purchase = ?,
                    max_discount = ?,
                    product_barcode = ?,
                    category = ?,
                    start_date = ?,
                    end_date = ?,
                    active = ?,
                    updated_at = NOW()
                WHERE id = ?
            `;

            const params = [
                promotion.name,
                promotion.description || null,
                promotion.discount_type || 'PERCENTAGE',
                promotion.discount_value || 0,
                promotion.min_purchase || 0,
                promotion.max_discount || null,
                promotion.product_barcode || null,
                promotion.category || null,
                promotion.start_date || new Date(),
                promotion.end_date || new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
                promotion.active !== false,
                existingId
            ];

            await db.query(sql, params);
            this.syncStats.promotions.updated++;
            logger.info(`Updated promotion: ${promotion.name}`);
        } catch (error) {
            this.syncStats.promotions.errors++;
            logger.error(`Failed to update promotion ${promotion.name}:`, error.message);
            throw error;
        }
    }

    /**
     * Transform Odoo loyalty data to local format
     * Determines if it's a BOGO, DISCOUNT, or PROMOTION type
     * @param {Object} odooData - Raw loyalty data from Odoo
     */
    transformOdooLoyalty(odooData) {
        const data = odooData.data || odooData;
        
        // Extract product barcode from eligible or main product
        let productBarcode = null;
        if (data.eligible_product?.barcode) {
            productBarcode = data.eligible_product.barcode;
        } else if (data.main_product?.barcode && data.main_product.barcode !== 'N/A') {
            productBarcode = data.main_product.barcode;
        } else if (data.main_product_barcode && data.main_product_barcode !== 'N/A') {
            productBarcode = data.main_product_barcode;
        } else if (data.eligible_product_barcode) {
            productBarcode = data.eligible_product_barcode;
        }

        // Determine program type based on Odoo data
        let programType = 'BOGO';
        let buyQuantity = 1;
        let freeQuantity = 1;
        let discountPercent = 0;
        let discountType = 'PERCENTAGE';
        let discountValue = 0;

        const rule = data.rule || {};
        
        // Check rule mode or type to determine program type
        if (rule.mode === 'with_code' || data.discount_code) {
            // Discount/Coupon type
            programType = 'DISCOUNT';
            discountPercent = parseFloat(rule.discount || data.rule_discount || 0);
            discountValue = discountPercent;
        } else if (rule.discount && parseFloat(rule.discount) > 0) {
            // Percentage discount
            programType = 'DISCOUNT';
            discountPercent = parseFloat(rule.discount);
            discountValue = discountPercent;
        } else if (data.reward_product?.id) {
            // BOGO - Buy X Get Y Free
            programType = 'BOGO';
            buyQuantity = parseInt(rule.minimum_qty || data.rule_min_qty) || 1;
            freeQuantity = 1; // Usually 1 free item
        } else {
            // Default to discount if there's a discount value
            if (data.rule_after_discount || data.rule_total_price) {
                programType = 'DISCOUNT';
                const originalPrice = parseFloat(data.rule_total_price || 0);
                const afterDiscount = parseFloat(data.rule_after_discount || 0);
                if (originalPrice > 0) {
                    discountPercent = ((originalPrice - afterDiscount) / originalPrice) * 100;
                    discountValue = discountPercent;
                }
            }
        }

        // Extract program name
        const programName = this.extractName(data.program_name || data.name);
        
        return {
            // Common fields
            odoo_program_id: data.program_id,
            name: programName,
            product_barcode: productBarcode,
            category: data.category || null,
            active: data.rule?.active !== false && data.rule_active !== false,
            
            // BOGO specific
            type: programType,
            buy_quantity: buyQuantity,
            free_quantity: freeQuantity,
            discount_percent: discountPercent,
            
            // Promotion specific (for creating separate promotion record)
            discount_type: discountType,
            discount_value: discountValue,
            min_purchase: parseFloat(rule.minimum_amount || data.rule_min_amount) || 0,
            
            // Date fields
            start_date: new Date(),
            end_date: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000), // 1 year
            
            // Additional data for reference
            reward_product: data.reward_product,
            eligible_product: data.eligible_product,
            main_product: data.main_product
        };
    }

    /**
     * Extract name from multilingual format
     * @param {Object|string} name 
     */
    extractName(name) {
        if (typeof name === 'string') return name;
        if (typeof name === 'object' && name !== null) {
            return name.ar_001 || name.en_US || name.en || Object.values(name)[0] || 'Unknown Program';
        }
        return 'Unknown Program';
    }

    /**
     * Sync a single loyalty program
     * @param {Object} program - Transformed program data
     */
    async syncLoyaltyProgram(program) {
        if (!program.name) {
            logger.warn('Skipping loyalty program without name');
            this.syncStats.loyalty.skipped++;
            return null;
        }

        try {
            // Check existing by barcode and name
            const existing = await this.loyaltyExists(program.product_barcode, program.name);

            if (existing) {
                await this.updateLoyaltyProgram(program, existing.id);
                return { action: 'updated', id: existing.id };
            } else {
                const newId = await this.createLoyaltyProgram(program);
                return { action: 'created', id: newId };
            }
        } catch (error) {
            logger.error(`Error syncing loyalty program ${program.name}:`, error.message);
            return { action: 'error', error: error.message };
        }
    }

    /**
     * Sync a single promotion
     * @param {Object} promotion - Transformed promotion data
     */
    async syncPromotion(promotion) {
        if (!promotion.name) {
            logger.warn('Skipping promotion without name');
            this.syncStats.promotions.skipped++;
            return null;
        }

        try {
            // Check existing by barcode and name
            const existing = await this.promotionExists(promotion.product_barcode, promotion.name);

            if (existing) {
                await this.updatePromotion(promotion, existing.id);
                return { action: 'updated', id: existing.id };
            } else {
                const newId = await this.createPromotion(promotion);
                return { action: 'created', id: newId };
            }
        } catch (error) {
            logger.error(`Error syncing promotion ${promotion.name}:`, error.message);
            return { action: 'error', error: error.message };
        }
    }

    /**
     * Full sync from Odoo API
     * Uses the sync endpoint to get changed loyalty programs
     */
    async syncFromOdoo() {
        this.resetStats();
        const startTime = Date.now();

        try {
            logger.info('Starting loyalty/promotion sync from Odoo...');

            // Get sync data from Odoo
            const syncData = await odooApi.getLoyaltySync();

            if (!syncData.success) {
                throw new Error(syncData.error || 'Failed to get sync data from Odoo');
            }

            const { changes } = syncData;
            const allChanges = [
                ...(changes.created || []),
                ...(changes.updated || [])
            ];

            logger.info(`Processing ${allChanges.length} loyalty/promotion changes...`);

            // Process each change
            for (const change of allChanges) {
                const transformed = this.transformOdooLoyalty(change);
                
                // Decide whether to create as loyalty program or promotion
                if (transformed.type === 'BOGO') {
                    // Create/update as loyalty program
                    await this.syncLoyaltyProgram(transformed);
                } else if (transformed.type === 'DISCOUNT' && transformed.discount_value > 0) {
                    // Create as both loyalty program AND promotion for flexibility
                    await this.syncLoyaltyProgram(transformed);
                    
                    // Also create as promotion
                    const promoData = {
                        name: transformed.name,
                        description: `Auto-synced from Odoo: ${transformed.name}`,
                        discount_type: transformed.discount_type,
                        discount_value: transformed.discount_value,
                        min_purchase: transformed.min_purchase,
                        max_discount: null,
                        product_barcode: transformed.product_barcode,
                        category: transformed.category,
                        start_date: transformed.start_date,
                        end_date: transformed.end_date,
                        active: transformed.active
                    };
                    await this.syncPromotion(promoData);
                } else {
                    // Default to loyalty program
                    await this.syncLoyaltyProgram(transformed);
                }
            }

            this.syncStats.lastSync = new Date().toISOString();

            const duration = Date.now() - startTime;
            logger.info(`Loyalty/Promotion sync completed in ${duration}ms`, this.syncStats);

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
            logger.error('Loyalty/Promotion sync failed:', error.message);
            return {
                success: false,
                error: error.message,
                stats: this.getStats()
            };
        }
    }

    /**
     * Full sync using all loyalty programs endpoint
     */
    async syncAllLoyaltyPrograms() {
        this.resetStats();
        const startTime = Date.now();

        try {
            logger.info('Starting full loyalty/promotion sync from Odoo...');

            // Get all loyalty programs from Odoo
            const response = await odooApi.getAllLoyaltyPrograms();

            if (response.status !== 'success') {
                throw new Error(response.message || 'Failed to get loyalty programs from Odoo');
            }

            const programs = response.data || [];
            logger.info(`Processing ${programs.length} loyalty programs...`);

            // Group programs by program_id to avoid duplicates
            const programsMap = new Map();
            for (const programData of programs) {
                const programId = programData.program_id;
                if (!programsMap.has(programId)) {
                    programsMap.set(programId, programData);
                }
            }

            // Process each unique program
            for (const [programId, programData] of programsMap) {
                const transformed = this.transformOdooLoyalty(programData);

                if (transformed.type === 'BOGO') {
                    await this.syncLoyaltyProgram(transformed);
                } else if (transformed.type === 'DISCOUNT' && transformed.discount_value > 0) {
                    await this.syncLoyaltyProgram(transformed);
                    
                    const promoData = {
                        name: transformed.name,
                        description: `Auto-synced from Odoo: ${transformed.name}`,
                        discount_type: transformed.discount_type,
                        discount_value: transformed.discount_value,
                        min_purchase: transformed.min_purchase,
                        max_discount: null,
                        product_barcode: transformed.product_barcode,
                        category: transformed.category,
                        start_date: transformed.start_date,
                        end_date: transformed.end_date,
                        active: transformed.active
                    };
                    await this.syncPromotion(promoData);
                } else {
                    await this.syncLoyaltyProgram(transformed);
                }
            }

            this.syncStats.lastSync = new Date().toISOString();

            const duration = Date.now() - startTime;
            logger.info(`Full loyalty/promotion sync completed in ${duration}ms`, this.syncStats);

            return {
                success: true,
                stats: this.getStats(),
                duration
            };

        } catch (error) {
            logger.error('Full loyalty/promotion sync failed:', error.message);
            return {
                success: false,
                error: error.message,
                stats: this.getStats()
            };
        }
    }

    /**
     * Get all active loyalty programs
     */
    async getActiveLoyaltyPrograms() {
        return await db.query(`
            SELECT * FROM loyalty_programs 
            WHERE active = TRUE 
            AND NOW() BETWEEN start_date AND end_date 
            ORDER BY name
        `);
    }

    /**
     * Get all active promotions
     */
    async getActivePromotions() {
        return await db.query(`
            SELECT * FROM promotions 
            WHERE active = TRUE 
            AND NOW() BETWEEN start_date AND end_date 
            ORDER BY name
        `);
    }

    /**
     * Get loyalty programs for a specific product barcode
     * @param {string} barcode 
     */
    async getLoyaltyForProduct(barcode) {
        return await db.query(`
            SELECT * FROM loyalty_programs 
            WHERE active = TRUE 
            AND NOW() BETWEEN start_date AND end_date 
            AND (product_barcode = ? OR product_barcode IS NULL)
            ORDER BY product_barcode DESC, name
        `, [barcode]);
    }

    /**
     * Get promotions for a specific product barcode
     * @param {string} barcode 
     */
    async getPromotionsForProduct(barcode) {
        return await db.query(`
            SELECT * FROM promotions 
            WHERE active = TRUE 
            AND NOW() BETWEEN start_date AND end_date 
            AND (product_barcode = ? OR product_barcode IS NULL)
            ORDER BY product_barcode DESC, discount_value DESC
        `, [barcode]);
    }
}

module.exports = new LoyaltySyncService();
