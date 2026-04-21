const express = require('express');
const router = express.Router();

// Middleware
router.use(express.json());
router.use(express.urlencoded({ extended: true }));

// Make sure db is available
router.use((req, res, next) => {
    if (!req.db && req.app && req.app.get) {
        req.db = req.app.get('db');
    }
    next();
});

// ============================================
// HELPER FUNCTION: Get or Create Cart
// ============================================
async function getOrCreateCart(db, userId) {
    // Check if cart exists
    const cartResult = await db.query(
        'SELECT id FROM cart WHERE user_id = $1',
        [userId]
    );
    
    if (cartResult.rows.length > 0) {
        return cartResult.rows[0].id;
    } else {
        // Create new cart
        const newCart = await db.query(
            'INSERT INTO cart (user_id) VALUES ($1) RETURNING id',
            [userId]
        );
        return newCart.rows[0].id;
    }
}

// ============================================
// API: GET CART ITEMS (WITH IMAGE URL FROM PRODUCTS TABLE)
// ============================================
router.get("/api/cart", async (req, res) => {
    if (!req.session || !req.session.user) {
        return res.status(401).json({ 
            success: false, 
            message: 'Please login to view cart',
            items: [] 
        });
    }
    
    const userId = req.session.user.id;
    
    try {
        const query = `
            SELECT ci.id, ci.product_id, ci.quantity, ci.unit_price, 
                   p.name as product_name, p.compare_price, p.sku, p.price, p.image_url, p.stock_quantity
            FROM cart c 
            JOIN cart_items ci ON c.id = ci.cart_id 
            JOIN products p ON ci.product_id = p.id 
            WHERE c.user_id = $1
            ORDER BY ci.created_at DESC
        `;
        
        const result = await req.db.query(query, [userId]);
        
        let subtotal = 0;
        const items = result.rows.map(item => {
            const itemTotal = item.quantity * parseFloat(item.unit_price);
            subtotal += itemTotal;
            return {
                ...item,
                item_total: itemTotal.toFixed(2),
                max_quantity: item.stock_quantity || 0,
                is_out_of_stock: (item.stock_quantity || 0) === 0,
                is_low_stock: (item.stock_quantity || 0) > 0 && (item.stock_quantity || 0) <= 5
            };
        });
        
        res.json({
            success: true,
            items: items,
            summary: {
                subtotal: subtotal.toFixed(2),
                tax: (subtotal * 0.075).toFixed(2),
                total: (subtotal * 1.075).toFixed(2),
                item_count: items.reduce((sum, i) => sum + i.quantity, 0)
            }
        });
    } catch (error) {
        console.error('Cart error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Failed to load cart',
            items: [] 
        });
    }
});

