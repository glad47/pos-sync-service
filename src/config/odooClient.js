/**
 * Odoo API Client Configuration - SIMPLIFIED
 * Handles all communication with Odoo backend using simple token-based auth
 */

const axios = require('axios');
const logger = require('../utils/logger');

// Store token in memory
let authToken = null;

/**
 * Get authentication token from Odoo
 */
async function getAuthToken() {
    try {
        logger.info('Getting auth token from Odoo...');
        
        const response = await axios.post(
            `${process.env.ODOO_BASE_URL}/api/auth/token`,
            {
                username: process.env.ODOO_USERNAME,
                password: process.env.ODOO_PASSWORD
            },
            {
                headers: { 'Content-Type': 'application/json' },
                timeout: 30000
            }
        );

        console.log("herhe check the token :)")
        console.log(response.data)

        // Extract token from response
        authToken = response.data.result?.token;
        
        if (!authToken) {
            throw new Error('No token in response');
        }

        logger.info('✓ Auth token obtained successfully');
        return authToken;
        
    } catch (error) {
        logger.error('✗ Failed to get auth token:', error.message);
        throw error;
    }
}

/**
 * Make authenticated request to Odoo
 * @param {string} endpoint - API endpoint (e.g., '/api/products/all')
 * @param {string} method - HTTP method (GET, POST, etc.)
 * @param {Object} data - Request body data
 */
async function odooRequest(endpoint, method = 'GET', data = null) {
    try {
        // Get token if we don't have one
        if (!authToken) {
            await getAuthToken();
        }

        const config = {
            method: method,
            url: `${process.env.ODOO_BASE_URL}${endpoint}`,
            headers: {
                'Authorization': authToken,
                'Content-Type': 'application/json'
            },
            timeout: 60000, // Increase to 60 seconds
            maxContentLength: 50 * 1024 * 1024, // Allow up to 50MB
            maxBodyLength: 50 * 1024 * 1024
        };

        if (data && method !== 'GET') {
            config.data = data;
        }

        logger.debug(`Odoo API Request: ${method} ${endpoint}`);
        const response = await axios(config);
        logger.debug(`Odoo API Response: ${response.status} ${endpoint}`);
        
        return response.data;

    } catch (error) {
        // If unauthorized, try to refresh token and retry once
        if (error.response?.status === 401) {
            logger.warn('Token expired, refreshing and retrying...');
            authToken = null;
            await getAuthToken();
            
            // Retry request with new token
            const config = {
                method: method,
                url: `${process.env.ODOO_BASE_URL}${endpoint}`,
                headers: {
                    'Authorization': authToken,
                    'Content-Type': 'application/json'
                },
                timeout: 30000
            };
            
            if (data && method !== 'GET') {
                config.data = data;
            }
            
            const response = await axios(config);
            return response.data;
        }
        
        // Log error details
        if (error.response) {
            logger.error('Odoo API Error Response:', {
                status: error.response.status,
                data: error.response.data,
                endpoint: endpoint
            });
        } else if (error.request) {
            logger.error('Odoo API No Response:', {
                endpoint: endpoint,
                message: error.message
            });
        } else {
            logger.error('Odoo API Error:', error.message);
        }
        
        throw error;
    }
}

/**
 * Odoo API Methods - Simplified
 */
