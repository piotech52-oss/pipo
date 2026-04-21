const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const multer = require('multer');
const path = require('path');
const axios = require('axios');
const crypto = require('crypto');
const PDFDocument = require('pdfkit');
require('dotenv').config();

// ============================================
// USE MEMORY STORAGE FOR VERCEL (not disk)
// ============================================
const storage = multer.memoryStorage(); // Changed from diskStorage

const fileFilter = (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif|webp/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    
    if (mimetype && extname) {
        return cb(null, true);
    } else {
        cb(new Error('Only image files are allowed'));
    }
};

const upload = multer({ 
    storage: storage, // Use memory storage
    limits: { fileSize: 2 * 1024 * 1024 },
    fileFilter: fileFilter
});

// ============================================
// FLUTTERWAVE CONFIGURATION
// ============================================
const FLW_SECRET_KEY = process.env.FLW_SECRET_KEY;
const FLW_PUBLIC_KEY = process.env.FLW_PUBLIC_KEY;

// Rest of your helper functions remain the same...
function sanitizeInput(input) {
    if (!input) return '';
    return input
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#x27;')
        .replace(/\//g, '&#x2F;');
}

function isValidEmail(email) {
    const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
    return emailRegex.test(email);
}

function formatNaira(amount) {
    return new Intl.NumberFormat('en-NG', {
        style: 'currency',
        currency: 'NGN',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    }).format(amount);
}

// ============================================
// MIDDLEWARE
// ============================================
router.use((req, res, next) => {
    if (!req.db) {
        req.db = req.app.get('db');
    }
    next();
});

// ============================================
// PAGE ROUTES (same as before)
// ============================================
router.get("/login", (req, res) => {
    res.sendFile("index.html", { root: "public" });
});

router.get("/register", (req, res) => {
    res.sendFile("register.html", { root: "public" });
});

router.get("/dashboard", (req, res) => {
    if (req.session && req.session.user) {
        res.sendFile("dashboard.html", { root: "public" });
    } else {
        res.redirect("/login");
    }
});

router.get("/cart", (req, res) => {
    if (req.session && req.session.user) {
        res.sendFile("cart.html", { root: "public" });
    } else {
        res.redirect("/login");
    }
});

router.get("/checkout", (req, res) => {
    if (req.session && req.session.user) {
        res.sendFile("checkout.html", { root: "public" });
    } else {
        res.redirect("/login");
    }
});

router.get("/order-confirmation", (req, res) => {
    if (req.session && req.session.user) {
        res.sendFile("order-confirmation.html", { root: "public" });
    } else {
        res.redirect("/login");
    }
});

router.get("/product", (req, res) => {
    if (req.session && req.session.user) {
        res.sendFile("product.html", { root: "public" });
    } else {
        res.redirect("/login");
    }
});

router.get("/orders", (req, res) => {
    if (req.session && req.session.user) {
        res.sendFile("orders.html", { root: "public" });
    } else {
        res.redirect("/login");
    }
});

router.get("/profile", (req, res) => {
    if (req.session && req.session.user) {
        res.sendFile("profile.html", { root: "public" });
    } else {
        res.redirect("/login");
    }
});

router.get("/wishlist", (req, res) => {
    if (req.session && req.session.user) {
        res.sendFile("wishlist.html", { root: "public" });
    } else {
        res.redirect("/login");
    }
});

router.get("/offers", (req, res) => {
    if (req.session && req.session.user) {
        res.sendFile("offers.html", { root: "public" });
    } else {
        res.redirect("/login");
    }
});

router.get("/support", (req, res) => {
    if (req.session && req.session.user) {
        res.sendFile("support.html", { root: "public" });
    } else {
        res.redirect("/login");
    }
});

// ============================================
// API ROUTES (AUTH, CART, ORDERS)
// ============================================

router.get("/api/me", (req, res) => {
    if (req.session && req.session.user) {
        res.json({ success: true, user: req.session.user });
    } else {
        res.status(401).json({ success: false, message: 'Not logged in' });
    }
});

router.post("/api/logout", (req, res) => {
    req.session.destroy(() => {
        res.json({ success: true, message: 'Logged out' });
    });
});

router.post("/api/login", async (req, res) => {
    const { email, password } = req.body;
    
    if (!email || !password) {
        return res.status(400).json({ success: false, message: 'Email and password required' });
    }
    
    try {
        const result = await req.db.query(
            'SELECT * FROM users WHERE email = $1',
            [email]
        );
        
        if (result.rows.length === 0) {
            return res.status(401).json({ success: false, message: 'Invalid email or password' });
        }
        
        const user = result.rows[0];
        const passwordMatch = await bcrypt.compare(password, user.password_hash);
        
        if (passwordMatch) {
            req.session.user = {
                id: user.id,
                email: user.email,
                full_name: user.full_name,
                role: user.role
            };
            
            await req.db.query(
                'UPDATE users SET last_login = NOW() WHERE id = $1',
                [user.id]
            );
            
            res.json({ success: true, message: 'Login successful', user: req.session.user });
        } else {
            res.status(401).json({ success: false, message: 'Invalid email or password' });
        }
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

router.post("/api/register", async (req, res) => {
    let { fullName, email, phone, countryCode, password } = req.body;
    
    fullName = sanitizeInput(fullName);
    email = sanitizeInput(email);
    phone = sanitizeInput(phone);
    
    if (!fullName || !email || !phone || !password) {
        return res.status(400).json({ success: false, message: 'All fields required' });
    }
    
    if (!isValidEmail(email)) {
        return res.status(400).json({ success: false, message: 'Invalid email' });
    }
    
    if (password.length < 6) {
        return res.status(400).json({ success: false, message: 'Password must be at least 6 characters' });
    }
    
    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        const fullPhone = `${countryCode} ${phone}`;
        
        const checkResult = await req.db.query(
            'SELECT id FROM users WHERE email = $1',
            [email]
        );
        
        if (checkResult.rows.length > 0) {
            return res.status(409).json({ success: false, message: 'Email already registered' });
        }
        
        const result = await req.db.query(
            `INSERT INTO users (email, password_hash, full_name, phone, role) 
             VALUES ($1, $2, $3, $4, 'customer') RETURNING id`,
            [email, hashedPassword, fullName, fullPhone]
        );
        
        res.status(201).json({ success: true, message: 'Account created successfully!' });
    } catch (error) {
        console.error('Registration error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// ============================================
// PRODUCT API ROUTES
// ============================================

router.get("/api/categories", async (req, res) => {
    try {
        const result = await req.db.query(
            'SELECT * FROM categories WHERE is_active = true ORDER BY name'
        );
        res.json({ success: true, categories: result.rows });
    } catch (error) {
        console.error('Error loading categories:', error);
        res.status(500).json({ success: false, categories: [] });
    }
});

router.get("/api/colors", async (req, res) => {
    try {
        const result = await req.db.query(
            'SELECT * FROM colors WHERE is_active = true ORDER BY name'
        );
        res.json({ success: true, colors: result.rows });
    } catch (error) {
        console.error('Error loading colors:', error);
        res.status(500).json({ success: false, colors: [] });
    }
});

router.get("/api/trending-products", async (req, res) => {
    try {
        const result = await req.db.query(
            `SELECT p.*, c.name as category_name, cl.name as color_name 
             FROM products p
             LEFT JOIN categories c ON p.category_id = c.id
             LEFT JOIN colors cl ON p.color_id = cl.id
             WHERE p.is_active = true AND p.is_trending = true 
             LIMIT 20`
        );
        res.json({ success: true, products: result.rows });
    } catch (error) {
        console.error('Error loading products:', error);
        res.status(500).json({ success: false, products: [] });
    }
});

router.get("/api/product/:id", async (req, res) => {
    const productId = req.params.id;
    
    try {
        const result = await req.db.query(
            `SELECT p.*, c.name as category_name, cl.name as color_name 
             FROM products p
             LEFT JOIN categories c ON p.category_id = c.id
             LEFT JOIN colors cl ON p.color_id = cl.id
             WHERE p.id = $1 AND p.is_active = true`,
            [productId]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Product not found' });
        }
        
        res.json({ success: true, product: result.rows[0] });
    } catch (error) {
        console.error('Error loading product:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

router.get("/api/products/count", async (req, res) => {
    try {
        const result = await req.db.query(
            'SELECT COUNT(*) as count FROM products WHERE is_active = true'
        );
        res.json({ count: parseInt(result.rows[0].count) });
    } catch (error) {
        res.json({ count: 0 });
    }
});

router.get("/api/user/orders/count", async (req, res) => {
    if (!req.session.user) return res.json({ count: 0 });
    
    try {
        const result = await req.db.query(
            'SELECT COUNT(*) as count FROM orders WHERE user_id = $1',
            [req.session.user.id]
        );
        res.json({ count: parseInt(result.rows[0].count) });
    } catch (error) {
        res.json({ count: 0 });
    }
});

router.get("/api/user/total-spent", async (req, res) => {
    if (!req.session.user) return res.json({ total: 0 });
    
    try {
        const result = await req.db.query(
            'SELECT SUM(total_amount) as total FROM orders WHERE user_id = $1',
            [req.session.user.id]
        );
        res.json({ total: parseFloat(result.rows[0].total) || 0 });
    } catch (error) {
        res.json({ total: 0 });
    }
});

router.get("/api/user/wishlist/count", async (req, res) => {
    if (!req.session.user) return res.json({ count: 0 });
    
    try {
        const result = await req.db.query(
            'SELECT COUNT(*) as count FROM wishlist WHERE user_id = $1',
            [req.session.user.id]
        );
        res.json({ count: parseInt(result.rows[0].count) });
    } catch (error) {
        res.json({ count: 0 });
    }
});

router.get("/api/check-email/:email", async (req, res) => {
    const email = sanitizeInput(req.params.email);
    
    try {
        const result = await req.db.query(
            'SELECT id FROM users WHERE email = $1',
            [email]
        );
        res.json({ exists: result.rows.length > 0 });
    } catch (error) {
        res.json({ exists: false });
    }
});

// ============================================
// CART API (same as your existing code)
// ============================================

router.get("/api/cart/count", async (req, res) => {
    if (!req.session.user) {
        return res.json({ count: 0 });
    }
    
    try {
        const cartResult = await req.db.query(
            'SELECT id FROM cart WHERE user_id = $1',
            [req.session.user.id]
        );
        
        if (cartResult.rows.length === 0) {
            return res.json({ count: 0 });
        }
        
        const itemsResult = await req.db.query(
            'SELECT SUM(quantity) as count FROM cart_items WHERE cart_id = $1',
            [cartResult.rows[0].id]
        );
        
        res.json({ count: parseInt(itemsResult.rows[0].count) || 0 });
    } catch (error) {
        res.json({ count: 0 });
    }
});

router.post("/api/cart/add", async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ success: false, message: 'Please login' });
    }
    
    const { product_id, quantity } = req.body;
    const userId = req.session.user.id;
    
    try {
        const productResult = await req.db.query(
            'SELECT id, price FROM products WHERE id = $1 AND is_active = true',
            [product_id]
        );
        
        if (productResult.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Product not found' });
        }
        
        const unitPrice = parseFloat(productResult.rows[0].price);
        
        let cartResult = await req.db.query(
            'SELECT id FROM cart WHERE user_id = $1',
            [userId]
        );
        
        let cartId;
        if (cartResult.rows.length === 0) {
            const newCart = await req.db.query(
                'INSERT INTO cart (user_id) VALUES ($1) RETURNING id',
                [userId]
            );
            cartId = newCart.rows[0].id;
        } else {
            cartId = cartResult.rows[0].id;
        }
        
        const existingItem = await req.db.query(
            'SELECT id, quantity FROM cart_items WHERE cart_id = $1 AND product_id = $2',
            [cartId, product_id]
        );
        
        if (existingItem.rows.length > 0) {
            const newQuantity = existingItem.rows[0].quantity + quantity;
            await req.db.query(
                'UPDATE cart_items SET quantity = $1 WHERE id = $2',
                [newQuantity, existingItem.rows[0].id]
            );
        } else {
            await req.db.query(
                'INSERT INTO cart_items (cart_id, product_id, quantity, unit_price) VALUES ($1, $2, $3, $4)',
                [cartId, product_id, quantity, unitPrice]
            );
        }
        
        res.json({ success: true, message: 'Added to cart' });
    } catch (error) {
        console.error('Cart add error:', error);
        res.status(500).json({ success: false, message: 'Failed to add to cart' });
    }
});

router.get("/api/cart", async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ success: false, message: 'Please login' });
    }
    
    try {
        const cartResult = await req.db.query(
            'SELECT id FROM cart WHERE user_id = $1',
            [req.session.user.id]
        );
        
        if (cartResult.rows.length === 0) {
            return res.json({ success: true, items: [] });
        }
        
        const itemsResult = await req.db.query(
            `SELECT ci.*, p.name as product_name, p.image_url, p.sku, p.stock_quantity as max_quantity
             FROM cart_items ci
             JOIN products p ON ci.product_id = p.id
             WHERE ci.cart_id = $1`,
            [cartResult.rows[0].id]
        );
        
        res.json({ success: true, items: itemsResult.rows });
    } catch (error) {
        console.error('Error loading cart:', error);
        res.status(500).json({ success: false, items: [] });
    }
});

router.post("/api/cart/update", async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ success: false, message: 'Please login' });
    }
    
    const { cart_item_id, quantity } = req.body;
    
    try {
        await req.db.query(
            'UPDATE cart_items SET quantity = $1 WHERE id = $2',
            [quantity, cart_item_id]
        );
        
        res.json({ success: true, message: 'Cart updated' });
    } catch (error) {
        console.error('Error updating cart:', error);
        res.status(500).json({ success: false, message: 'Failed to update cart' });
    }
});

