/**
 * MySQL Database Configuration
 * Handles connection pooling and queries
 */

const mysql = require('mysql2/promise');
const logger = require('../utils/logger');

let pool = null;

/**
 * Initialize MySQL connection pool
 */
const initializePool = () => {
    if (pool) return pool;

    pool = mysql.createPool({
        host: process.env.MYSQL_HOST || 'localhost',
        port: parseInt(process.env.MYSQL_PORT) || 3306,
        database: process.env.MYSQL_DATABASE || 'pos_db',
        user: process.env.MYSQL_USER || 'root',
        password: process.env.MYSQL_PASSWORD || 'password',
        waitForConnections: true,
        connectionLimit: 10,
        maxIdle: 10,
        idleTimeout: 60000,
        queueLimit: 0,
        enableKeepAlive: true,
        keepAliveInitialDelay: 0
    });

    logger.info('MySQL connection pool initialized');
    return pool;
};

/**
 * Get database connection from pool
 */
const getConnection = async () => {
    if (!pool) initializePool();
    return await pool.getConnection();
};

/**
 * Execute a query
 * @param {string} sql - SQL query
 * @param {Array} params - Query parameters
 */
const query = async (sql, params = []) => {
    if (!pool) initializePool();
    try {
        const [results] = await pool.execute(sql, params);
        return results;
    } catch (error) {
        logger.error('Database query error:', { sql, error: error.message });
        throw error;
    }
};

/**
 * Execute multiple queries in a transaction
 * @param {Function} callback - Function that receives connection and executes queries
 */
const transaction = async (callback) => {
    const connection = await getConnection();
    try {
        await connection.beginTransaction();
        const result = await callback(connection);
        await connection.commit();
        return result;
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
};

/**
 * Test database connection
 */
const testConnection = async () => {
    try {
        if (!pool) initializePool();
        const connection = await pool.getConnection();
        await connection.ping();
        connection.release();
        logger.info('Database connection successful');
        return true;
    } catch (error) {
        logger.error('Database connection failed:', error.message);
        return false;
    }
};

/**
 * Close all connections
 */
const closePool = async () => {
    if (pool) {
        await pool.end();
        pool = null;
        logger.info('Database pool closed');
    }
};

module.exports = {
    initializePool,
    getConnection,
    query,
    transaction,
    testConnection,
    closePool
};