const odooApi = {
    /**
     * Manually refresh authentication token
     */
    async refreshToken() {
        authToken = null;
        return await getAuthToken();
    },

    /**
     * Get all products from Odoo
     */
    
    async  getAllProducts() {
        const allProducts = [];
        let offset = 0;
        const limit = 1000;
        let hasMore = true;

        while (hasMore) {
            try {
                const response = await odooRequest(
                    `/api/products/all?limit=${limit}&offset=${offset}`,
                    'GET'
                );

                if (response.status === 'success') {
                    allProducts.push(...response.data);
                    hasMore = response.has_more;
                    offset += limit;
                    
                    logger.info(`Fetched ${allProducts.length}/${response.total} products`);
                } else {
                    throw new Error('API returned error status');
                }
            } catch (error) {
                logger.error(`Failed to fetch products at offset ${offset}:`, error.message);
                throw error;
            }
        }

        return allProducts;
    },
   

    /**
     * Get products sync data (incremental)
     */
    async getProductsSync() {
        try {
            const data = await odooRequest('/api/sync/product', 'GET');
            console.log("here &&&&&&&&&&&&&&&&&&&&&&&&&&&&&&&&&&&&")
            console.log(data)
            return data.data || data;
        } catch (error) {
            logger.error('Failed to fetch products sync:', error.message);
            throw error;
        }
    },

    /**
     * Get product prices
     */
    async getProductPrices() {
        try {
            const data = await odooRequest('/api/products/prices', 'GET');
            return data.data || data;
        } catch (error) {
            logger.error('Failed to fetch product prices:', error.message);
            throw error;
        }
    },

    /**
     * Get all loyalty programs
     */
    async getAllLoyaltyPrograms() {
        try {
            const data = await odooRequest('/api/loyalty/all', 'GET');
            return data;
        } catch (error) {
            logger.error('Failed to fetch loyalty programs:', error.message);
            throw error;
        }
    },

    /**
     * Get loyalty programs sync data (incremental)
     */
    async getLoyaltySync() {
        try {
            const data = await odooRequest('/api/loyalty/all', 'GET');
            return data;
        } catch (error) {
            logger.error('Failed to fetch loyalty sync:', error.message);
            throw error;
        }
    },

    /**
     * Get loyalty program by ID
     * @param {number} programId 
     */
    async getLoyaltyProgramById(programId) {
        try {
            const data = await odooRequest(`/api/loyalty/programs/${programId}`, 'GET');
            return data.data || data;
        } catch (error) {
            logger.error(`Failed to fetch loyalty program ${programId}:`, error.message);
            throw error;
        }
    },

    /**
     * Get all promotions
     */
    async getAllPromotions() {
        try {
            const data = await odooRequest('/api/promotions/all', 'GET');
            return data.data || data;
        } catch (error) {
            logger.error('Failed to fetch all promotions:', error.message);
            throw error;
        }
    },

    /**
     * Get all data (products, loyalty, promotions) in one call
     */
    async getAllData() {
        try {
            logger.info('Fetching all data from Odoo in parallel...');
            
            // Fetch all in parallel for better performance
            const [products, loyalty, promotions] = await Promise.all([
                odooRequest('/api/products/all', 'GET'),
                odooRequest('/api/loyalty/programs', 'GET'),
                odooRequest('/api/promotions/all', 'GET')
            ]);
            
            return {
                products: products.data || products,
                loyalty: loyalty.data || loyalty,
                promotions: promotions.data || promotions
            };
        } catch (error) {
            logger.error('Failed to fetch all data:', error.message);
            throw error;
        }
    },

    /**
     * Test Odoo connection
     */
    async testConnection() {
        try {
            // Try to get products to test connection
            await this.getAllProducts();
            logger.info('✓ Odoo API connection successful');
            return true;
        } catch (error) {
            logger.error('✗ Odoo API connection failed:', error.message);
            return false;
        }
    },

    /**
     * Get current auth status
     */
    getAuthStatus() {
        return {
            hasToken: !!authToken,
            baseUrl: process.env.ODOO_BASE_URL
        };
    }
};

/**
 * Initialize token on module load
 */
async function initialize() {
    if (process.env.ODOO_USERNAME && process.env.ODOO_PASSWORD) {
        try {
            await getAuthToken();
            logger.info('✓ Odoo client initialized with auth token');
        } catch (error) {
            logger.warn('⚠ Failed to get initial token, will retry on first request');
        }
    } else {
        logger.warn('⚠ ODOO_USERNAME or ODOO_PASSWORD not set, authentication will fail');
    }
}

// Initialize on module load (non-blocking)
initialize().catch(err => {
    logger.error('Odoo client initialization error:', err.message);
});

module.exports = {
    odooApi,
    odooRequest,
    getAuthToken
};