router.post("/api/cart/remove", async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ success: false, message: 'Please login' });
    }
    
    const { cart_item_id } = req.body;
    
    try {
        await req.db.query(
            'DELETE FROM cart_items WHERE id = $1',
            [cart_item_id]
        );
        
        res.json({ success: true, message: 'Item removed' });
    } catch (error) {
        console.error('Error removing item:', error);
        res.status(500).json({ success: false, message: 'Failed to remove item' });
    }
});

// ============================================
// ORDER API
// ============================================

router.post("/api/orders/create", async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ success: false, message: 'Please login' });
    }
    
    const { address, items, subtotal, payment_method } = req.body;
    
    if (!items || items.length === 0) {
        return res.status(400).json({ success: false, message: 'Cart is empty' });
    }
    
    const orderNumber = 'ORD-' + Date.now() + '-' + Math.floor(Math.random() * 1000);
    
    try {
        const addressResult = await req.db.query(
            `INSERT INTO addresses (user_id, full_name, address_line1, city, state, postal_code, phone) 
             VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
            [req.session.user.id, address.fullName, address.address, address.city, address.state, address.postalCode || '', address.phone]
        );
        
        const addressId = addressResult.rows[0].id;
        
        const orderResult = await req.db.query(
            `INSERT INTO orders (order_number, user_id, address_id, subtotal, total_amount, payment_method, status, payment_status) 
             VALUES ($1, $2, $3, $4, $5, $6, 'pending', 'pending') RETURNING id`,
            [orderNumber, req.session.user.id, addressId, subtotal, subtotal, payment_method]
        );
        
        const orderId = orderResult.rows[0].id;
        
        for (const item of items) {
            await req.db.query(
                `INSERT INTO order_items (order_id, product_id, quantity, unit_price, total_price) 
                 VALUES ($1, $2, $3, $4, $5)`,
                [orderId, item.product_id, item.quantity, item.unit_price, item.quantity * item.unit_price]
            );
        }
        
        const cartResult = await req.db.query(
            'SELECT id FROM cart WHERE user_id = $1',
            [req.session.user.id]
        );
        
        if (cartResult.rows.length > 0) {
            await req.db.query(
                'DELETE FROM cart_items WHERE cart_id = $1',
                [cartResult.rows[0].id]
            );
        }
        
        res.json({ success: true, order_id: orderId, order_number: orderNumber });
    } catch (error) {
        console.error('Order creation error:', error);
        res.status(500).json({ success: false, message: 'Failed to create order' });
    }
});

router.get("/api/orders", async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ success: false });
    }
    
    try {
        const result = await req.db.query(
            `SELECT o.*, a.address_line1, a.city, a.full_name
             FROM orders o 
             JOIN addresses a ON o.address_id = a.id 
             WHERE o.user_id = $1 
             ORDER BY o.created_at DESC`,
            [req.session.user.id]
        );
        
        res.json({ success: true, orders: result.rows });
    } catch (error) {
        console.error('Error loading orders:', error);
        res.status(500).json({ success: false, orders: [] });
    }
});

router.get("/api/orders/:id", async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ success: false });
    }
    
    const orderId = req.params.id;
    
    try {
        const orderResult = await req.db.query(
            `SELECT o.*, a.address_line1, a.city, a.state, a.phone, a.postal_code, a.full_name
             FROM orders o 
             JOIN addresses a ON o.address_id = a.id 
             WHERE o.id = $1 AND o.user_id = $2`,
            [orderId, req.session.user.id]
        );
        
        if (orderResult.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Order not found' });
        }
        
        const itemsResult = await req.db.query(
            `SELECT oi.*, p.name as product_name 
             FROM order_items oi 
             JOIN products p ON oi.product_id = p.id 
             WHERE oi.order_id = $1`,
            [orderId]
        );
        
        res.json({ success: true, order: orderResult.rows[0], items: itemsResult.rows });
    } catch (error) {
        console.error('Error loading order:', error);
        res.status(500).json({ success: false });
    }
});

// ============================================
// PROFILE API
// ============================================

router.post("/api/profile/update", async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ success: false, message: 'Please login' });
    }
    
    const { full_name, phone } = req.body;
    const userId = req.session.user.id;
    
    if (!full_name) {
        return res.status(400).json({ success: false, message: 'Name is required' });
    }
    
    try {
        await req.db.query(
            'UPDATE users SET full_name = $1, phone = $2 WHERE id = $3',
            [full_name, phone, userId]
        );
        
        req.session.user.full_name = full_name;
        res.json({ success: true, message: 'Profile updated successfully!' });
    } catch (error) {
        console.error('Profile update error:', error);
        res.status(500).json({ success: false, message: 'Failed to update profile' });
    }
});

router.post("/api/profile/change-password", async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ success: false, message: 'Please login' });
    }
    
    const { current_password, new_password, confirm_password } = req.body;
    const userId = req.session.user.id;
    
    if (!current_password || !new_password || !confirm_password) {
        return res.status(400).json({ success: false, message: 'All password fields are required' });
    }
    
    if (new_password !== confirm_password) {
        return res.status(400).json({ success: false, message: 'New passwords do not match' });
    }
    
    if (new_password.length < 6) {
        return res.status(400).json({ success: false, message: 'Password must be at least 6 characters' });
    }
    
    try {
        const userResult = await req.db.query(
            'SELECT password_hash FROM users WHERE id = $1',
            [userId]
        );
        
        if (userResult.rows.length === 0) {
            return res.status(500).json({ success: false, message: 'User not found' });
        }
        
        const passwordMatch = await bcrypt.compare(current_password, userResult.rows[0].password_hash);
        
        if (!passwordMatch) {
            return res.status(400).json({ success: false, message: 'Current password is incorrect' });
        }
        
        const newHashedPassword = await bcrypt.hash(new_password, 10);
        
        await req.db.query(
            'UPDATE users SET password_hash = $1 WHERE id = $2',
            [newHashedPassword, userId]
        );
        
        res.json({ success: true, message: 'Password changed successfully!' });
    } catch (error) {
        console.error('Password change error:', error);
        res.status(500).json({ success: false, message: 'Failed to update password' });
    }
});

// ============================================
// WISHLIST API
// ============================================

router.get("/api/wishlist", async (req, res) => {
    if (!req.session || !req.session.user) {
        return res.status(401).json({ success: false, message: 'Please login' });
    }
    
    const userId = req.session.user.id;
    
    try {
        const result = await req.db.query(
            `SELECT w.id, w.product_id, w.created_at,
                    p.name, p.price, p.image_url
             FROM wishlist w
             JOIN products p ON w.product_id = p.id
             WHERE w.user_id = $1
             ORDER BY w.created_at DESC`,
            [userId]
        );
        
        res.json({ success: true, items: result.rows });
    } catch (error) {
        console.error('Wishlist error:', error);
        res.status(500).json({ success: false, items: [] });
    }
});

router.post("/api/wishlist/add", async (req, res) => {
    if (!req.session || !req.session.user) {
        return res.status(401).json({ success: false, message: 'Please login' });
    }
    
    const userId = req.session.user.id;
    const { product_id } = req.body;
    
    if (!product_id) {
        return res.status(400).json({ success: false, message: 'Product ID required' });
    }
    
    try {
        const existing = await req.db.query(
            'SELECT id FROM wishlist WHERE user_id = $1 AND product_id = $2',
            [userId, product_id]
        );
        
        if (existing.rows.length > 0) {
            return res.status(409).json({ success: false, message: 'Product already in wishlist' });
        }
        
        await req.db.query(
            'INSERT INTO wishlist (user_id, product_id) VALUES ($1, $2)',
            [userId, product_id]
        );
        
        res.json({ success: true, message: 'Added to wishlist' });
    } catch (error) {
        console.error('Add to wishlist error:', error);
        res.status(500).json({ success: false, message: 'Failed to add to wishlist' });
    }
});

router.post("/api/wishlist/remove", async (req, res) => {
    if (!req.session || !req.session.user) {
        return res.status(401).json({ success: false, message: 'Please login' });
    }
    
    const userId = req.session.user.id;
    const { product_id } = req.body;
    
    try {
        await req.db.query(
            'DELETE FROM wishlist WHERE user_id = $1 AND product_id = $2',
            [userId, product_id]
        );
        
        res.json({ success: true, message: 'Removed from wishlist' });
    } catch (error) {
        console.error('Remove from wishlist error:', error);
        res.status(500).json({ success: false, message: 'Failed to remove from wishlist' });
    }
});

// ============================================
// PRODUCT REVIEWS API
// ============================================

router.get("/api/reviews/product/:productId", async (req, res) => {
    const productId = req.params.productId;
    
    try {
        const reviewsResult = await req.db.query(
            `SELECT r.*, u.full_name as user_name 
             FROM reviews r
             JOIN users u ON r.user_id = u.id
             WHERE r.product_id = $1 AND r.is_approved = true
             ORDER BY r.created_at DESC`,
            [productId]
        );
        
        const avgResult = await req.db.query(
            'SELECT AVG(rating) as avg_rating, COUNT(*) as total FROM reviews WHERE product_id = $1 AND is_approved = true',
            [productId]
        );
        
        res.json({
            success: true,
            reviews: reviewsResult.rows,
            avg_rating: parseFloat(avgResult.rows[0].avg_rating) || 0,
            total_reviews: parseInt(avgResult.rows[0].total) || 0
        });
    } catch (error) {
        console.error('Error loading reviews:', error);
        res.status(500).json({ success: false, reviews: [] });
    }
});

router.post("/api/reviews/add", async (req, res) => {
    if (!req.session || !req.session.user) {
        return res.status(401).json({ success: false, message: 'Please login to leave a review' });
    }
    
    const { product_id, rating, title, comment } = req.body;
    const userId = req.session.user.id;
    
    if (!product_id || !rating || !comment) {
        return res.status(400).json({ success: false, message: 'Rating and comment are required' });
    }
    
    try {
        const existing = await req.db.query(
            'SELECT id FROM reviews WHERE product_id = $1 AND user_id = $2',
            [product_id, userId]
        );
        
        if (existing.rows.length > 0) {
            return res.status(409).json({ success: false, message: 'You have already reviewed this product' });
        }
        
        await req.db.query(
            `INSERT INTO reviews (product_id, user_id, rating, title, comment, is_approved) 
             VALUES ($1, $2, $3, $4, $5, true)`,
            [product_id, userId, rating, title || '', comment]
        );
        
        res.json({ success: true, message: 'Review added successfully!' });
    } catch (error) {
        console.error('Add review error:', error);
        res.status(500).json({ success: false, message: 'Failed to add review' });
    }
});

router.get("/api/reviews/can-review/:productId", async (req, res) => {
    if (!req.session || !req.session.user) {
        return res.json({ canReview: false });
    }
    
    const productId = req.params.productId;
    const userId = req.session.user.id;
    
    try {
        const result = await req.db.query(
            `SELECT COUNT(*) as count FROM orders o 
             JOIN order_items oi ON o.id = oi.order_id 
             WHERE o.user_id = $1 AND oi.product_id = $2 AND o.status = 'delivered'`,
            [userId, productId]
        );
        
        res.json({ canReview: parseInt(result.rows[0].count) > 0 });
    } catch (error) {
        res.json({ canReview: false });
    }
});

router.post("/api/reviews/helpful", async (req, res) => {
    if (!req.session || !req.session.user) {
        return res.status(401).json({ success: false, message: 'Please login' });
    }
    
    const { review_id } = req.body;
    const userId = req.session.user.id;
    
    if (!review_id) {
        return res.status(400).json({ success: false, message: 'Review ID required' });
    }
    
    try {
        const existing = await req.db.query(
            'SELECT id FROM review_helpful_votes WHERE review_id = $1 AND user_id = $2',
            [review_id, userId]
        );
        
        if (existing.rows.length > 0) {
            return res.status(409).json({ success: false, message: 'You already marked this review as helpful' });
        }
        
        await req.db.query(
            'INSERT INTO review_helpful_votes (review_id, user_id) VALUES ($1, $2)',
            [review_id, userId]
        );
        
        await req.db.query(
            'UPDATE reviews SET helpful_count = helpful_count + 1 WHERE id = $1',
            [review_id]
        );
        
        res.json({ success: true, message: 'Thanks for your feedback!' });
    } catch (error) {
        console.error('Helpful vote error:', error);
        res.status(500).json({ success: false, message: 'Failed to record vote' });
    }
});

// ============================================
// ADMIN API ROUTES (with modified product add/update)
// ============================================

router.post("/api/admin/login", async (req, res) => {
    const { email, password } = req.body;
    
    try {
        const result = await req.db.query(
            'SELECT * FROM users WHERE email = $1 AND role = $2',
            [email, 'admin']
        );
        
        if (result.rows.length === 0) {
            return res.status(401).json({ success: false, message: 'Invalid admin credentials' });
        }
        
        const user = result.rows[0];
        const passwordMatch = await bcrypt.compare(password, user.password_hash);
        
        if (passwordMatch) {
            req.session.admin = {
                id: user.id,
                email: user.email,
                full_name: user.full_name,
                role: user.role
            };
            res.json({ success: true, message: 'Admin login successful' });
        } else {
            res.status(401).json({ success: false, message: 'Invalid admin credentials' });
        }
    } catch (error) {
        console.error('Admin login error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

router.get("/api/admin/check", (req, res) => {
    if (req.session && req.session.admin) {
        res.json({ success: true, admin: req.session.admin });
    } else {
        res.status(401).json({ success: false });
    }
});

router.post("/api/admin/logout", (req, res) => {
    req.session.admin = null;
    res.json({ success: true });
});

router.get("/api/admin/stats/orders", async (req, res) => {
    if (!req.session || !req.session.admin) return res.status(401).json({ success: false });
    
    try {
        const result = await req.db.query(
            'SELECT COUNT(*) as count, COALESCE(SUM(total_amount), 0) as revenue FROM orders'
        );
        res.json({ count: parseInt(result.rows[0].count), revenue: parseFloat(result.rows[0].revenue) });
    } catch (error) {
        res.json({ count: 0, revenue: 0 });
    }
});

router.get("/api/admin/stats/products", async (req, res) => {
    if (!req.session || !req.session.admin) return res.status(401).json({ success: false });
    
    try {
        const result = await req.db.query('SELECT COUNT(*) as count FROM products');
        res.json({ count: parseInt(result.rows[0].count) });
    } catch (error) {
        res.json({ count: 0 });
    }
});

router.get("/api/admin/stats/users", async (req, res) => {
    if (!req.session || !req.session.admin) return res.status(401).json({ success: false });
    
    try {
        const result = await req.db.query('SELECT COUNT(*) as count FROM users WHERE role = $1', ['customer']);
        res.json({ count: parseInt(result.rows[0].count) });
    } catch (error) {
        res.json({ count: 0 });
    }
});

router.get("/api/admin/orders/all", async (req, res) => {
    if (!req.session || !req.session.admin) return res.status(401).json({ success: false });
    
    try {
        const result = await req.db.query(
            `SELECT o.*, a.full_name as customer_name, a.phone, a.city, a.address_line1
             FROM orders o 
             LEFT JOIN addresses a ON o.address_id = a.id 
             ORDER BY o.created_at DESC`
        );
        res.json({ success: true, orders: result.rows });
    } catch (error) {
        console.error('Admin orders error:', error);
        res.status(500).json({ success: false, orders: [] });
    }
});

router.get("/api/admin/orders/:orderId", async (req, res) => {
    if (!req.session || !req.session.admin) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    
    const orderId = req.params.orderId;
    
    try {
        const orderResult = await req.db.query(
            `SELECT o.*, a.address_line1, a.city, a.state, a.phone, a.postal_code, a.full_name
             FROM orders o 
             LEFT JOIN addresses a ON o.address_id = a.id 
             WHERE o.id = $1`,
            [orderId]
        );
        
        if (orderResult.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Order not found' });
        }
        
        const itemsResult = await req.db.query(
            `SELECT oi.*, p.name as product_name 
             FROM order_items oi 
             JOIN products p ON oi.product_id = p.id 
             WHERE oi.order_id = $1`,
            [orderId]
        );
        
        res.json({ success: true, order: orderResult.rows[0], items: itemsResult.rows });
    } catch (error) {
        console.error('Admin order details error:', error);
        res.status(500).json({ success: false, message: 'Failed to load order details' });
    }
});

router.post("/api/admin/orders/update", async (req, res) => {
    if (!req.session || !req.session.admin) return res.status(401).json({ success: false });
    
    const { order_id, status } = req.body;
    
    try {
        await req.db.query(
            'UPDATE orders SET status = $1 WHERE id = $2',
            [status, order_id]
        );
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false });
    }
});

router.get("/api/admin/products/all", async (req, res) => {
    if (!req.session || !req.session.admin) return res.status(401).json({ success: false, products: [] });
    
    try {
        const result = await req.db.query(
            `SELECT p.*, c.name as category_name, cl.name as color_name 
             FROM products p
             LEFT JOIN categories c ON p.category_id = c.id
             LEFT JOIN colors cl ON p.color_id = cl.id
             ORDER BY p.created_at DESC`
        );
        res.json({ success: true, products: result.rows });
    } catch (error) {
        console.error('Error loading products:', error);
        res.status(500).json({ success: false, products: [] });
    }
});

// ============================================
// ADD PRODUCT WITH IMAGE UPLOAD (Modified for Vercel)
// ============================================
router.post("/api/admin/products/add", upload.single('image'), async (req, res) => {
    if (!req.session || !req.session.admin) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    
    const { name, category_id, color_id, price, compare_price, description, short_description, sku, stock_quantity, is_active, is_trending, is_featured } = req.body;
    
    console.log('Received product data:', { name, price, category_id });
    
    if (!name || !price) {
        return res.status(400).json({ success: false, message: 'Name and price are required' });
    }
    
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    
    // For Vercel, you need to upload images to a cloud storage service
    // Here's a placeholder - you'll need to implement cloud upload
    let image_url = null;
    
    if (req.file) {
        // OPTION 1: Upload to Supabase Storage
        // OPTION 2: Upload to Cloudinary
        // OPTION 3: Upload to AWS S3
        
        // For now, save as base64 (not recommended for production)
        const base64Image = req.file.buffer.toString('base64');
        const dataUri = `data:${req.file.mimetype};base64,${base64Image}`;
        image_url = dataUri; // Store in database (temporary solution)
        
        console.log('Image received but not saved to disk - use cloud storage');
    }
    
    try {
        const result = await req.db.query(
            `INSERT INTO products (name, slug, category_id, color_id, description, short_description, price, compare_price, sku, stock_quantity, is_active, is_trending, is_featured, image_url) 
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING id`,
            [
                name, slug, category_id || null, color_id || null, 
                description || null, short_description || null, parseFloat(price), 
                compare_price ? parseFloat(compare_price) : null, sku || null, 
                stock_quantity ? parseInt(stock_quantity) : 0, 
                is_active === '1' || is_active === 1 || is_active === true ? 1 : 0, 
                is_trending === '1' || is_trending === 1 || is_trending === true ? 1 : 0, 
                is_featured === '1' || is_featured === 1 || is_featured === true ? 1 : 0, 
                image_url
            ]
        );
        
        console.log('Product added with ID:', result.rows[0].id);
        res.json({ success: true, product_id: result.rows[0].id, message: 'Product added successfully' });
    } catch (error) {
        console.error('Add product error:', error);
        res.status(500).json({ success: false, message: 'Failed to add product: ' + error.message });
    }
});

// ============================================
// FLUTTERWAVE PAYMENT INTEGRATION
// ============================================

router.post("/api/flutterwave/initialize", async (req, res) => {
    if (!req.session || !req.session.user) {
        return res.status(401).json({ success: false, message: 'Please login' });
    }
    
    const { amount, email, fullname, metadata } = req.body;
    
    if (!amount || !email) {
        return res.status(400).json({ success: false, message: 'Missing required fields' });
    }
    
    const tx_ref = `PIO-${Date.now()}-${Math.floor(Math.random() * 1000000)}`;
    
    try {
        const response = await axios.post(
            'https://api.flutterwave.com/v3/payments',
            {
                tx_ref: tx_ref,
                amount: parseFloat(amount),
                currency: "NGN",
                redirect_url: `${req.protocol}://${req.get('host')}/flutterwave-callback`,
                payment_options: "card,ussd,banktransfer,mpesa",
                customer: {
                    email: email,
                    name: fullname || req.session.user.full_name,
                    phonenumber: metadata?.phone || ''
                },
                customizations: {
                    title: "PIO E-market",
                    description: "Payment for order",
                    logo: `${req.protocol}://${req.get('host')}/logo.png`
                },
                meta: {
                    user_id: req.session.user.id,
                    checkout_data: JSON.stringify(metadata)
                }
            },
            {
                headers: {
                    'Authorization': `Bearer ${FLW_SECRET_KEY}`,
                    'Content-Type': 'application/json'
                }
            }
        );
        
        if (response.data.status === 'success') {
            res.json({
                success: true,
                authorization_url: response.data.data.link,
                reference: tx_ref
            });
        } else {
            res.status(400).json({ 
                success: false, 
                message: response.data.message || 'Failed to initialize payment' 
            });
        }
    } catch (error) {
        console.error('Flutterwave API error:', error.response?.data || error.message);
        res.status(500).json({ 
            success: false, 
            message: 'Payment initialization failed: ' + (error.response?.data?.message || error.message)
        });
    }
});

