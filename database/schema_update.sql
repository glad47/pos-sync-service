-- =============================================================================
-- POS SYNC SERVICE - DATABASE SCHEMA UPDATE
-- =============================================================================
-- Run these ALTER statements on your existing pos_db to add Odoo ID tracking
-- This enables better sync tracking and avoids duplicates
-- =============================================================================

USE pos_db;

-- =============================================================================
-- Add Odoo tracking columns to products table
-- =============================================================================
ALTER TABLE products 
ADD COLUMN IF NOT EXISTS odoo_product_id BIGINT DEFAULT NULL,
ADD COLUMN IF NOT EXISTS odoo_template_id BIGINT DEFAULT NULL,
ADD COLUMN IF NOT EXISTS last_sync_at TIMESTAMP DEFAULT NULL;

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_odoo_product_id ON products(odoo_product_id);
CREATE INDEX IF NOT EXISTS idx_odoo_template_id ON products(odoo_template_id);

-- =============================================================================
-- Add Odoo tracking columns to loyalty_programs table
-- =============================================================================
ALTER TABLE loyalty_programs 
ADD COLUMN IF NOT EXISTS odoo_program_id BIGINT DEFAULT NULL,
ADD COLUMN IF NOT EXISTS odoo_rule_id BIGINT DEFAULT NULL,
ADD COLUMN IF NOT EXISTS last_sync_at TIMESTAMP DEFAULT NULL;

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_odoo_program_id ON loyalty_programs(odoo_program_id);
CREATE INDEX IF NOT EXISTS idx_odoo_rule_id ON loyalty_programs(odoo_rule_id);

-- =============================================================================
-- Add Odoo tracking columns to promotions table
-- =============================================================================
ALTER TABLE promotions 
ADD COLUMN IF NOT EXISTS odoo_promotion_id BIGINT DEFAULT NULL,
ADD COLUMN IF NOT EXISTS last_sync_at TIMESTAMP DEFAULT NULL;

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_odoo_promotion_id ON promotions(odoo_promotion_id);

-- =============================================================================
-- Create sync_log table to track sync history
-- =============================================================================
CREATE TABLE IF NOT EXISTS sync_log (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    sync_type ENUM('FULL', 'PRODUCTS', 'LOYALTY', 'PROMOTIONS') NOT NULL,
    status ENUM('STARTED', 'SUCCESS', 'FAILED', 'PARTIAL') NOT NULL,
    started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP NULL,
    products_created INT DEFAULT 0,
    products_updated INT DEFAULT 0,
    products_errors INT DEFAULT 0,
    loyalty_created INT DEFAULT 0,
    loyalty_updated INT DEFAULT 0,
    loyalty_errors INT DEFAULT 0,
    promotions_created INT DEFAULT 0,
    promotions_updated INT DEFAULT 0,
    promotions_errors INT DEFAULT 0,
    error_message TEXT,
    duration_ms INT DEFAULT NULL,
    
    INDEX idx_sync_type (sync_type),
    INDEX idx_status (status),
    INDEX idx_started_at (started_at)
) ENGINE=InnoDB;

