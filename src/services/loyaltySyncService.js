/**
 * Loyalty Sync Service (Unified)
 * Handles synchronization of loyalty programs between Odoo and local MySQL database.
 * 
 * Filters for PROMOTION and BUY X GET Y program types only.
 * Compares with local data and only updates changed records (similar to product sync).
 * 
 * The Odoo loyalty export (CSV) has one row per eligible product per program.
 * We GROUP by program_id and collect all eligible_product_id values into
 * a comma-separated list stored in trigger_product_ids and reward_product_ids.
 * 
 * FIXED: Archive/unarchive detection and false update reporting
 */

const db = require('../config/database');
const { odooApi } = require('../config/odooClient');
const logger = require('../utils/logger');

class LoyaltySyncService {
    constructor() {
        this.syncStats = {
            created: 0,
            updated: 0,
            skipped: 0,
            unchanged: 0,
            filtered: 0,
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
            filtered: 0,
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
     * Load all local loyalty programs indexed by odoo_program_id
     * @returns {Map<number, Object>} Map of odoo_program_id to program data
     */
    async loadLocalLoyaltyPrograms() {
        const programs = await db.query('SELECT * FROM loyalty_programs');
        const programMap = new Map();
        
        for (const program of programs) {
            if (program.odoo_program_id) {
                programMap.set(program.odoo_program_id, program);
            }
        }
        
        logger.info(`Loaded ${programMap.size} local loyalty programs`);
        return programMap;
    }

    /**
     * Normalize product ID lists for comparison
     * Sorts IDs and removes duplicates to ensure consistent comparison
     * @param {string} productIds - Comma-separated product IDs
     * @returns {string} Normalized product IDs
     */
    normalizeProductIds(productIds) {
        if (!productIds || productIds === '') return '';
        
        // Split, trim, filter out empties, convert to numbers, sort, dedupe
        const ids = productIds
            .split(',')
            .map(id => id.trim())
            .filter(id => id !== '')
            .map(id => parseInt(id))
            .filter(id => !isNaN(id));
        
        // Remove duplicates and sort
        const uniqueIds = [...new Set(ids)].sort((a, b) => a - b);
        
        return uniqueIds.join(',');
    }

    /**
     * Check if loyalty program data has changed
     * @param {Object} odooProgram - Transformed program from Odoo
     * @param {Object} localProgram - Existing program from local DB
     * @returns {boolean} True if program has changes
     */
    hasChanges(odooProgram, localProgram) {
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

        const fieldsToCompare = [
            { odoo: 'name', local: 'name' },
            { odoo: 'type', local: 'type' },
            { odoo: 'trigger_product_ids', local: 'trigger_product_ids', isProductIds: true },
            { odoo: 'reward_product_ids', local: 'reward_product_ids', isProductIds: true },
            { odoo: 'min_quantity', local: 'min_quantity' },
            { odoo: 'max_quantity', local: 'max_quantity' },
            { odoo: 'reward_quantity', local: 'reward_quantity' },
            { odoo: 'discount_percent', local: 'discount_percent' },
            { odoo: 'discount_amount', local: 'discount_amount' },
            { odoo: 'after_discount', local: 'after_discount' },
            { odoo: 'total_price', local: 'total_price' },
            { odoo: 'active', local: 'active' },
            { odoo: 'odoo_rule_id', local: 'odoo_rule_id' }
        ];

        for (const field of fieldsToCompare) {
            let odooValue = odooProgram[field.odoo];
            let localValue = localProgram[field.local];

            // Normalize values based on field type
            if (field.odoo === 'active') {
                odooValue = normalizeActive(odooValue);
                localValue = normalizeActive(localValue);
            } else if (field.isProductIds) {
                // Normalize product ID lists (sort and dedupe)
                odooValue = this.normalizeProductIds(odooValue);
                localValue = this.normalizeProductIds(localValue);
            } else if (field.odoo === 'type' || field.odoo === 'min_quantity' || 
                       field.odoo === 'max_quantity' || field.odoo === 'reward_quantity' || 
                       field.odoo === 'odoo_rule_id') {
                odooValue = normalizeInt(odooValue, null);
                localValue = normalizeInt(localValue, null);
            } else if (field.odoo === 'discount_percent' || field.odoo === 'discount_amount' || 
                       field.odoo === 'after_discount' || field.odoo === 'total_price') {
                odooValue = normalizeNumber(odooValue, null);
                localValue = normalizeNumber(localValue, null);
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
     * Group raw Odoo rows by program_id into loyalty programs.
     * 
     * Expected row format from Odoo API:
     * {
     *   program_id: number,
     *   name: string,
     *   type: string,
     *   promotion_type: string,
     *   active: boolean,
     *   buy_quantity: number,
     *   free_quantity: number,
     *   reward_quantity: number,
     *   discount_percent: number,
     *   discount_amount: number,
     *   after_discount: number,
     *   total_price: number,
     *   min_quantity: number,
     *   loyalty_program_total_price: number,
     *   loyalty_program_after_discount: number,
     *   loyalty_program_discount: number,
     *   loyalty_program_minimum_qty: number,
     *   rule_id: number,
     *   rule_active: boolean,
     *   main_product: { id, name, barcode, price },
     *   eligible_products: [{ id, name, barcode, price }, ...],
     *   reward_product: { id, name, barcode, price } | null
     * }
     */
    groupByProgram(rows) {
        const groups = new Map();

        for (const row of rows) {
            const programId = row.program_id;
            if (!programId) continue;

            // For each row, collect product IDs from eligible_products array
            const eligibleProducts = row.eligible_products || [];
            
            if (!groups.has(programId)) {
                groups.set(programId, {
                    program_id: programId,
                    program_name: row.name,
                    program_type: row.promotion_type || row.type || 'promotion',
                    total_price: parseFloat(row.loyalty_program_total_price || row.total_price) || 0,
                    after_discount: parseFloat(row.loyalty_program_after_discount || row.after_discount) || 0,
                    discount: parseFloat(row.loyalty_program_discount || row.discount_amount) || 0,
                    min_qty: parseInt(row.loyalty_program_minimum_qty || row.min_quantity || row.buy_quantity) || 1,
                    buy_quantity: parseInt(row.buy_quantity) || 1,
                    free_quantity: parseInt(row.free_quantity) || 1,
                    reward_quantity: parseInt(row.reward_quantity || row.free_quantity) || 1,
                    discount_percent: parseFloat(row.discount_percent) || 0,
                    rule_id: row.rule_id,
                    rule_active: row.rule_active,
                    active: row.active,
                    product_ids: new Set()
                });
            }

            // Add all eligible product IDs
            for (const product of eligibleProducts) {
                if (product && product.id) {
                    groups.get(programId).product_ids.add(product.id);
                }
            }

            // Also add main_product if it exists and eligible_products is empty
            if (eligibleProducts.length === 0 && row.main_product && row.main_product.id) {
                groups.get(programId).product_ids.add(row.main_product.id);
            }
        }

        return groups;
    }

    /**
     * Filter programs to only include PROMOTION and BUY X GET Y types
     * @param {Map} groups - Grouped programs
     * @returns {Map} Filtered groups
     */
    filterProgramTypes(groups) {
        const filtered = new Map();
        const allowedTypes = ['promotion', 'buy_x_get_y', 'buyxgety'];

        for (const [programId, group] of groups) {
            const programType = (group.program_type || '').toLowerCase();
            
            if (allowedTypes.includes(programType)) {
                filtered.set(programId, group);
            } else {
                this.syncStats.filtered++;
                logger.debug(`Filtered out program ${programId} (${group.program_name}) - type: ${programType}`);
            }
        }

        logger.info(`Filtered ${groups.size} programs down to ${filtered.size} (promotion/buy_x_get_y only)`);
        return filtered;
    }

    /**
     * Transform a grouped program into the loyalty_programs table format
     */
    transformGroupedProgram(group) {
        // Sort product IDs for consistent storage
        const productIds = [...group.product_ids].sort((a, b) => a - b).join(',');
        const fullPrice = group.total_price * group.min_qty;
        let discountPercent = 0;
        if (fullPrice > 0) {
            discountPercent = Math.round((group.discount / fullPrice) * 10000) / 100;
        }

        // Determine type: 0 = DISCOUNT/PROMOTION, 1 = BUY X GET Y
        const programType = (group.program_type || '').toLowerCase();
        const type = (programType === 'buy_x_get_y' || programType === 'buyxgety') ? 1 : 0;

        return {
            name: group.program_name || 'Unknown Program',
            type: type,
            trigger_product_ids: productIds,
            reward_product_ids: productIds,
            min_quantity: group.min_qty || group.buy_quantity || 1,
            max_quantity: 1,
            reward_quantity: group.reward_quantity || group.free_quantity || 1,
            discount_percent: discountPercent || group.discount_percent || 0,
            discount_amount: Math.round(group.discount * 100) / 100,
            after_discount: Math.round(group.after_discount * 100) / 100,
            total_price: Math.round(group.total_price * 100) / 100,
            active: group.active !== undefined ? (group.active === true || group.active === 'True') : (group.rule_active === 'True' || group.rule_active === true),
            odoo_program_id: parseInt(group.program_id) || null,
            odoo_rule_id: parseInt(group.rule_id) || null,
            start_date: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000),
            end_date: new Date(Date.now() + 2 * 365 * 24 * 60 * 60 * 1000)
        };
    }

    /**
     * Create a new loyalty program in local database
     */
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
            this.syncStats.created++;
            logger.info(`Created loyalty program: [${program.odoo_program_id}] ${program.name} (active=${program.active})`);
            return result.insertId;
        } catch (error) {
            this.syncStats.errors++;
            logger.error(`Failed to create loyalty program ${program.name}:`, error.message);
            throw error;
        }
    }

    /**
     * Update existing loyalty program in local database
     */
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
            this.syncStats.updated++;
            logger.info(`Updated loyalty program: [${program.odoo_program_id}] ${program.name} (id=${existingId}, active=${program.active})`);
        } catch (error) {
            this.syncStats.errors++;
            logger.error(`Failed to update loyalty program ${program.name}:`, error.message);
            throw error;
        }
    }