router.get("/flutterwave-callback", async (req, res) => {
    const { transaction_id, tx_ref, status } = req.query;
    
    console.log('Flutterwave callback:', { transaction_id, tx_ref, status });
    
    if (status === 'successful' || status === 'success') {
        try {
            const verifyResponse = await axios.get(
                `https://api.flutterwave.com/v3/transactions/${transaction_id}/verify`,
                {
                    headers: {
                        'Authorization': `Bearer ${FLW_SECRET_KEY}`
                    }
                }
            );
            
            if (verifyResponse.data.status === 'success' && verifyResponse.data.data.status === 'successful') {
                const userId = verifyResponse.data.data.meta?.user_id;
                const checkoutData = verifyResponse.data.data.meta?.checkout_data ? JSON.parse(verifyResponse.data.data.meta.checkout_data) : null;
                
                if (userId && checkoutData) {
                    const { address, items, subtotal } = checkoutData;
                    
                    const orderNumber = 'ORD-' + Date.now() + '-' + Math.floor(Math.random() * 1000);
                    
                    const addressResult = await req.db.query(
                        `INSERT INTO addresses (user_id, full_name, address_line1, city, state, postal_code, phone) 
                         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
                        [userId, address.fullName, address.address, address.city, address.state, address.postalCode || '', address.phone]
                    );
                    
                    const addressId = addressResult.rows[0].id;
                    
                    const orderResult = await req.db.query(
                        `INSERT INTO orders (order_number, user_id, address_id, subtotal, total_amount, payment_method, status, payment_status, transaction_ref) 
                         VALUES ($1, $2, $3, $4, $5, 'flutterwave', 'processing', 'paid', $6) RETURNING id`,
                        [orderNumber, userId, addressId, subtotal, subtotal, tx_ref]
                    );
                    
                    const orderId = orderResult.rows[0].id;
                    
                    for (const item of items) {
                        await req.db.query(
                            `INSERT INTO order_items (order_id, product_id, quantity, unit_price, total_price) 
                             VALUES ($1, $2, $3, $4, $5)`,
                            [orderId, item.product_id, item.quantity, item.unit_price, item.quantity * item.unit_price]
                        );
                    }
                    
                    const cartResult = await req.db.query(
                        'SELECT id FROM cart WHERE user_id = $1',
                        [userId]
                    );
                    
                    if (cartResult.rows.length > 0) {
                        await req.db.query(
                            'DELETE FROM cart_items WHERE cart_id = $1',
                            [cartResult.rows[0].id]
                        );
                    }
                    
                    await req.db.query(
                        `INSERT INTO payments (order_id, transaction_id, payment_method, amount, status, paid_at) 
                         VALUES ($1, $2, 'flutterwave', $3, 'successful', NOW())`,
                        [orderId, transaction_id, verifyResponse.data.data.amount]
                    );
                    
                    res.redirect(`/order-confirmation?order_id=${orderId}&payment=success`);
                } else {
                    res.redirect('/orders?payment=failed');
                }
            } else {
                res.redirect('/orders?payment=failed');
            }
        } catch (error) {
            console.error('Flutterwave verification error:', error.response?.data || error.message);
            res.redirect('/orders?payment=failed');
        }
    } else {
        res.redirect('/orders?payment=failed');
    }
});

router.post("/api/flutterwave/webhook", async (req, res) => {
    const event = req.body;
    
    const signature = req.headers['verif-hash'];
    if (signature !== process.env.FLW_SECRET_HASH) {
        console.log('Invalid webhook signature');
        return res.sendStatus(401);
    }
    
    if (event.event === 'charge.completed' && event.data.status === 'successful') {
        const { tx_ref, amount, meta } = event.data;
        
        try {
            const existingOrder = await req.db.query(
                'SELECT id FROM orders WHERE transaction_ref = $1',
                [tx_ref]
            );
            
            if (existingOrder.rows.length === 0) {
                const checkoutData = meta?.checkout_data ? JSON.parse(meta.checkout_data) : null;
                
                if (checkoutData) {
                    const { address, items, subtotal } = checkoutData;
                    const userId = meta?.user_id;
                    
                    const orderNumber = 'ORD-' + Date.now() + '-' + Math.floor(Math.random() * 1000);
                    
                    const addressResult = await req.db.query(
                        `INSERT INTO addresses (user_id, full_name, address_line1, city, state, postal_code, phone) 
                         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
                        [userId, address.fullName, address.address, address.city, address.state, address.postalCode || '', address.phone]
                    );
                    
                    const addressId = addressResult.rows[0].id;
                    
                    const orderResult = await req.db.query(
                        `INSERT INTO orders (order_number, user_id, address_id, subtotal, total_amount, payment_method, status, payment_status, transaction_ref) 
                         VALUES ($1, $2, $3, $4, $5, 'flutterwave', 'processing', 'paid', $6) RETURNING id`,
                        [orderNumber, userId, addressId, subtotal, subtotal, tx_ref]
                    );
                    
                    const orderId = orderResult.rows[0].id;
                    
                    for (const item of items) {
                        await req.db.query(
                            `INSERT INTO order_items (order_id, product_id, quantity, unit_price, total_price) 
                             VALUES ($1, $2, $3, $4, $5)`,
                            [orderId, item.product_id, item.quantity, item.unit_price, item.quantity * item.unit_price]
                        );
                    }
                    
                    const cartResult = await req.db.query(
                        'SELECT id FROM cart WHERE user_id = $1',
                        [userId]
                    );
                    
                    if (cartResult.rows.length > 0) {
                        await req.db.query(
                            'DELETE FROM cart_items WHERE cart_id = $1',
                            [cartResult.rows[0].id]
                        );
                    }
                    
                    await req.db.query(
                        `INSERT INTO payments (order_id, transaction_id, payment_method, amount, status, paid_at) 
                         VALUES ($1, $2, 'flutterwave', $3, 'successful', NOW())`,
                        [orderId, event.data.id, amount]
                    );
                }
            }
        } catch (error) {
            console.error('Webhook error:', error);
        }
    }
    
    res.sendStatus(200);
});

