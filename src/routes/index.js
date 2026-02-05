/**
 * Routes Index
 * Export all route modules
 */

const syncRoutes = require('./syncRoutes');
const dataRoutes = require('./dataRoutes');
const odooRoutes = require('./odooRoutes');

module.exports = {
    syncRoutes,
    dataRoutes,
    odooRoutes
};