    /**
     * Full sync - Load all from Odoo, filter types, compare with local, update only changes
     */
    async syncAllLoyaltyPrograms() {
        this.resetStats();
        const startTime = Date.now();

        try {
            logger.info('Starting full loyalty sync from Odoo...');

            // Step 1: Load all loyalty programs from Odoo
            logger.info('Loading loyalty programs from Odoo...');
            const response = await odooApi.getAllLoyaltyPrograms();

            if (response.status !== 'success') {
                throw new Error(response.message || 'Failed to get loyalty programs from Odoo');
            }

            const rows = response.data || [];
            logger.info(`Loaded ${rows.length} loyalty rows from Odoo`);

            // Debug: log first row to see data structure
            if (rows.length > 0) {
                logger.debug('First loyalty row raw data:', JSON.stringify(rows[0]));
            }

            // Step 2: Group all rows by program_id
            logger.info('Grouping loyalty programs...');
            const allGroups = this.groupByProgram(rows);
            logger.info(`Grouped into ${allGroups.size} loyalty programs`);

            // Step 3: Filter to only PROMOTION and BUY X GET Y types
            const filteredGroups = this.filterProgramTypes(allGroups);

            // Step 4: Load all local loyalty programs indexed by odoo_program_id
            logger.info('Loading local loyalty programs...');
            const localProgramsMap = await this.loadLocalLoyaltyPrograms();

            // Step 5: Process each filtered Odoo program
            logger.info('Comparing and syncing loyalty programs...');

            for (const [programId, group] of filteredGroups) {
                const program = this.transformGroupedProgram(group);

                // Skip programs without valid odoo_program_id
                if (!program.odoo_program_id) {
                    logger.warn(`Skipping program without odoo_program_id: ${program.name}`);
                    this.syncStats.skipped++;
                    continue;
                }

                try {
                    const existingProgram = localProgramsMap.get(program.odoo_program_id);

                    if (existingProgram) {
                        // Program exists - check if it has changes
                        if (this.hasChanges(program, existingProgram)) {
                            await this.updateLoyaltyProgram(program, existingProgram.id);
                        } else {
                            this.syncStats.unchanged++;
                            logger.debug(`No changes for: [${program.odoo_program_id}] ${program.name}`);
                        }
                    } else {
                        // New program - create it
                        await this.createLoyaltyProgram(program);
                    }
                } catch (error) {
                    logger.error(`Error processing loyalty program ${program.odoo_program_id}:`, error.message);
                    // Continue with next program
                }
            }

            this.syncStats.lastSync = new Date().toISOString();

            const duration = Date.now() - startTime;
            logger.info(`Full loyalty sync completed in ${duration}ms`, this.syncStats);

            return {
                success: true,
                stats: this.getStats(),
                duration,
                summary: {
                    totalFromOdoo: rows.length,
                    totalGrouped: allGroups.size,
                    totalFiltered: filteredGroups.size,
                    totalLocal: localProgramsMap.size,
                    created: this.syncStats.created,
                    updated: this.syncStats.updated,
                    unchanged: this.syncStats.unchanged,
                    filtered: this.syncStats.filtered,
                    skipped: this.syncStats.skipped,
                    errors: this.syncStats.errors
                }
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

    /**
     * Get all active local loyalty programs
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
     * Get loyalty programs for a specific product
     */
    async getLoyaltyForProduct(productId) {
        return await db.query(`
            SELECT * FROM loyalty_programs 
            WHERE active = TRUE 
            AND NOW() BETWEEN start_date AND end_date 
            AND (FIND_IN_SET(?, trigger_product_ids) > 0 OR trigger_product_ids IS NULL)
            ORDER BY name
        `, [productId]);
    }

    /**
     * Get loyalty program by odoo_program_id
     */
    async getLoyaltyByOdooId(odooProgramId) {
        const result = await db.query(
            'SELECT * FROM loyalty_programs WHERE odoo_program_id = ?',
            [odooProgramId]
        );
        return result.length > 0 ? result[0] : null;
    }
}

module.exports = new LoyaltySyncService();