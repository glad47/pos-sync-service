/**
 * Loyalty Sync Service (Unified)
 * Handles synchronization of loyalty programs between Odoo and local MySQL database.
 * Now uses a single loyalty_programs table with:
 *   type 0 = DISCOUNT
 *   type 1 = BUY_X_GET_Y
 *   trigger_product_ids = comma-separated barcodes
 *   reward_product_ids = comma-separated barcodes
 */

const db = require('../config/database');
const { odooApi } = require('../config/odooClient');
const logger = require('../utils/logger');

class LoyaltySyncService {
    constructor() {
        this.syncStats = {
            loyalty: { created: 0, updated: 0, skipped: 0, errors: 0 },
            lastSync: null
        };
    }

    resetStats() {
        this.syncStats = {
            loyalty: { created: 0, updated: 0, skipped: 0, errors: 0 },
            lastSync: null
        };
    }

    getStats() {
        return { ...this.syncStats };
    }

    async loyaltyExists(triggerProductIds, name) {
        const result = await db.query(
            'SELECT id, updated_at FROM loyalty_programs WHERE trigger_product_ids = ? AND name = ?',
            [triggerProductIds, name]
        );
        return result.length > 0 ? result[0] : null;
    }

    async createLoyaltyProgram(program) {
        try {
            const sql = `
                INSERT INTO loyalty_programs (
                    name, type, trigger_product_ids, reward_product_ids,
                    min_quantity, reward_quantity, discount_percent,
                    active, start_date, end_date, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
            `;

            const params = [
                program.name,
                program.type || 0,
                program.trigger_product_ids || null,
                program.reward_product_ids || null,
                program.min_quantity || 1,
                program.reward_quantity || 1,
                program.discount_percent || 0,
                program.active !== false,
                program.start_date || new Date(),
                program.end_date || new Date(Date.now() + 365 * 24 * 60 * 60 * 1000)
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

    async updateLoyaltyProgram(program, existingId) {
        try {
            const sql = `
                UPDATE loyalty_programs SET
                    name = ?,
                    type = ?,
                    trigger_product_ids = ?,
                    reward_product_ids = ?,
                    min_quantity = ?,
                    reward_quantity = ?,
                    discount_percent = ?,
                    active = ?,
                    start_date = ?,
                    end_date = ?,
                    updated_at = NOW()
                WHERE id = ?
            `;

            const params = [
                program.name,
                program.type || 0,
                program.trigger_product_ids || null,
                program.reward_product_ids || null,
                program.min_quantity || 1,
                program.reward_quantity || 1,
                program.discount_percent || 0,
                program.active !== false,
                program.start_date || new Date(),
                program.end_date || new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
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
     * Transform Odoo loyalty data to new unified format
     */
    transformOdooLoyalty(odooData) {
        const data = odooData.data || odooData;

        // Extract barcodes
        let triggerBarcode = null;
        let rewardBarcode = null;

        if (data.main_product?.barcode && data.main_product.barcode !== 'N/A') {
            triggerBarcode = data.main_product.barcode;
        } else if (data.main_product_barcode && data.main_product_barcode !== 'N/A') {
            triggerBarcode = data.main_product_barcode;
        }

        if (data.eligible_product?.barcode) {
            rewardBarcode = data.eligible_product.barcode;
        } else if (data.eligible_product_barcode) {
            rewardBarcode = data.eligible_product_barcode;
        } else if (data.reward_product?.barcode) {
            rewardBarcode = data.reward_product.barcode;
        }

        // Determine program type
        let programType = 0; // default DISCOUNT
        let minQuantity = 1;
        let rewardQuantity = 1;
        let discountPercent = 0;

        const rule = data.rule || {};

        if (data.reward_product?.id && !rule.discount) {
            // BUY_X_GET_Y
            programType = 1;
            minQuantity = parseInt(rule.minimum_qty || data.rule_min_qty) || 1;
            rewardQuantity = 1;
        } else if (rule.discount || parseFloat(rule.discount || 0) > 0) {
            // DISCOUNT
            programType = 0;
            discountPercent = parseFloat(rule.discount || data.rule_discount || 0);
        } else if (data.rule_after_discount || data.rule_total_price) {
            programType = 0;
            const originalPrice = parseFloat(data.rule_total_price || 0);
            const afterDiscount = parseFloat(data.rule_after_discount || 0);
            if (originalPrice > 0) {
                discountPercent = ((originalPrice - afterDiscount) / originalPrice) * 100;
            }
        }

        const programName = this.extractName(data.program_name || data.name);

        return {
            name: programName,
            type: programType,
            trigger_product_ids: triggerBarcode || null,
            reward_product_ids: rewardBarcode || null,
            min_quantity: minQuantity,
            reward_quantity: rewardQuantity,
            discount_percent: discountPercent,
            active: data.rule?.active !== false && data.rule_active !== false,
            start_date: new Date(),
            end_date: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000)
        };
    }

    extractName(name) {
        if (typeof name === 'string') return name;
        if (typeof name === 'object' && name !== null) {
            return name.ar_001 || name.en_US || name.en || Object.values(name)[0] || 'Unknown Program';
        }
        return 'Unknown Program';
    }

    async syncLoyaltyProgram(program) {
        if (!program.name) {
            logger.warn('Skipping loyalty program without name');
            this.syncStats.loyalty.skipped++;
            return null;
        }

        try {
            const existing = await this.loyaltyExists(program.trigger_product_ids, program.name);

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

    async syncFromOdoo() {
        this.resetStats();
        const startTime = Date.now();

        try {
            logger.info('Starting loyalty sync from Odoo...');

            const syncData = await odooApi.getLoyaltySync();

            if (!syncData.success) {
                throw new Error(syncData.error || 'Failed to get sync data from Odoo');
            }

            const { changes } = syncData;
            const allChanges = [
                ...(changes.created || []),
                ...(changes.updated || [])
            ];

            logger.info(`Processing ${allChanges.length} loyalty changes...`);

            for (const change of allChanges) {
                const transformed = this.transformOdooLoyalty(change);
                await this.syncLoyaltyProgram(transformed);
            }

            this.syncStats.lastSync = new Date().toISOString();

            const duration = Date.now() - startTime;
            logger.info(`Loyalty sync completed in ${duration}ms`, this.syncStats);

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
            logger.error('Loyalty sync failed:', error.message);
            return {
                success: false,
                error: error.message,
                stats: this.getStats()
            };
        }
    }

    async syncAllLoyaltyPrograms() {
        this.resetStats();
        const startTime = Date.now();

        try {
            logger.info('Starting full loyalty sync from Odoo...');

            const response = await odooApi.getAllLoyaltyPrograms();

            if (response.status !== 'success') {
                throw new Error(response.message || 'Failed to get loyalty programs from Odoo');
            }

            const programs = response.data || [];
            logger.info(`Processing ${programs.length} loyalty programs...`);

            const programsMap = new Map();
            for (const programData of programs) {
                const programId = programData.program_id;
                if (!programsMap.has(programId)) {
                    programsMap.set(programId, programData);
                }
            }

            for (const [programId, programData] of programsMap) {
                const transformed = this.transformOdooLoyalty(programData);
                await this.syncLoyaltyProgram(transformed);
            }

            this.syncStats.lastSync = new Date().toISOString();

            const duration = Date.now() - startTime;
            logger.info(`Full loyalty sync completed in ${duration}ms`, this.syncStats);

            return {
                success: true,
                stats: this.getStats(),
                duration
            };

        } catch (error) {
            logger.error('Full loyalty sync failed:', error.message);
            return {
                success: false,
                error: error.message,
                stats: this.getStats()
            };
        }
    }

    async getActiveLoyaltyPrograms() {
        return await db.query(`
            SELECT * FROM loyalty_programs 
            WHERE active = TRUE 
            AND NOW() BETWEEN start_date AND end_date 
            ORDER BY name
        `);
    }

    async getLoyaltyForProduct(barcode) {
        return await db.query(`
            SELECT * FROM loyalty_programs 
            WHERE active = TRUE 
            AND NOW() BETWEEN start_date AND end_date 
            AND (FIND_IN_SET(?, trigger_product_ids) > 0 OR trigger_product_ids IS NULL)
            ORDER BY name
        `, [barcode]);
    }
}

module.exports = new LoyaltySyncService();
