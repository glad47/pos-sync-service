/**
 * Sync API Routes
 * Provides REST endpoints for sync operations
 */

const express = require('express');
const router = express.Router();
const syncOrchestrator = require('../services/syncOrchestrator');
const productSyncService = require('../services/productSyncService');
const loyaltySyncService = require('../services/loyaltySyncService');
const logger = require('../utils/logger');

/**
 * GET /api/sync/status
 * Get current sync status
 */
router.get('/status', (req, res) => {
    try {
        const status = syncOrchestrator.getStatus();
        res.json({
            success: true,
            ...status
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * POST /api/sync/full
 * Trigger full sync (products + loyalty)
 */
router.post('/full', async (req, res) => {
    try {
        logger.info('Manual full sync triggered via API');
        
        // Run sync asynchronously
        const result = await syncOrchestrator.runFullSync();
        
        res.json({
            success: true,
            message: 'Full sync completed',
            result
        });
    } catch (error) {
        logger.error('Full sync API error:', error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * POST /api/sync/products
 * Trigger products sync only
 */
router.post('/products', async (req, res) => {
    try {
        logger.info('Manual products sync triggered via API');
        
        const result = await syncOrchestrator.syncProducts();
        
        res.json({
            success: true,
            message: 'Products sync completed',
            result
        });
    } catch (error) {
        logger.error('Products sync API error:', error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * POST /api/sync/loyalty
 * Trigger loyalty/promotions sync only
 */
router.post('/loyalty', async (req, res) => {
    try {
        logger.info('Manual loyalty sync triggered via API');
        
        const result = await syncOrchestrator.syncLoyalty();
        
        res.json({
            success: true,
            message: 'Loyalty sync completed',
            result
        });
    } catch (error) {
        logger.error('Loyalty sync API error:', error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * GET /api/sync/products/stats
 * Get product sync statistics
 */
router.get('/products/stats', (req, res) => {
    try {
        const stats = productSyncService.getStats();
        res.json({
            success: true,
            stats
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * GET /api/sync/loyalty/stats
 * Get loyalty sync statistics
 */
router.get('/loyalty/stats', (req, res) => {
    try {
        const stats = loyaltySyncService.getStats();
        res.json({
            success: true,
            stats
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * POST /api/sync/cron/start
 * Start automatic sync cron job
 */
router.post('/cron/start', (req, res) => {
    try {
        syncOrchestrator.setupCronJob();
        res.json({
            success: true,
            message: 'Automatic sync started',
            schedule: process.env.SYNC_CRON_SCHEDULE || '*/5 * * * *'
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * POST /api/sync/cron/stop
 * Stop automatic sync cron job
 */
router.post('/cron/stop', (req, res) => {
    try {
        syncOrchestrator.stopCronJob();
        res.json({
            success: true,
            message: 'Automatic sync stopped'
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

module.exports = router;
