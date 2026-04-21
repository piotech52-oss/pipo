const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');

// Middleware
router.use(express.urlencoded({ extended: true }));
router.use(express.json());

// Make sure database is available
router.use((req, res, next) => {
    if (!req.db) {
        req.db = req.app.get('db');
    }
    next();
});

// ============================================
// HELPER FUNCTIONS
// ============================================

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

// ============================================
// CREATE USERS TABLE (PostgreSQL version)
// ============================================
async function createUserTable(db) {
    const userTable = `
        CREATE TABLE IF NOT EXISTS users (
            id SERIAL PRIMARY KEY,
            email VARCHAR(255) UNIQUE NOT NULL,
            password_hash VARCHAR(255) NOT NULL,
            full_name VARCHAR(100) NOT NULL,
            phone VARCHAR(20),
            is_verified BOOLEAN DEFAULT FALSE,
            role VARCHAR(20) DEFAULT 'customer',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            last_login TIMESTAMP NULL
        );
        
        CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
    `;
    
    try {
        await db.query(userTable);
        console.log('✅ Users table ready (PostgreSQL)');
    } catch (err) {
        console.error('❌ Error creating users table:', err.message);
    }
}

// ============================================
// GET ROUTES - Serve HTML Pages
// ============================================

router.get("/login", (req, res) => {
    res.sendFile("indx.html", { root: "public" });
});

router.get("/register", (req, res) => {
    res.sendFile("register.html", { root: "public" });
});

router.get("/", (req, res) => {
    res.sendFile("login.html", { root: "public" });
});

router.get("/dashboard", (req, res) => {
    if (req.session.user) {
        res.sendFile("dashboard.html", { root: "public" });
    } else {
        res.redirect("/login");
    }
});

// ============================================
// API ROUTE - LOGIN (PostgreSQL version)
// ============================================
router.post("/api/login", async (req, res) => {
    const { email, password } = req.body;
    const db = req.db;
    
    console.log("📝 Login attempt:", { email });
    
    if (!email || !password) {
        return res.status(400).json({ 
            success: false, 
            message: 'Email and password are required' 
        });
    }
    
    if (!isValidEmail(email)) {
        return res.status(400).json({ 
            success: false, 
            message: 'Please enter a valid email address' 
        });
    }
    
    const sanitizedEmail = sanitizeInput(email);
    
    try {
        const result = await db.query('SELECT * FROM users WHERE email = $1', [sanitizedEmail]);
        
        if (result.rows.length === 0) {
            console.log('❌ User not found:', email);
            return res.status(401).json({ 
                success: false, 
                message: 'Invalid email or password' 
            });
        }
        
        const user = result.rows[0];
        const passwordMatch = await bcrypt.compare(password, user.password_hash);
        
        if (passwordMatch) {
            await db.query('UPDATE users SET last_login = NOW() WHERE id = $1', [user.id]);
            
            req.session.user = {
                id: user.id,
                email: user.email,
                full_name: user.full_name,
                role: user.role,
                phone: user.phone
            };
            
            console.log('✅ User logged in:', email);
            
            return res.json({ 
                success: true, 
                message: 'Login successful!',
                user: {
                    id: user.id,
                    email: user.email,
                    full_name: user.full_name,
                    role: user.role
                }
            });
        } else {
            console.log('❌ Invalid password for:', email);
            return res.status(401).json({ 
                success: false, 
                message: 'Invalid email or password' 
            });
        }
    } catch (error) {
        console.error('Database error:', error);
        return res.status(500).json({ 
            success: false, 
            message: 'Server error. Please try again.' 
        });
    }
});

// ============================================
// API ROUTE - REGISTRATION (PostgreSQL version)
// ============================================
router.post("/api/register", async (req, res) => {
    let { fullName, email, phone, countryCode, password, newsletter } = req.body;
    const db = req.db;
    
    fullName = sanitizeInput(fullName);
    email = sanitizeInput(email);
    phone = sanitizeInput(phone);
    countryCode = sanitizeInput(countryCode);
    
    console.log("📝 API Registration:", { fullName, email, phone, countryCode });
    
    if (!fullName || !email || !phone || !password) {
        return res.status(400).json({ 
            success: false, 
            message: 'All fields are required' 
        });
    }
    
    if (!isValidEmail(email)) {
        return res.status(400).json({ 
            success: false, 
            message: 'Please enter a valid email address' 
        });
    }
    
    if (password.length < 6) {
        return res.status(400).json({ 
            success: false, 
            message: 'Password must be at least 6 characters' 
        });
    }
    
    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        const fullPhone = `${countryCode} ${phone}`;
        
        // Check if user exists
        const checkResult = await db.query('SELECT id FROM users WHERE email = $1', [email]);
        
        if (checkResult.rows.length > 0) {
            return res.status(409).json({ 
                success: false, 
                message: 'Email already registered. Please login.' 
            });
        }
        
        // Insert new user
        await db.query(
            'INSERT INTO users (email, password_hash, full_name, phone, role) VALUES ($1, $2, $3, $4, $5)',
            [email, hashedPassword, fullName, fullPhone, 'customer']
        );
        
        console.log('✅ User saved:', email);
        res.status(201).json({ 
            success: true, 
            message: 'Account created successfully!' 
        });
        
    } catch (error) {
        console.error('Registration error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Server error' 
        });
    }
});

// ============================================
// API ROUTE - GET CURRENT USER
// ============================================
router.get("/api/me", (req, res) => {
    if (req.session.user) {
        res.json({ 
            success: true, 
            user: req.session.user 
        });
    } else {
        res.status(401).json({ 
            success: false, 
            message: 'Not logged in' 
        });
    }
});

// ============================================
// API ROUTE - LOGOUT
// ============================================
router.post("/api/logout", (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            return res.status(500).json({ 
                success: false, 
                message: 'Logout failed' 
            });
        }
        res.json({ 
            success: true, 
            message: 'Logged out successfully' 
        });
    });
});

// ============================================
// API ROUTE - CHECK EMAIL EXISTS
// ============================================
router.get("/api/check-email/:email", async (req, res) => {
    const email = sanitizeInput(req.params.email);
    const db = req.db;
    
    try {
        const result = await db.query('SELECT id FROM users WHERE email = $1', [email]);
        res.json({ exists: result.rows.length > 0 });
    } catch (error) {
        res.status(500).json({ exists: false, error: true });
    }
});

// Initialize table when router is loaded
router.use(async (req, res, next) => {
    if (req.db && !router.tableCreated) {
        await createUserTable(req.db);
        router.tableCreated = true;
    }
    next();
});

module.exports = router;