// ============================================
// API: ADD ITEM TO CART (WITH STOCK LIMIT CHECK)
// ============================================
router.post("/api/cart/add", async (req, res) => {
    if (!req.session || !req.session.user) {
        return res.status(401).json({ 
            success: false, 
            message: 'Please login to add items to cart' 
        });
    }
    
    const userId = req.session.user.id;
    const { product_id, quantity = 1 } = req.body;
    
    if (!product_id) {
        return res.status(400).json({ 
            success: false, 
            message: 'Product ID is required' 
        });
    }
    
    if (quantity <= 0) {
        return res.status(400).json({ 
            success: false, 
            message: 'Quantity must be at least 1' 
        });
    }
    
    try {
        // Get product details including stock quantity
        const productResult = await req.db.query(
            'SELECT id, price, name, stock_quantity FROM products WHERE id = $1 AND is_active = true',
            [product_id]
        );
        
        if (productResult.rows.length === 0) {
            return res.status(404).json({ 
                success: false, 
                message: 'Product not found' 
            });
        }
        
        const product = productResult.rows[0];
        const availableStock = parseInt(product.stock_quantity) || 0;
        const unitPrice = parseFloat(product.price);
        
        if (availableStock === 0) {
            return res.status(400).json({ 
                success: false, 
                message: `${product.name} is out of stock!` 
            });
        }
        
        if (quantity > availableStock) {
            return res.status(400).json({ 
                success: false, 
                message: `Only ${availableStock} items available in stock. You requested ${quantity}.` 
            });
        }
        
        const cartId = await getOrCreateCart(req.db, userId);
        
        // Check if item already exists in cart
        const existingResult = await req.db.query(
            'SELECT id, quantity FROM cart_items WHERE cart_id = $1 AND product_id = $2',
            [cartId, product_id]
        );
        
        if (existingResult.rows.length > 0) {
            const currentQuantity = existingResult.rows[0].quantity;
            const newQuantity = currentQuantity + quantity;
            
            if (newQuantity > availableStock) {
                const maxCanAdd = availableStock - currentQuantity;
                return res.status(400).json({ 
                    success: false, 
                    message: `Cannot add ${quantity}. Only ${maxCanAdd} more available (Max ${availableStock} in stock). You already have ${currentQuantity} in cart.` 
                });
            }
            
            await req.db.query(
                'UPDATE cart_items SET quantity = $1 WHERE id = $2',
                [newQuantity, existingResult.rows[0].id]
            );
            
            res.json({ 
                success: true, 
                message: `${product.name} quantity updated to ${newQuantity}/${availableStock} in stock`,
                cart_quantity: newQuantity,
                max_stock: availableStock,
                remaining_stock: availableStock - newQuantity
            });
        } else {
            await req.db.query(
                'INSERT INTO cart_items (cart_id, product_id, quantity, unit_price) VALUES ($1, $2, $3, $4)',
                [cartId, product_id, quantity, unitPrice]
            );
            
            res.json({ 
                success: true, 
                message: `${product.name} added to cart! (${quantity}/${availableStock} in stock)`,
                cart_quantity: quantity,
                max_stock: availableStock,
                remaining_stock: availableStock - quantity
            });
        }
    } catch (error) {
        console.error('Cart add error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Failed to add to cart' 
        });
    }
});

// ============================================
// API: UPDATE CART ITEM QUANTITY (WITH STOCK LIMIT CHECK)
// ============================================
router.post("/api/cart/update", async (req, res) => {
    if (!req.session || !req.session.user) {
        return res.status(401).json({ 
            success: false, 
            message: 'Please login' 
        });
    }
    
    const { cart_item_id, quantity } = req.body;
    
    if (!cart_item_id || quantity === undefined || quantity < 0) {
        return res.status(400).json({ 
            success: false, 
            message: 'Invalid request' 
        });
    }
    
    try {
        if (quantity === 0) {
            await req.db.query('DELETE FROM cart_items WHERE id = $1', [cart_item_id]);
            res.json({ 
                success: true, 
                message: 'Item removed from cart' 
            });
        } else {
            const itemResult = await req.db.query(
                `SELECT ci.product_id, p.stock_quantity, p.name
                 FROM cart_items ci 
                 JOIN products p ON ci.product_id = p.id 
                 WHERE ci.id = $1`,
                [cart_item_id]
            );
            
            if (itemResult.rows.length === 0) {
                return res.status(404).json({ 
                    success: false, 
                    message: 'Item not found' 
                });
            }
            
            const availableStock = itemResult.rows[0].stock_quantity;
            const productName = itemResult.rows[0].name;
            
            if (quantity > availableStock) {
                return res.status(400).json({ 
                    success: false, 
                    message: `Only ${availableStock} ${productName}(s) available in stock. Cannot set quantity to ${quantity}.` 
                });
            }
            
            await req.db.query(
                'UPDATE cart_items SET quantity = $1 WHERE id = $2',
                [quantity, cart_item_id]
            );
            
            res.json({ 
                success: true, 
                message: `${productName} quantity updated to ${quantity}/${availableStock} in stock`,
                remaining_stock: availableStock - quantity
            });
        }
    } catch (error) {
        console.error('Cart update error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Failed to update quantity' 
        });
    }
});

// ============================================
// API: REMOVE ITEM FROM CART
// ============================================
router.post("/api/cart/remove", async (req, res) => {
    if (!req.session || !req.session.user) {
        return res.status(401).json({ 
            success: false, 
            message: 'Please login' 
        });
    }
    
    const { cart_item_id } = req.body;
    
    if (!cart_item_id) {
        return res.status(400).json({ 
            success: false, 
            message: 'Cart item ID required' 
        });
    }
    
    try {
        await req.db.query('DELETE FROM cart_items WHERE id = $1', [cart_item_id]);
        res.json({ 
            success: true, 
            message: 'Item removed from cart' 
        });
    } catch (error) {
        console.error('Cart remove error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Failed to remove item' 
        });
    }
});

