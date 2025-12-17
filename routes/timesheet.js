const express = require('express');
const router = express.Router();
// const { getSfConnection } = require('../services/salesforce'); // Importe quando for usar

// Rota da Página (View)
router.get('/', (req, res) => {
    // Aqui você buscaria os dados do Salesforce futuramente
    // Por enquanto, passamos dados mockados ou vazios
    const user = req.session.user;
    
    // Renderiza a página 'pages/timesheet' usando o layout base
    res.render('pages/timesheet', { 
        user,
        pageTitle: 'Gestão de Ponto',
        activeMenu: 'rh-ponto' // Para marcar o menu ativo
    });
});

// API para buscar dados (exemplo para o futuro Modal)
router.get('/api/data', async (req, res) => {
    // Lógica de busca de dados do ponto
    res.json({ message: "Dados do ponto aqui" });
});

module.exports = router;