// ============================================
// INVOICE PDF GENERATION (same as your code)
// ============================================

router.get("/api/invoice/:orderId", async (req, res) => {
    if (!req.session || !req.session.user) {
        return res.status(401).json({ success: false, message: 'Please login' });
    }
    
    const orderId = req.params.orderId;
    
    try {
        const orderResult = await req.db.query(
            `SELECT o.*, a.address_line1, a.city, a.state, a.phone, a.full_name, a.postal_code
             FROM orders o 
             JOIN addresses a ON o.address_id = a.id 
             WHERE o.id = $1 AND o.user_id = $2`,
            [orderId, req.session.user.id]
        );
        
        if (orderResult.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Order not found' });
        }
        
        const itemsResult = await req.db.query(
            `SELECT oi.*, p.name as product_name 
             FROM order_items oi 
             JOIN products p ON oi.product_id = p.id 
             WHERE oi.order_id = $1`,
            [orderId]
        );
        
        generateInvoice(orderResult.rows[0], itemsResult.rows, res);
    } catch (error) {
        console.error('Invoice error:', error);
        res.status(500).json({ success: false, message: 'Failed to generate invoice' });
    }
});

function generateInvoice(order, items, res) {
    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    const filename = `invoice-${order.order_number}.pdf`;
    
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    
    doc.pipe(res);
    
    doc.fontSize(22).font('Helvetica-Bold').fillColor('#4f6bff').text('PIO E-market', { align: 'center' });
    doc.fontSize(10).font('Helvetica').fillColor('#6b6a7e').text('Curated Atelier', { align: 'center' });
    doc.moveDown(0.5);
    doc.strokeColor('#e0def0').lineWidth(1).moveTo(50, doc.y).lineTo(545, doc.y).stroke();
    doc.moveDown(0.5);
    doc.fontSize(18).font('Helvetica-Bold').fillColor('#2a2b3a').text('INVOICE', { align: 'center' });
    doc.moveDown(0.5);
    
    const orderInfoX = 350;
    let currentY = doc.y;
    
    doc.fontSize(9).font('Helvetica').fillColor('#6b6a7e');
    doc.text(`Invoice Number:`, orderInfoX, currentY);
    doc.font('Helvetica-Bold').fillColor('#2a2b3a').text(`${order.order_number}`, orderInfoX + 100, currentY);
    currentY += 15;
    doc.font('Helvetica').fillColor('#6b6a7e').text(`Date:`, orderInfoX, currentY);
    doc.font('Helvetica-Bold').fillColor('#2a2b3a').text(`${new Date(order.created_at).toLocaleDateString()}`, orderInfoX + 100, currentY);
    currentY += 15;
    doc.font('Helvetica').fillColor('#6b6a7e').text(`Payment Status:`, orderInfoX, currentY);
    
    const paymentStatusText = order.payment_status === 'paid' ? 'Paid ✓' : 'Pending';
    const paymentStatusColor = order.payment_status === 'paid' ? '#10b981' : '#f59e0b';
    doc.font('Helvetica-Bold').fillColor(paymentStatusColor).text(paymentStatusText, orderInfoX + 100, currentY);
    doc.moveDown(2);
    
    doc.fontSize(12).font('Helvetica-Bold').fillColor('#2a2b3a').text('Bill To:');
    doc.moveDown(0.3);
    doc.fontSize(10).font('Helvetica').fillColor('#4a4b5e');
    doc.text(order.full_name || 'Customer');
    if (order.address_line1) doc.text(order.address_line1);
    if (order.city && order.state) doc.text(`${order.city}, ${order.state} ${order.postal_code || ''}`);
    if (order.phone) doc.text(`Phone: ${order.phone}`);
    doc.moveDown(1.5);
    
    const tableTop = doc.y;
    const col1 = 50, col2 = 300, col3 = 400, col4 = 480;
    
    doc.fontSize(10).font('Helvetica-Bold').fillColor('#2a2b3a');
    doc.text('Item', col1, tableTop);
    doc.text('Qty', col2, tableTop);
    doc.text('Unit Price', col3, tableTop);
    doc.text('Total', col4, tableTop);
    doc.moveTo(50, tableTop + 15).lineTo(545, tableTop + 15).stroke();
    
    let y = tableTop + 25;
    doc.font('Helvetica').fillColor('#4a4b5e');
    
    items.forEach((item, index) => {
        let productName = item.product_name;
        if (productName && productName.length > 35) productName = productName.substring(0, 32) + '...';
        doc.text(productName || 'Product', col1, y);
        doc.text(item.quantity.toString(), col2, y);
        doc.text(formatNaira(parseFloat(item.unit_price)), col3, y);
        doc.text(formatNaira(parseFloat(item.total_price)), col4, y);
        y += 20;
        if (y > 700 && index < items.length - 1) {
            doc.addPage();
            y = 50;
            doc.fontSize(10).font('Helvetica-Bold').fillColor('#2a2b3a');
            doc.text('Item', col1, y);
            doc.text('Qty', col2, y);
            doc.text('Unit Price', col3, y);
            doc.text('Total', col4, y);
            doc.moveTo(50, y + 15).lineTo(545, y + 15).stroke();
            y += 25;
            doc.font('Helvetica').fillColor('#4a4b5e');
        }
    });
    
    const totalsY = Math.max(y + 20, 650);
    doc.fontSize(10);
    doc.font('Helvetica').fillColor('#6b6a7e').text('Subtotal:', 400, totalsY);
    doc.font('Helvetica-Bold').fillColor('#2a2b3a').text(formatNaira(parseFloat(order.subtotal)), 480, totalsY);
    
    const totalY = totalsY + 18;
    doc.moveTo(350, totalY - 5).lineTo(545, totalY - 5).stroke();
    doc.fontSize(14).font('Helvetica-Bold').fillColor('#4f6bff').text('Total:', 400, totalY);
    doc.fontSize(16).text(formatNaira(parseFloat(order.total_amount)), 460, totalY - 2);
    
    const footerY = doc.page.height - 70;
    doc.fontSize(8).font('Helvetica').fillColor('#a5a3b5');
    doc.text('Thank you for shopping with PIO E-market!', 50, footerY, { align: 'center', width: 500 });
    doc.text('For inquiries, contact support@piomarket.com', 50, footerY + 15, { align: 'center', width: 500 });
    
    doc.end();
}