-- =============================================================================
-- Create sync_config table for storing sync settings
-- =============================================================================
CREATE TABLE IF NOT EXISTS sync_config (
    id INT AUTO_INCREMENT PRIMARY KEY,
    config_key VARCHAR(100) NOT NULL UNIQUE,
    config_value TEXT,
    description VARCHAR(255),
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- Insert default config values
INSERT INTO sync_config (config_key, config_value, description) VALUES
('last_product_sync', NULL, 'Timestamp of last successful product sync'),
('last_loyalty_sync', NULL, 'Timestamp of last successful loyalty sync'),
('last_promotion_sync', NULL, 'Timestamp of last successful promotion sync'),
('sync_enabled', 'true', 'Enable/disable automatic sync'),
('sync_interval_minutes', '5', 'Sync interval in minutes')
ON DUPLICATE KEY UPDATE config_key = config_key;

-- =============================================================================
-- Views for easier querying
-- =============================================================================

-- View: Products needing sync (modified since last sync)
CREATE OR REPLACE VIEW v_products_need_sync AS
SELECT 
    p.*,
    COALESCE(
        (SELECT config_value FROM sync_config WHERE config_key = 'last_product_sync'),
        '2000-01-01'
    ) AS last_sync
FROM products p
WHERE p.updated_at > COALESCE(
    (SELECT STR_TO_DATE(config_value, '%Y-%m-%dT%H:%i:%s') 
     FROM sync_config 
     WHERE config_key = 'last_product_sync'),
    '2000-01-01'
);

-- View: Sync statistics summary
CREATE OR REPLACE VIEW v_sync_summary AS
SELECT 
    sync_type,
    COUNT(*) AS total_syncs,
    SUM(CASE WHEN status = 'SUCCESS' THEN 1 ELSE 0 END) AS successful_syncs,
    SUM(CASE WHEN status = 'FAILED' THEN 1 ELSE 0 END) AS failed_syncs,
    SUM(products_created) AS total_products_created,
    SUM(products_updated) AS total_products_updated,
    SUM(loyalty_created) AS total_loyalty_created,
    SUM(loyalty_updated) AS total_loyalty_updated,
    AVG(duration_ms) AS avg_duration_ms,
    MAX(started_at) AS last_sync_time
FROM sync_log
GROUP BY sync_type;

-- =============================================================================
-- Stored Procedures for sync operations
-- =============================================================================

DELIMITER //

-- Procedure: Record sync start
CREATE PROCEDURE IF NOT EXISTS sp_sync_start(
    IN p_sync_type VARCHAR(20)
)
BEGIN
    INSERT INTO sync_log (sync_type, status, started_at)
    VALUES (p_sync_type, 'STARTED', NOW());
    
    SELECT LAST_INSERT_ID() AS sync_id;
END //

-- Procedure: Record sync completion
CREATE PROCEDURE IF NOT EXISTS sp_sync_complete(
    IN p_sync_id BIGINT,
    IN p_status VARCHAR(20),
    IN p_products_created INT,
    IN p_products_updated INT,
    IN p_products_errors INT,
    IN p_loyalty_created INT,
    IN p_loyalty_updated INT,
    IN p_loyalty_errors INT,
    IN p_promotions_created INT,
    IN p_promotions_updated INT,
    IN p_promotions_errors INT,
    IN p_error_message TEXT
)
BEGIN
    DECLARE v_started_at TIMESTAMP;
    DECLARE v_duration_ms INT;
    
    -- Get start time
    SELECT started_at INTO v_started_at FROM sync_log WHERE id = p_sync_id;
    
    -- Calculate duration
    SET v_duration_ms = TIMESTAMPDIFF(MICROSECOND, v_started_at, NOW()) / 1000;
    
    -- Update sync log
    UPDATE sync_log SET
        status = p_status,
        completed_at = NOW(),
        products_created = p_products_created,
        products_updated = p_products_updated,
        products_errors = p_products_errors,
        loyalty_created = p_loyalty_created,
        loyalty_updated = p_loyalty_updated,
        loyalty_errors = p_loyalty_errors,
        promotions_created = p_promotions_created,
        promotions_updated = p_promotions_updated,
        promotions_errors = p_promotions_errors,
        error_message = p_error_message,
        duration_ms = v_duration_ms
    WHERE id = p_sync_id;
    
    -- Update last sync timestamp in config
    IF p_status = 'SUCCESS' THEN
        UPDATE sync_config 
        SET config_value = DATE_FORMAT(NOW(), '%Y-%m-%dT%H:%i:%s')
        WHERE config_key = CONCAT('last_', LOWER((SELECT sync_type FROM sync_log WHERE id = p_sync_id)), '_sync');
    END IF;
END //

-- Procedure: Get sync config value
CREATE PROCEDURE IF NOT EXISTS sp_get_sync_config(
    IN p_config_key VARCHAR(100)
)
BEGIN
    SELECT config_value FROM sync_config WHERE config_key = p_config_key;
END //

-- Procedure: Set sync config value
CREATE PROCEDURE IF NOT EXISTS sp_set_sync_config(
    IN p_config_key VARCHAR(100),
    IN p_config_value TEXT
)
BEGIN
    INSERT INTO sync_config (config_key, config_value)
    VALUES (p_config_key, p_config_value)
    ON DUPLICATE KEY UPDATE config_value = p_config_value;
END //

DELIMITER ;

-- =============================================================================
-- Sample data for testing (optional)
-- =============================================================================

-- Insert sample products if table is empty
INSERT INTO products (barcode, name, description, price, stock, category, tax_rate, odoo_product_id)
SELECT '1001', 'Espresso', 'Single shot espresso', 2.50, 100, 'Beverages', 0.1500, 1
WHERE NOT EXISTS (SELECT 1 FROM products WHERE barcode = '1001');

INSERT INTO products (barcode, name, description, price, stock, category, tax_rate, odoo_product_id)
SELECT '1002', 'Americano', 'Espresso with hot water', 3.00, 100, 'Beverages', 0.1500, 2
WHERE NOT EXISTS (SELECT 1 FROM products WHERE barcode = '1002');

-- Insert sample loyalty program if table is empty
INSERT INTO loyalty_programs (name, type, buy_quantity, free_quantity, category, start_date, end_date, odoo_program_id)
SELECT 'Buy 2 Get 1 Free Coffee', 'BOGO', 2, 1, 'Beverages', NOW(), DATE_ADD(NOW(), INTERVAL 1 YEAR), 1
WHERE NOT EXISTS (SELECT 1 FROM loyalty_programs WHERE name = 'Buy 2 Get 1 Free Coffee');

-- Insert sample promotion if table is empty
INSERT INTO promotions (name, description, discount_type, discount_value, category, start_date, end_date, odoo_promotion_id)
SELECT '10% Off Beverages', '10% discount on all beverages', 'PERCENTAGE', 10.00, 'Beverages', NOW(), DATE_ADD(NOW(), INTERVAL 1 YEAR), 1
WHERE NOT EXISTS (SELECT 1 FROM promotions WHERE name = '10% Off Beverages');

-- =============================================================================
-- DONE - Schema update completed
-- =============================================================================
SELECT 'Schema update completed successfully!' AS status;
