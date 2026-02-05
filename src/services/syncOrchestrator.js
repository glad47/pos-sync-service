/**
 * Sync Orchestrator Service
 * Coordinates all sync operations between Odoo and local MySQL database
 */

const productSyncService = require('./productSyncService');
const loyaltySyncService = require('./loyaltySyncService');
const db = require('../config/database');
const { odooApi } = require('../config/odooClient');
const logger = require('../utils/logger');
const cron = require('node-cron');

class SyncOrchestrator {
    constructor() {
        this.isRunning = false;
        this.lastSyncResult = null;
        this.cronJob = null;
    }

    /**
     * Initialize sync service
     * Tests connections and optionally runs initial sync
     */
    async initialize() {
        logger.info('Initializing Sync Orchestrator...');

        // Test database connection
        const dbConnected = await db.testConnection();
        if (!dbConnected) {
            throw new Error('Failed to connect to MySQL database');
        }

        // Test Odoo API connection
        const odooConnected = await odooApi.testConnection();
        if (!odooConnected) {
            logger.warn('Odoo API connection failed - sync will be attempted later');
        }

        // Setup cron job if enabled
        if (process.env.AUTO_SYNC_ENABLED === 'true') {
            this.setupCronJob();
        }

        // Run initial sync if configured
        if (process.env.SYNC_ON_STARTUP === 'true') {
            logger.info('Running initial sync on startup...');
            // Run in background to not block startup
            setImmediate(() => this.runFullSync());
        }

        logger.info('Sync Orchestrator initialized successfully');
    }

    /**
     * Setup cron job for automatic sync
     */
    setupCronJob() {
        const schedule = process.env.SYNC_CRON_SCHEDULE || '*/5 * * * *';
        
        if (this.cronJob) {
            this.cronJob.stop();
        }

        this.cronJob = cron.schedule(schedule, async () => {
            logger.info('Cron triggered: Starting scheduled sync...');
            await this.runFullSync();
        });

        logger.info(`Automatic sync scheduled: ${schedule}`);
    }

    /**
     * Stop cron job
     */
    stopCronJob() {
        if (this.cronJob) {
            this.cronJob.stop();
            this.cronJob = null;
            logger.info('Automatic sync stopped');
        }
    }

    /**
     * Run full sync (products + loyalty programs)
     */
    async runFullSync() {
        if (this.isRunning) {
            logger.warn('Sync already in progress, skipping...');
            return {
                success: false,
                error: 'Sync already in progress'
            };
        }

        this.isRunning = true;
        const startTime = Date.now();
        
        try {
            logger.info('========================================');
            logger.info('Starting Full Sync');
            logger.info('========================================');

            const results = {
                products: null,
                loyalty: null,
                startTime: new Date().toISOString(),
                endTime: null,
                duration: null,
                success: true
            };

            // Sync products
            logger.info('--- Syncing Products ---');
            results.products = await productSyncService.syncFromOdoo();
            if (!results.products.success) {
                logger.warn('Product sync had issues:', results.products.error);
            }

            // Sync loyalty programs
            logger.info('--- Syncing Loyalty Programs ---');
            results.loyalty = await loyaltySyncService.syncFromOdoo();
            if (!results.loyalty.success) {
                logger.warn('Loyalty sync had issues:', results.loyalty.error);
            }

            results.endTime = new Date().toISOString();
            results.duration = Date.now() - startTime;
            results.success = results.products?.success && results.loyalty?.success;

            this.lastSyncResult = results;

            logger.info('========================================');
            logger.info(`Full Sync Completed in ${results.duration}ms`);
            logger.info(`Products: ${JSON.stringify(results.products?.stats || {})}`);
            logger.info(`Loyalty: ${JSON.stringify(results.loyalty?.stats || {})}`);
            logger.info('========================================');

            return results;

        } catch (error) {
            logger.error('Full sync failed:', error.message);
            return {
                success: false,
                error: error.message,
                duration: Date.now() - startTime
            };
        } finally {
            this.isRunning = false;
        }
    }

    /**
     * Run products sync only
     */
    async syncProducts() {
        if (this.isRunning) {
            return { success: false, error: 'Sync in progress' };
        }

        this.isRunning = true;
        try {
            logger.info('Starting Products Sync...');
            const result = await productSyncService.syncFromOdoo();
            return result;
        } finally {
            this.isRunning = false;
        }
    }

    /**
     * Run loyalty sync only
     */
    async syncLoyalty() {
        if (this.isRunning) {
            return { success: false, error: 'Sync in progress' };
        }

        this.isRunning = true;
        try {
            logger.info('Starting Loyalty Sync...');
            const result = await loyaltySyncService.syncFromOdoo();
            return result;
        } finally {
            this.isRunning = false;
        }
    }

    /**
     * Get sync status
     */
    getStatus() {
        return {
            isRunning: this.isRunning,
            lastSync: this.lastSyncResult,
            cronEnabled: !!this.cronJob,
            cronSchedule: process.env.SYNC_CRON_SCHEDULE || '*/5 * * * *'
        };
    }

    /**
     * Get all local data for POS
     */
    async getPosData() {
        try {
            const [products, loyalty, promotions] = await Promise.all([
                productSyncService.getLocalProducts(),
                loyaltySyncService.getActiveLoyaltyPrograms(),
                loyaltySyncService.getActivePromotions()
            ]);

            return {
                success: true,
                data: {
                    products,
                    loyalty,
                    promotions
                },
                counts: {
                    products: products.length,
                    loyalty: loyalty.length,
                    promotions: promotions.length
                }
            };
        } catch (error) {
            logger.error('Failed to get POS data:', error.message);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Cleanup resources
     */
    async cleanup() {
        this.stopCronJob();
        await db.closePool();
        logger.info('Sync Orchestrator cleaned up');
    }
}

module.exports = new SyncOrchestrator();