// ============================================
// ANALYTICS APIs
// ============================================

router.get("/api/admin/analytics/monthly-sales", async (req, res) => {
    if (!req.session || !req.session.admin) return res.status(401).json({ success: false });
    
    try {
        const result = await req.db.query(`
            SELECT 
                TO_CHAR(created_at, 'Mon YYYY') as month,
                COUNT(*) as order_count,
                COALESCE(SUM(total_amount), 0) as total_sales
            FROM orders 
            WHERE created_at >= NOW() - INTERVAL '6 months'
            GROUP BY TO_CHAR(created_at, 'Mon YYYY'), DATE_TRUNC('month', created_at)
            ORDER BY MIN(created_at) ASC
        `);
        
        res.json({ success: true, data: result.rows });
    } catch (error) {
        console.error('Error loading monthly sales:', error);
        res.status(500).json({ success: false, data: [] });
    }
});

router.get("/api/admin/analytics/top-products", async (req, res) => {
    if (!req.session || !req.session.admin) return res.status(401).json({ success: false });
    
    try {
        const result = await req.db.query(`
            SELECT 
                p.id, p.name, p.price, p.image_url,
                COALESCE(SUM(oi.quantity), 0) as total_sold,
                COALESCE(SUM(oi.total_price), 0) as total_revenue
            FROM products p
            LEFT JOIN order_items oi ON p.id = oi.product_id
            GROUP BY p.id, p.name, p.price, p.image_url
            ORDER BY total_sold DESC
            LIMIT 10
        `);
        
        res.json({ success: true, products: result.rows });
    } catch (error) {
        console.error('Error loading top products:', error);
        res.status(500).json({ success: false, products: [] });
    }
});

