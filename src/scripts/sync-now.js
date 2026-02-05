#!/usr/bin/env node

/**
 * Manual Sync Script
 * Run full sync manually: npm run sync
 */

require('dotenv').config();

const syncOrchestrator = require('../services/syncOrchestrator');
const db = require('../config/database');
const logger = require('../utils/logger');

async function runSync() {
    console.log('========================================');
    console.log('POS Sync Service - Manual Full Sync');
    console.log('========================================\n');

    try {
        // Initialize database connection
        await db.testConnection();
        
        console.log('Starting full sync...\n');
        
        // Run full sync
        const result = await syncOrchestrator.runFullSync();
        
        console.log('\n========================================');
        console.log('Sync Results:');
        console.log('========================================');
        
        if (result.success) {
            console.log('\n✅ Sync completed successfully!\n');
            
            console.log('Products:');
            console.log(`  - Created: ${result.products?.stats?.created || 0}`);
            console.log(`  - Updated: ${result.products?.stats?.updated || 0}`);
            console.log(`  - Skipped: ${result.products?.stats?.skipped || 0}`);
            console.log(`  - Errors: ${result.products?.stats?.errors || 0}`);
            
            console.log('\nLoyalty Programs:');
            console.log(`  - Created: ${result.loyalty?.stats?.loyalty?.created || 0}`);
            console.log(`  - Updated: ${result.loyalty?.stats?.loyalty?.updated || 0}`);
            console.log(`  - Errors: ${result.loyalty?.stats?.loyalty?.errors || 0}`);
            
            console.log('\nPromotions:');
            console.log(`  - Created: ${result.loyalty?.stats?.promotions?.created || 0}`);
            console.log(`  - Updated: ${result.loyalty?.stats?.promotions?.updated || 0}`);
            console.log(`  - Errors: ${result.loyalty?.stats?.promotions?.errors || 0}`);
            
            console.log(`\nDuration: ${result.duration}ms`);
        } else {
            console.log('\n❌ Sync failed!');
            console.log(`Error: ${result.error}`);
        }
        
        console.log('\n========================================\n');

    } catch (error) {
        console.error('\n❌ Fatal error during sync:', error.message);
        logger.error('Manual sync failed:', error);
    } finally {
        await db.closePool();
        process.exit(0);
    }
}

runSync();
