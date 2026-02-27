require('dotenv').config();
const app = require('./src/app');

process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

const PORT = process.env.PORT || 3000;

console.log('--- Startup Log ---');
console.log('App type:', typeof app);
console.log('PORT:', PORT);
console.log('NODE_ENV:', process.env.NODE_ENV || 'development');

const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Servidor rodando na porta ${PORT}`);
    console.log('-------------------');
});

server.on('error', (e) => {
    console.error('❌ Server error:', e);
    if (e.code === 'EADDRINUSE') {
        console.error(`Port ${PORT} is already in use. Exiting...`);
        process.exit(1);
    }
});

server.on('close', () => {
    console.log('Server closed');
});