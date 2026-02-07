/**
 * Loyalty Sync Service (Unified)
 * Handles synchronization of loyalty programs between Odoo and local MySQL database.
 * 
 * The Odoo loyalty export (CSV) has one row per eligible product per program.
 * We GROUP by program_id and collect all eligible_product_barcode values into
 * a comma-separated list stored in trigger_product_ids and reward_product_ids.
 * 
 * The discount model is FIXED AMOUNT:
 *   - Buy `min_qty` items from the eligible group
 *   - Pay `after_discount` total instead of `total_price * min_qty`
 *   - discount_amount = (total_price * min_qty) - after_discount
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

    /**
     * Check if a loyalty program already exists by odoo_program_id
     */
    async loyaltyExistsByProgramId(odooProgramId) {
        const result = await db.query(
            'SELECT id, updated_at FROM loyalty_programs WHERE odoo_program_id = ?',
            [odooProgramId]
        );
        return result.length > 0 ? result[0] : null;
    }

    /**
     * Check if a loyalty program exists by trigger_product_ids and name (fallback)
     */
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
                    min_quantity, max_quantity, reward_quantity, 
                    discount_percent, discount_amount, after_discount, total_price,
                    active, start_date, end_date,
                    odoo_program_id, odoo_rule_id, last_sync_at,
                    created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW(), NOW())
            `;

            const params = [
                program.name,
                program.type || 0,
                program.trigger_product_ids || null,
                program.reward_product_ids || null,
                program.min_quantity || 1,
                program.max_quantity || 1,
                program.reward_quantity || 1,
                program.discount_percent || 0,
                program.discount_amount || null,
                program.after_discount || null,
                program.total_price || null,
                program.active !== false ? 1 : 0,
                program.start_date || new Date(),
                program.end_date || new Date(Date.now() + 2 * 365 * 24 * 60 * 60 * 1000),
                program.odoo_program_id || null,
                program.odoo_rule_id || null
            ];

            const result = await db.query(sql, params);
            this.syncStats.loyalty.created++;
            logger.info(`Created loyalty program: ${program.name} (odoo_id=${program.odoo_program_id})`);
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
                    max_quantity = ?,
                    reward_quantity = ?,
                    discount_percent = ?,
                    discount_amount = ?,
                    after_discount = ?,
                    total_price = ?,
                    active = ?,
                    start_date = ?,
                    end_date = ?,
                    odoo_program_id = ?,
                    odoo_rule_id = ?,
                    last_sync_at = NOW(),
                    updated_at = NOW()
                WHERE id = ?
            `;

            const params = [
                program.name,
                program.type || 0,
                program.trigger_product_ids || null,
                program.reward_product_ids || null,
                program.min_quantity || 1,
                program.max_quantity || 1,
                program.reward_quantity || 1,
                program.discount_percent || 0,
                program.discount_amount || null,
                program.after_discount || null,
                program.total_price || null,
                program.active !== false ? 1 : 0,
                program.start_date || new Date(),
                program.end_date || new Date(Date.now() + 2 * 365 * 24 * 60 * 60 * 1000),
                program.odoo_program_id || null,
                program.odoo_rule_id || null,
                existingId
            ];

            await db.query(sql, params);
            this.syncStats.loyalty.updated++;
            logger.info(`Updated loyalty program: ${program.name} (id=${existingId})`);
        } catch (error) {
            this.syncStats.loyalty.errors++;
            logger.error(`Failed to update loyalty program ${program.name}:`, error.message);
            throw error;
        }
    }

    /**
     * Group raw Odoo/CSV rows by program_id into loyalty programs.
     * Each row has one eligible product; we collect all barcodes per program.
     * 
     * Expected row fields (from CSV/API):
     *   program_id, program_name, 
     *   loyalty_program_total_price, loyalty_program_after_discount, loyalty_program_discount,
     *   loyalty_program_minimum_qty,
     *   rule_id, rule_active,
     *   eligible_product_barcode
     */
    groupByProgram(rows) {
        const groups = new Map();

        for (const row of rows) {
            const programId = row.program_id;
            if (!programId) continue;

            const barcode = row.eligible_product_barcode || row.main_product_barcode;
            if (!barcode) continue;

            if (!groups.has(programId)) {
                groups.set(programId, {
                    program_id: programId,
                    program_name: row.program_name,
                    total_price: parseFloat(row.loyalty_program_total_price) || 0,
                    after_discount: parseFloat(row.loyalty_program_after_discount) || 0,
                    discount: parseFloat(row.loyalty_program_discount) || 0,
                    min_qty: parseInt(row.loyalty_program_minimum_qty) || 1,
                    rule_id: row.rule_id,
                    rule_active: row.rule_active,
                    barcodes: new Set()
                });
            }

            groups.get(programId).barcodes.add(barcode);
        }

        return groups;
    }

    /**
     * Transform a grouped program into the loyalty_programs table format
     */
    transformGroupedProgram(group) {
        const barcodes = [...group.barcodes].join(',');
        const fullPrice = group.total_price * group.min_qty;
        let discountPercent = 0;
        if (fullPrice > 0) {
            discountPercent = Math.round((group.discount / fullPrice) * 10000) / 100;
        }

        return {
            name: group.program_name || 'Unknown Program',
            type: 0, // DISCOUNT (fixed amount)
            trigger_product_ids: barcodes,
            reward_product_ids: barcodes, // Same group: eligible = trigger = reward
            min_quantity: group.min_qty,
            max_quantity: 1,
            reward_quantity: group.min_qty,
            discount_percent: discountPercent,
            discount_amount: Math.round(group.discount * 100) / 100,
            after_discount: Math.round(group.after_discount * 100) / 100,
            total_price: Math.round(group.total_price * 100) / 100,
            active: group.rule_active === 'True' || group.rule_active === true,
            odoo_program_id: parseInt(group.program_id) || null,
            odoo_rule_id: parseInt(group.rule_id) || null,
            start_date: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000),
            end_date: new Date(Date.now() + 2 * 365 * 24 * 60 * 60 * 1000)
        };
    }

    /**
     * Sync a single loyalty program (upsert by odoo_program_id, then by name)
     */
    async syncLoyaltyProgram(program) {
        if (!program.name) {
            logger.warn('Skipping loyalty program without name');
            this.syncStats.loyalty.skipped++;
            return null;
        }

        try {
            // Try by odoo_program_id first
            let existing = null;
            if (program.odoo_program_id) {
                existing = await this.loyaltyExistsByProgramId(program.odoo_program_id);
            }
            // Fallback: by trigger_product_ids + name
            if (!existing) {
                existing = await this.loyaltyExists(program.trigger_product_ids, program.name);
            }

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
     * Sync from Odoo (incremental)
     */
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

            logger.info(`Processing ${allChanges.length} loyalty change rows...`);

            // Group by program_id
            const groups = this.groupByProgram(allChanges);
            logger.info(`Grouped into ${groups.size} loyalty programs`);

            for (const [programId, group] of groups) {
                const transformed = this.transformGroupedProgram(group);
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

    /**
     * Full sync - Load all loyalty programs from Odoo
     */
    async syncAllLoyaltyPrograms() {
        this.resetStats();
        const startTime = Date.now();

        try {
            logger.info('Starting full loyalty sync from Odoo...');

            const response = await odooApi.getAllLoyaltyPrograms();

            if (response.status !== 'success') {
                throw new Error(response.message || 'Failed to get loyalty programs from Odoo');
            }

            const rows = response.data || [];
            logger.info(`Processing ${rows.length} loyalty rows from Odoo...`);

            // Group all rows by program_id
            const groups = this.groupByProgram(rows);
            logger.info(`Grouped into ${groups.size} loyalty programs`);

            for (const [programId, group] of groups) {
                const transformed = this.transformGroupedProgram(group);
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
