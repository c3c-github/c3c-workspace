const fs = require('fs');
const path = require('path');
require('dotenv').config();

// 1. Garante que a pasta de uploads existe antes de qualquer coisa
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
    try {
        fs.mkdirSync(uploadsDir);
        console.log('📁 Pasta uploads criada.');
    } catch (err) {
        console.error('❌ Erro ao criar pasta uploads:', err);
    }
}

// 2. Carrega a aplicação com log de erro
let app;
try {
    app = require('./src/app');
} catch (err) {
    console.error('❌ Erro crítico ao carregar a aplicação (src/app):', err);
    process.exit(1);
}

process.on('uncaughtException', (err) => {
    console.error('❌ Uncaught Exception:', err);
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
    process.exit(1);
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