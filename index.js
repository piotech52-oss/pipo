const express = require('express');
const session = require('express-session');
const path = require('path');
const { Pool } = require('pg');
const pgSession = require('connect-pg-simple')(session);
require('dotenv').config();

const app = express();

// Database connection
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
});

// Test database connection
pool.connect((err, client, release) => {
    if (err) {
        console.error('❌ Database connection failed:', err.message);
    } else {
        console.log('✅ Connected to Supabase PostgreSQL');
        release();
    }
});

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Session store in database
app.use(session({
    store: new pgSession({
        pool: pool,
        tableName: 'session',
        createTableIfMissing: true,
    }),
    secret: process.env.SESSION_SECRET || 'pio-market-secret-2024',
    resave: false,
    saveUninitialized: false,
    cookie: { 
        secure: process.env.NODE_ENV === 'production', 
        maxAge: 24 * 60 * 60 * 1000,
        sameSite: 'lax'
    }
}));

// Make database available to all routes
app.use((req, res, next) => {
    req.db = pool;
    next();
});
app.set('db', pool);

// ===============================
// LOAD ROUTERS
// ===============================
console.log('📦 Loading application routes...');

// Load auth routes (login/register)
try {
    const authRouter = require('./auth.js');
    app.use('/', authRouter);
    console.log('✅ Auth router loaded');
} catch (error) {
    console.log('⚠️ auth.js not loaded:', error.message);
}

// Load cart routes
try {
    const cartRouter = require('./cart.js');
    app.use('/', cartRouter);
    console.log('✅ Cart router loaded');
} catch (error) {
    console.log('⚠️ cart.js not loaded:', error.message);
}

// ===============================
// API ROUTES (Fallback/Health)
// ===============================
app.get('/api/health', async (req, res) => {
    try {
        const result = await pool.query('SELECT NOW() as time');
        res.json({ 
            success: true, 
            message: 'API running', 
            server_time: result.rows[0].time,
            database: 'PostgreSQL'
        });
    } catch (error) {
        res.status(500).json({ 
            success: false, 
            message: error.message 
        });
    }
});

app.get('/api/test', (req, res) => {
    res.json({ success: true, message: 'API test working' });
});

// ===============================
// SERVE HTML PAGES
// ===============================
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/register', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'register.html'));
});

app.get('/dashboard', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

app.get('/cart', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'cart.html'));
});

app.get('/checkout', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'checkout.html'));
});

app.get('/order-confirmation', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'order-confirmation.html'));
});

app.get('/product', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'product.html'));
});

app.get('/orders', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'orders.html'));
});

app.get('/profile', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'profile.html'));
});

app.get('/wishlist', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'wishlist.html'));
});

app.get('/offers', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'offers.html'));
});

app.get('/support', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'support.html'));
});

// ===============================
// 404 HANDLER
// ===============================
app.use((req, res) => {
    res.status(404).sendFile(path.join(__dirname, 'public', '404.html'), (err) => {
        if (err) {
            res.status(404).send('Page not found');
        }
    });
});

// ===============================
// EXPORT FOR VERCEL
// ===============================
if (process.env.VERCEL) {
    module.exports = app;
} else {
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => {
        console.log(`\n🛒 PIO E-MARKET STARTED!`);
        console.log(`📍 http://localhost:${PORT}`);
    });
}
