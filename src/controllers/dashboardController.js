const { getSfConnection } = require('../config/salesforce');

exports.renderHome = async (req, res) => {
    try {
        // Lógica do dashboard (mantida simples para evitar erros)
        res.render('dashboard', { user: req.session.user, page: 'dashboard' });
    } catch (e) {
        console.error(e);
        res.render('dashboard', { user: req.session.user, page: 'dashboard', error: e.message });
    }
};

// ESTA FUNÇÃO ESTAVA FALTANDO E CAUSAVA ERRO NA ROTA /approvals
exports.renderApprovals = async (req, res) => {
    res.render('approvals', { user: req.session.user, page: 'approvals' });
};