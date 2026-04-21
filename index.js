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

// Session store in database (required for Vercel)
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
// LOAD ROUTERS (Fixed duplicate issue)
// ===============================
console.log('📦 Loading application routes...');

// Load create.js routes (if it exists and is converted to PostgreSQL)
try {
    const mainRouter = require('./create.js');
    app.use('/', mainRouter);
    console.log('✅ Main router (create.js) loaded');
} catch (error) {
    console.log('⚠️ create.js not loaded:', error.message);
}

// Load cart.js routes
try {
    const cartRouter = require('./cart.js');
    app.use('/', cartRouter);
    console.log('✅ Cart router loaded');
} catch (error) {
    console.log('⚠️ cart.js not loaded:', error.message);
}

// Load login.js routes (if it exists separately)
try {
    const loginRouter = require('./login.js');
    app.use('/', loginRouter);
    console.log('✅ Login router loaded');
} catch (error) {
    console.log('⚠️ login.js not loaded (may be part of create.js)');
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

// Catch-all for other HTML pages
app.get(['/login', '/register', '/dashboard', '/cart', '/checkout', '/order-confirmation', '/product', '/orders', '/profile', '/wishlist', '/offers', '/support'], (req, res) => {
    const page = req.path.slice(1) + '.html';
    res.sendFile(path.join(__dirname, 'public', page));
});

// Add this AFTER your other routes, before the export
// ===============================
// 404 HANDLER
// ===============================
app.use((req, res) => {
    // Check if the requested file exists in public
    const possibleFile = path.join(__dirname, 'public', req.path);
    if (require('fs').existsSync(possibleFile) && require('fs').statSync(possibleFile).isFile()) {
        res.sendFile(possibleFile);
    } else {
        // Send 404 page or redirect to home
        res.status(404).sendFile(path.join(__dirname, 'public', '404.html'), err => {
            if (err) {
                res.status(404).send('Page not found');
            }
        });
    }
});

// ===============================
// EXPORT FOR VERCEL
// ===============================
if (process.env.VERCEL) {
    module.exports = app;
} else {
    // Local development
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => {
        console.log('\n' + '='.repeat(60));
        console.log('🛒 PIO E-MARKET STARTED!');
        console.log('='.repeat(60));
        console.log(`📍 http://localhost:${PORT}`);
        console.log(`🔑 Admin: admin@piomarket.com / admin123`);
        console.log('='.repeat(60));
    });
}