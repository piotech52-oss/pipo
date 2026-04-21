const express = require('express');
const path = require('path');

const app = express();

// Simple middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Health check
app.get('/api/health', (req, res) => {
    res.json({ 
        success: true, 
        message: 'PIO E-market is running on Vercel!',
        timestamp: new Date().toISOString()
    });
});

app.get('/api/test', (req, res) => {
    res.json({ success: true, message: 'API test working' });
});

// Serve HTML
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Export for Vercel
module.exports = app;
