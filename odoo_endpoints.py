"""
=============================================================================
ODOO API ENDPOINTS FOR POS SYNC
=============================================================================

Add these endpoints to your existing Odoo module (pos_sync or sync_app)
to support the Express.js sync service.

These endpoints provide:
1. Full product listing with all necessary fields
2. Loyalty program listing with complete details
3. Incremental sync support via timestamp tracking

Add this code to your existing controller file (e.g., controller.py)
=============================================================================
"""

from odoo import http, fields
from odoo.http import request
import json
import logging
from datetime import datetime, date

_logger = logging.getLogger(__name__)


class PosSyncApiController(http.Controller):
    """
    Extended API Controller for POS Sync Service
    Add these methods to your existing controller
    """

    # =========================================================================
    # PRODUCTS API - Full listing with sync support
    # =========================================================================

    @http.route('/api/products/all', type='json', auth='public', methods=['POST', 'GET'])
    def get_all_products(self, **kwargs):
        """
        Get all products available for POS
        
        Request:
        POST/GET /api/products/all
        Headers: Authorization: your-token
        
        Response:
        {
            "status": "success",
            "data": [...],
            "count": 100
        }
        """
        # Verify token
        token = request.httprequest.headers.get('Authorization')
        user = request.env['auth.user.token'].sudo().search([('token', '=', token)], limit=1)

        if not user or not user.token_expiration or user.token_expiration < datetime.utcnow():
            return {'error': 'Unauthorized or token expired', 'status': 401}

        try:
            # Query all POS products with barcodes
            query = """
                SELECT 
                    pt.id,
                    pt.name,
                    pt.list_price,
                    pt.volume,
                    pt.weight,
                    pt.active,
                    pt.description_sale as description,
                    pp.barcode,
                    pp.id AS product_id,
                    pp.default_code as sku,
                    uom.id AS uom_id,
                    uom.name AS uom_name,
                    uom.uom_type,
                    uom.rounding AS uom_rounding,
                    uom.factor AS uom_factor,
                    pc.id AS category_id,
                    pc.name AS category_name,
                    pt.write_date as last_updated
                FROM product_template pt
                LEFT JOIN product_product pp ON pp.product_tmpl_id = pt.id
                LEFT JOIN uom_uom uom ON uom.id = pt.uom_id
                LEFT JOIN product_category pc ON pc.id = pt.categ_id
                WHERE pt.available_in_pos = TRUE 
                AND pp.barcode IS NOT NULL
                AND pp.barcode != ''
                AND pt.active = TRUE
                ORDER BY pt.name
            """
            
            request.env.cr.execute(query)
            raw_results = request.env.cr.dictfetchall()
            
            # Format results
            products = []
            for row in raw_results:
                # Build uom_id data
                uom_data = None
                if row.get('uom_id'):
                    uom_data = {
                        'id': row['uom_id'],
                        'name': row['uom_name'],
                        'uom_type': row['uom_type'],
                        'rounding': float(row['uom_rounding']) if row['uom_rounding'] else None,
                        'factor': float(row['uom_factor']) if row['uom_factor'] else None,
                    }
                
                # Extract name from JSON if needed
                name = row['name']
                if isinstance(name, dict):
                    name = name.get('ar_001') or name.get('en_US') or str(name)
                
                # Build product data
                product = {
                    'id': row['id'],
                    'product_id': row['product_id'],
                    'name': name,
                    'barcode': row['barcode'],
                    'sku': row['sku'],
                    'list_price': float(row['list_price']) if row['list_price'] else 0.0,
                    'description': row['description'],
                    'volume': float(row['volume']) if row['volume'] else 0.0,
                    'weight': float(row['weight']) if row['weight'] else 0.0,
                    'active': row['active'],
                    'uom_id': uom_data,
                    'category': row['category_name'] if isinstance(row['category_name'], str) else 
                               (row['category_name'].get('en_US') if isinstance(row['category_name'], dict) else None),
                    'category_id': row['category_id'],
                    'last_updated': row['last_updated'].isoformat() if row['last_updated'] else None,
                    'tax_rate': 0.15  # Default VAT rate for Saudi Arabia
                }
                
                products.append(product)
            
            return {
                'status': 'success',
                'data': products,
                'count': len(products)
            }

        except Exception as e:
            _logger.exception("Failed to fetch all products")
            return {
                'status': 'error',
                'message': str(e)
            }

    @http.route('/api/products/changed', type='json', auth='public', methods=['POST'])
    def get_changed_products(self, **kwargs):
        """
        Get products changed since a specific datetime
        
        Request:
        POST /api/products/changed
        Body: { "since": "2024-01-01T00:00:00" }
        Headers: Authorization: your-token
        
        Response:
        {
            "status": "success",
            "data": {
                "created": [...],
                "updated": [...],
                "deleted": []
            },
            "count": 10
        }
        """
        token = request.httprequest.headers.get('Authorization')
        user = request.env['auth.user.token'].sudo().search([('token', '=', token)], limit=1)

        if not user or not user.token_expiration or user.token_expiration < datetime.utcnow():
            return {'error': 'Unauthorized or token expired', 'status': 401}

        try:
            data = json.loads(request.httprequest.data)
            since_str = data.get('since')
            
            if since_str:
                since = datetime.fromisoformat(since_str.replace('Z', '+00:00'))
            else:
                since = datetime(2000, 1, 1)  # Get all if no date provided

            query = """
                SELECT 
                    pt.id,
                    pt.name,
                    pt.list_price,
                    pt.volume,
                    pt.weight,
                    pt.active,
                    pt.description_sale as description,
                    pp.barcode,
                    pp.id AS product_id,
                    uom.id AS uom_id,
                    uom.name AS uom_name,
                    pc.name AS category_name,
                    pt.create_date,
                    pt.write_date,
                    CASE 
                        WHEN pt.create_date > %s THEN 'created'
                        WHEN pt.write_date > %s AND pt.create_date <= %s THEN 'updated'
                    END AS change_type
                FROM product_template pt
                LEFT JOIN product_product pp ON pp.product_tmpl_id = pt.id
                LEFT JOIN uom_uom uom ON uom.id = pt.uom_id
                LEFT JOIN product_category pc ON pc.id = pt.categ_id
                WHERE pt.available_in_pos = TRUE 
                AND pp.barcode IS NOT NULL
                AND pp.barcode != ''
                AND (pt.create_date > %s OR pt.write_date > %s)
                ORDER BY pt.id
            """
            
            request.env.cr.execute(query, (since, since, since, since, since))
            raw_results = request.env.cr.dictfetchall()
            
            created = []
            updated = []
            
            for row in raw_results:
                name = row['name']
                if isinstance(name, dict):
                    name = name.get('ar_001') or name.get('en_US') or str(name)
                
                product = {
                    'id': row['id'],
                    'product_id': row['product_id'],
                    'name': name,
                    'barcode': row['barcode'],
                    'list_price': float(row['list_price']) if row['list_price'] else 0.0,
                    'description': row['description'],
                    'active': row['active'],
                    'category': row['category_name'] if isinstance(row['category_name'], str) else None,
                    'tax_rate': 0.15
                }
                
                if row['change_type'] == 'created':
                    created.append(product)
                else:
                    updated.append(product)
            
            return {
                'status': 'success',
                'data': {
                    'created': created,
                    'updated': updated,
                    'deleted': []
                },
                'count': len(created) + len(updated),
                'since': since_str,
                'current_time': datetime.utcnow().isoformat()
            }

        except Exception as e:
            _logger.exception("Failed to fetch changed products")
            return {
                'status': 'error',
                'message': str(e)
            }

    # =========================================================================
    # LOYALTY PROGRAMS API - Full listing with all details
    # =========================================================================

    @http.route('/api/loyalty/all', type='json', auth='public', methods=['POST', 'GET'])
    def get_all_loyalty_programs(self, **kwargs):
        """
        Get all active loyalty programs with complete details
        
        This includes:
        - BOGO (Buy One Get One) programs
        - Discount programs
        - Promotion programs
        
        Request:
        POST/GET /api/loyalty/all
        Headers: Authorization: your-token
        
        Response:
        {
            "status": "success",
            "data": [...],
            "count": 10
        }
        """
        token = request.httprequest.headers.get('Authorization')
        user = request.env['auth.user.token'].sudo().search([('token', '=', token)], limit=1)

        if not user or not user.token_expiration or user.token_expiration < datetime.utcnow():
            return {'error': 'Unauthorized or token expired', 'status': 401}

        try:
            # Query all loyalty programs with complete details
            query = """
                SELECT
                    lp.id AS program_id,
                    COALESCE(lp.name->>'ar_001', lp.name->>'en_US', '') AS program_name,
                    lp.active AS program_active,
                    lp.create_date AS program_create_date,
                    lp.write_date AS program_write_date,
                    
                    -- Rule details
                    lr.id AS rule_id,
                    lr.mode AS rule_mode,
                    lr.active AS rule_active,
                    lr.code AS discount_code,
                    lr.minimum_qty AS rule_min_qty,
                    lr.minimum_amount AS rule_min_amount,
                    lr.total_price AS rule_total_price,
                    lr.after_dis AS rule_after_discount,
                    lr.discount AS rule_discount,
                    
                    -- Main/Trigger Product
                    COALESCE(pp_main.id, pp_eligible.id, 0) AS main_product_id,
                    COALESCE(
                        pt_main.name->>'ar_001', pt_main.name->>'en_US',
                        pt_eligible.name->>'ar_001', pt_eligible.name->>'en_US',
                        'Unknown'
                    ) AS main_product_name,
                    COALESCE(pp_main.barcode, pp_eligible.barcode) AS main_product_barcode,
                    COALESCE(pt_main.list_price, pt_eligible.list_price, 0) AS main_product_price,
                    
                    -- Eligible Product
                    pp_eligible.id AS eligible_product_id,
                    COALESCE(pt_eligible.name->>'ar_001', pt_eligible.name->>'en_US', '') AS eligible_product_name,
                    pp_eligible.barcode AS eligible_product_barcode,
                    pt_eligible.list_price AS eligible_product_price,
                    
                    -- Reward Product
                    pp_reward.id AS reward_product_id,
                    COALESCE(pt_reward.name->>'ar_001', pt_reward.name->>'en_US', '') AS reward_product_name,
                    pp_reward.barcode AS reward_product_barcode,
                    pt_reward.list_price AS reward_product_price,
                    
                    -- Reward details
                    lrw.id AS reward_id,
                    lrw.discount AS reward_discount,
                    lrw.discount_mode AS reward_discount_mode,
                    lrw.required_points AS reward_required_points

                FROM loyalty_program lp
                LEFT JOIN loyalty_rule lr ON lr.program_id = lp.id
                
                -- Main product
                LEFT JOIN product_product pp_main ON pp_main.id = lp.product_id
                LEFT JOIN product_template pt_main ON pt_main.id = pp_main.product_tmpl_id
                
                -- Eligible products
                LEFT JOIN loyalty_rule_product_product_rel lrp ON lrp.loyalty_rule_id = lr.id
                LEFT JOIN product_product pp_eligible ON pp_eligible.id = lrp.product_product_id
                LEFT JOIN product_template pt_eligible ON pt_eligible.id = pp_eligible.product_tmpl_id
                
                -- Reward
                LEFT JOIN loyalty_reward lrw ON lrw.program_id = lp.id
                LEFT JOIN product_product pp_reward ON pp_reward.id = lrw.reward_product_id
                LEFT JOIN product_template pt_reward ON pt_reward.id = pp_reward.product_tmpl_id
                
                WHERE lp.active = TRUE
                ORDER BY lp.id, lr.id, pp_eligible.id
            """
            
            request.env.cr.execute(query)
            raw_results = request.env.cr.dictfetchall()
            
            # Process and structure results
            programs_map = {}
            
            for row in raw_results:
                program_id = row['program_id']
                
                if program_id not in programs_map:
                    # Determine program type
                    program_type = 'BOGO'  # Default
                    buy_quantity = int(row['rule_min_qty'] or 1)
                    free_quantity = 1
                    discount_percent = 0
                    
                    if row['rule_discount'] and float(row['rule_discount']) > 0:
                        program_type = 'DISCOUNT'
                        discount_percent = float(row['rule_discount'])
                    elif row['reward_product_id']:
                        program_type = 'BOGO'
                    
                    programs_map[program_id] = {
                        'program_id': program_id,
                        'name': row['program_name'],
                        'type': program_type,
                        'active': row['program_active'] and row['rule_active'],
                        'buy_quantity': buy_quantity,
                        'free_quantity': free_quantity,
                        'discount_percent': discount_percent,
                        'discount_code': row['discount_code'],
                        'min_quantity': float(row['rule_min_qty'] or 0),
                        'min_amount': float(row['rule_min_amount'] or 0),
                        'main_product': {
                            'id': row['main_product_id'],
                            'name': row['main_product_name'],
                            'barcode': row['main_product_barcode'],
                            'price': float(row['main_product_price'] or 0)
                        } if row['main_product_id'] else None,
                        'eligible_products': [],
                        'reward_product': {
                            'id': row['reward_product_id'],
                            'name': row['reward_product_name'],
                            'barcode': row['reward_product_barcode'],
                            'price': float(row['reward_product_price'] or 0)
                        } if row['reward_product_id'] else None,
                        'last_updated': row['program_write_date'].isoformat() if row['program_write_date'] else None
                    }
                
                # Add eligible product if exists and not already added
                if row['eligible_product_id']:
                    eligible = {
                        'id': row['eligible_product_id'],
                        'name': row['eligible_product_name'],
                        'barcode': row['eligible_product_barcode'],
                        'price': float(row['eligible_product_price'] or 0)
                    }
                    
                    # Check if already in list
                    existing_ids = [p['id'] for p in programs_map[program_id]['eligible_products']]
                    if eligible['id'] not in existing_ids:
                        programs_map[program_id]['eligible_products'].append(eligible)
            
            programs = list(programs_map.values())
            
            return {
                'status': 'success',
                'data': programs,
                'count': len(programs)
            }

        except Exception as e:
            _logger.exception("Failed to fetch all loyalty programs")
            return {
                'status': 'error',
                'message': str(e)
            }

    @http.route('/api/loyalty/changed', type='json', auth='public', methods=['POST'])
    def get_changed_loyalty_programs(self, **kwargs):
        """
        Get loyalty programs changed since a specific datetime
        
        Request:
        POST /api/loyalty/changed
        Body: { "since": "2024-01-01T00:00:00" }
        Headers: Authorization: your-token
        """
        token = request.httprequest.headers.get('Authorization')
        user = request.env['auth.user.token'].sudo().search([('token', '=', token)], limit=1)

        if not user or not user.token_expiration or user.token_expiration < datetime.utcnow():
            return {'error': 'Unauthorized or token expired', 'status': 401}

        try:
            data = json.loads(request.httprequest.data)
            since_str = data.get('since')
            
            if since_str:
                since = datetime.fromisoformat(since_str.replace('Z', '+00:00'))
            else:
                since = datetime(2000, 1, 1)

            # Similar query to get_all_loyalty_programs but filtered by date
            query = """
                SELECT
                    lp.id AS program_id,
                    COALESCE(lp.name->>'ar_001', lp.name->>'en_US', '') AS program_name,
                    lp.active AS program_active,
                    lp.create_date AS program_create_date,
                    lp.write_date AS program_write_date,
                    lr.id AS rule_id,
                    lr.mode AS rule_mode,
                    lr.active AS rule_active,
                    lr.code AS discount_code,
                    lr.minimum_qty AS rule_min_qty,
                    lr.minimum_amount AS rule_min_amount,
                    lr.discount AS rule_discount,
                    
                    COALESCE(pp_main.id, pp_eligible.id, 0) AS main_product_id,
                    COALESCE(pp_main.barcode, pp_eligible.barcode) AS main_product_barcode,
                    
                    pp_eligible.id AS eligible_product_id,
                    pp_eligible.barcode AS eligible_product_barcode,
                    
                    pp_reward.id AS reward_product_id,
                    pp_reward.barcode AS reward_product_barcode,
                    
                    CASE 
                        WHEN lp.create_date > %s THEN 'created'
                        WHEN lp.write_date > %s AND lp.create_date <= %s THEN 'updated'
                    END AS change_type

                FROM loyalty_program lp
                LEFT JOIN loyalty_rule lr ON lr.program_id = lp.id
                LEFT JOIN product_product pp_main ON pp_main.id = lp.product_id
                LEFT JOIN loyalty_rule_product_product_rel lrp ON lrp.loyalty_rule_id = lr.id
                LEFT JOIN product_product pp_eligible ON pp_eligible.id = lrp.product_product_id
                LEFT JOIN loyalty_reward lrw ON lrw.program_id = lp.id
                LEFT JOIN product_product pp_reward ON pp_reward.id = lrw.reward_product_id
                
                WHERE lp.active = TRUE
                AND (lp.create_date > %s OR lp.write_date > %s)
                ORDER BY lp.id
            """
            
            request.env.cr.execute(query, (since, since, since, since, since))
            raw_results = request.env.cr.dictfetchall()
            
            created = []
            updated = []
            seen_programs = set()
            
            for row in raw_results:
                if row['program_id'] in seen_programs:
                    continue
                seen_programs.add(row['program_id'])
                
                program = {
                    'program_id': row['program_id'],
                    'name': row['program_name'],
                    'active': row['program_active'] and row['rule_active'],
                    'discount_code': row['discount_code'],
                    'min_quantity': float(row['rule_min_qty'] or 0),
                    'min_amount': float(row['rule_min_amount'] or 0),
                    'discount_percent': float(row['rule_discount'] or 0),
                    'main_product_barcode': row['main_product_barcode'],
                    'eligible_product_barcode': row['eligible_product_barcode'],
                    'reward_product_barcode': row['reward_product_barcode'],
                }
                
                if row['change_type'] == 'created':
                    created.append(program)
                else:
                    updated.append(program)
            
            return {
                'status': 'success',
                'data': {
                    'created': created,
                    'updated': updated,
                    'deleted': []
                },
                'count': len(created) + len(updated),
                'since': since_str,
                'current_time': datetime.utcnow().isoformat()
            }

        except Exception as e:
            _logger.exception("Failed to fetch changed loyalty programs")
            return {
                'status': 'error',
                'message': str(e)
            }

    # =========================================================================
    # PROMOTIONS API
    # =========================================================================

    @http.route('/api/promotions/all', type='json', auth='public', methods=['POST', 'GET'])
    def get_all_promotions(self, **kwargs):
        """
        Get all active promotions (discount-based loyalty programs)
        
        This specifically filters for discount-type programs that can be
        used as promotions in the POS system.
        """
        token = request.httprequest.headers.get('Authorization')
        user = request.env['auth.user.token'].sudo().search([('token', '=', token)], limit=1)

        if not user or not user.token_expiration or user.token_expiration < datetime.utcnow():
            return {'error': 'Unauthorized or token expired', 'status': 401}

        try:
            query = """
                SELECT
                    lp.id AS promotion_id,
                    COALESCE(lp.name->>'ar_001', lp.name->>'en_US', '') AS name,
                    lr.code AS discount_code,
                    lr.mode AS mode,
                    lr.minimum_qty AS min_quantity,
                    lr.minimum_amount AS min_amount,
                    lr.discount AS discount_value,
                    COALESCE(pp.barcode, pp_eligible.barcode) AS product_barcode,
                    COALESCE(
                        pc.name->>'ar_001', pc.name->>'en_US'
                    ) AS category,
                    lp.active,
                    lp.write_date AS last_updated

                FROM loyalty_program lp
                LEFT JOIN loyalty_rule lr ON lr.program_id = lp.id
                LEFT JOIN product_product pp ON pp.id = lp.product_id
                LEFT JOIN product_template pt ON pt.id = pp.product_tmpl_id
                LEFT JOIN product_category pc ON pc.id = pt.categ_id
                LEFT JOIN loyalty_rule_product_product_rel lrp ON lrp.loyalty_rule_id = lr.id
                LEFT JOIN product_product pp_eligible ON pp_eligible.id = lrp.product_product_id
                
                WHERE lp.active = TRUE
                AND lr.active = TRUE
                AND lr.discount IS NOT NULL
                AND lr.discount > 0
                ORDER BY lp.id
            """
            
            request.env.cr.execute(query)
            raw_results = request.env.cr.dictfetchall()
            
            promotions = []
            seen_ids = set()
            
            for row in raw_results:
                if row['promotion_id'] in seen_ids:
                    continue
                seen_ids.add(row['promotion_id'])
                
                promotions.append({
                    'id': row['promotion_id'],
                    'name': row['name'],
                    'discount_code': row['discount_code'],
                    'discount_type': 'PERCENTAGE',
                    'discount_value': float(row['discount_value'] or 0),
                    'min_quantity': float(row['min_quantity'] or 0),
                    'min_amount': float(row['min_amount'] or 0),
                    'product_barcode': row['product_barcode'],
                    'category': row['category'],
                    'active': row['active'],
                    'last_updated': row['last_updated'].isoformat() if row['last_updated'] else None
                })
            
            return {
                'status': 'success',
                'data': promotions,
                'count': len(promotions)
            }

        except Exception as e:
            _logger.exception("Failed to fetch all promotions")
            return {
                'status': 'error',
                'message': str(e)
            }
