require('dotenv').config();
const app = require('./src/app');

process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

const PORT = process.env.PORT || 3000;

console.log('App type:', typeof app);
console.log('PORT:', PORT);

const server = app.listen(PORT, () => {
    console.log(`🚀 Servidor rodando na porta ${PORT}`);
    console.log(`📂 Ambiente: ${process.env.NODE_ENV || 'development'}`);
});

server.on('error', (e) => {
    console.error('Server error:', e);
});

server.on('close', () => {
    console.log('Server closed');
});