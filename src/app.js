const express = require('express');
const session = require('cookie-session');
const path = require('path');
const routes = require('./routes');

const app = express();

// Configurações de View
app.set('view engine', 'ejs');
// Ajustamos para buscar a pasta views na raiz do projeto (um nível acima de src)
app.set('views', path.join(__dirname, '../views'));

// Middlewares Globais
app.use(express.static(path.join(__dirname, '../public'))); 
app.use(express.json());

// Sessão
app.use(session({
    name: 'session',
    keys: [process.env.SESSION_SECRET || 'force_logout_secret_v2_2026'],
    maxAge: 24 * 60 * 60 * 1000 // 24 horas
}));

// Rotas
app.use('/', routes);

module.exports = app;