router.get("/api/admin/analytics/sales-by-status", async (req, res) => {
    if (!req.session || !req.session.admin) return res.status(401).json({ success: false });
    
    try {
        const result = await req.db.query(`
            SELECT 
                status,
                COUNT(*) as count,
                COALESCE(SUM(total_amount), 0) as total
            FROM orders
            GROUP BY status
            ORDER BY count DESC
        `);
        
        res.json({ success: true, data: result.rows });
    } catch (error) {
        console.error('Error loading sales by status:', error);
        res.status(500).json({ success: false, data: [] });
    }
});

router.get("/api/admin/analytics/weekly-sales", async (req, res) => {
    if (!req.session || !req.session.admin) return res.status(401).json({ success: false });
    
    try {
        const result = await req.db.query(`
            SELECT 
                DATE(created_at) as date,
                COUNT(*) as order_count,
                COALESCE(SUM(total_amount), 0) as total_sales
            FROM orders 
            WHERE created_at >= NOW() - INTERVAL '7 days'
            GROUP BY DATE(created_at)
            ORDER BY date ASC
        `);
        
        const formattedResults = result.rows.map(row => ({
            ...row,
            date: new Date(row.date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
        }));
        
        res.json({ success: true, data: formattedResults });
    } catch (error) {
        console.error('Error loading weekly sales:', error);
        res.status(500).json({ success: false, data: [] });
    }
});

module.exports = router;