// ============================================
// API: GET CART COUNT (for badge)
// ============================================
router.get("/api/cart/count", async (req, res) => {
    if (!req.session || !req.session.user) {
        return res.json({ count: 0 });
    }
    
    const userId = req.session.user.id;
    
    try {
        const query = `
            SELECT COALESCE(SUM(ci.quantity), 0) as count
            FROM cart c 
            JOIN cart_items ci ON c.id = ci.cart_id 
            WHERE c.user_id = $1
        `;
        
        const result = await req.db.query(query, [userId]);
        res.json({ count: parseInt(result.rows[0].count) || 0 });
    } catch (error) {
        console.error('Cart count error:', error);
        res.json({ count: 0 });
    }
});

// ============================================
// API: CLEAR ENTIRE CART
// ============================================
router.post("/api/cart/clear", async (req, res) => {
    if (!req.session || !req.session.user) {
        return res.status(401).json({ 
            success: false, 
            message: 'Please login' 
        });
    }
    
    const userId = req.session.user.id;
    
    try {
        await req.db.query(
            'DELETE FROM cart_items WHERE cart_id IN (SELECT id FROM cart WHERE user_id = $1)',
            [userId]
        );
        
        res.json({ 
            success: true, 
            message: 'Cart cleared successfully' 
        });
    } catch (error) {
        console.error('Cart clear error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Failed to clear cart' 
        });
    }
});

// ============================================
// API: CHECK PRODUCT STOCK
// ============================================
router.get("/api/product/stock/:id", async (req, res) => {
    const productId = req.params.id;
    
    try {
        const result = await req.db.query(
            'SELECT stock_quantity, name FROM products WHERE id = $1',
            [productId]
        );
        
        if (result.rows.length === 0) {
            return res.json({ success: false, stock: 0, message: 'Product not found' });
        }
        
        const stock = parseInt(result.rows[0].stock_quantity) || 0;
        res.json({ 
            success: true, 
            stock: stock,
            name: result.rows[0].name,
            is_in_stock: stock > 0,
            message: stock > 0 ? `${stock} items available` : 'Out of stock'
        });
    } catch (error) {
        console.error('Stock check error:', error);
        res.json({ success: false, stock: 0, message: 'Error checking stock' });
    }
});

// ============================================
// API: BULK CHECK STOCK FOR MULTIPLE PRODUCTS
// ============================================
router.post("/api/cart/check-stock", async (req, res) => {
    if (!req.session || !req.session.user) {
        return res.status(401).json({ success: false, message: 'Please login' });
    }
    
    const { items } = req.body;
    
    if (!items || !Array.isArray(items)) {
        return res.status(400).json({ success: false, message: 'Invalid request' });
    }
    
    try {
        const stockStatus = [];
        let allInStock = true;
        
        for (const item of items) {
            const result = await req.db.query(
                'SELECT stock_quantity, name FROM products WHERE id = $1',
                [item.product_id]
            );
            
            if (result.rows.length === 0) {
                stockStatus.push({
                    product_id: item.product_id,
                    requested: item.quantity,
                    available: 0,
                    in_stock: false,
                    message: 'Product not found'
                });
                allInStock = false;
            } else {
                const available = parseInt(result.rows[0].stock_quantity) || 0;
                const inStock = item.quantity <= available;
                stockStatus.push({
                    product_id: item.product_id,
                    name: result.rows[0].name,
                    requested: item.quantity,
                    available: available,
                    in_stock: inStock,
                    message: inStock ? 'In stock' : `Only ${available} available, you requested ${item.quantity}`
                });
                if (!inStock) allInStock = false;
            }
        }
        
        res.json({
            success: true,
            all_in_stock: allInStock,
            items: stockStatus
        });
    } catch (error) {
        console.error('Bulk stock check error:', error);
        res.status(500).json({ success: false, message: 'Failed to check stock' });
    }
});

module.exports = router;