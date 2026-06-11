const express = require('express');
const app = express();

app.get('/api/services/:id', (req, res) => {
    res.send('Matched /api/services/:id with id = ' + req.params.id);
});

app.get('/api/services/sales/available', (req, res) => {
    res.send('Matched /api/services/sales/available');
});

app.get('/api/services/:id/realized', (req, res) => {
    res.send('Matched /api/services/:id/realized');
});

const req1 = { url: '/api/services/sales/available', method: 'GET' };
app._router.handle(req1, { send: console.log }, () => console.log('Next called'));
