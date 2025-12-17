const express = require('express');
const router = express.Router();

// Importação dos Controllers
const authController = require('./controllers/authController');
const dashboardController = require('./controllers/dashboardController');
const apiController = require('./controllers/apiController');
const hrController = require('./controllers/hrController');

// Middleware de Autenticação (Proteção de Rotas)
const requireAuth = (req, res, next) => {
    if (!req.session || !req.session.user) {
        return res.redirect('/');
    }
    next();
};

// =========================================
// 1. ROTAS DE AUTENTICAÇÃO
// =========================================
router.get('/', authController.loginPage);
router.get('/auth/login', authController.azureLogin);
router.get('/auth/callback', authController.azureCallback);
router.get('/logout', authController.logout);

// =========================================
// 2. ROTAS DE PÁGINAS (VIEWS)
// =========================================

// Página Inicial (Dashboard / KPIs)
router.get('/dashboard', requireAuth, dashboardController.renderHome);

// Página de Aprovação (Gestor)
router.get('/approvals', requireAuth, dashboardController.renderApprovals);

// Página de RH (Gestão de Ponto)
router.get('/hr', requireAuth, hrController.renderHrDashboard);

// =========================================
// 3. APIS - DADOS GERAIS & GESTOR
// =========================================

// Lista de Períodos (Dropdown)
router.get('/api/periods', requireAuth, apiController.getPeriods);

// KPIs do Dashboard Principal
router.get('/api/dashboard/metrics', requireAuth, apiController.getDashboardMetrics);

// Lista de Projetos para Aprovação
router.get('/api/approvals/projects', requireAuth, apiController.getProjects);

// Detalhes dos Recursos de um Projeto
router.get('/api/approvals/:serviceId/resources', requireAuth, apiController.getProjectResources);

// Drill-down: Atividades detalhadas de um Recurso
router.get('/api/approvals/:serviceId/resources/:personId/activities', requireAuth, apiController.getResourceActivities);

// Ação do Gestor (Aprovar/Reprovar)
router.post('/api/approvals/action', requireAuth, apiController.handleApprovalAction);

// =========================================
// 4. APIS - RECURSOS HUMANOS (RH)
// =========================================

// Tabela Principal do RH (Colaboradores, Status, KPIs)
router.get('/api/hr/employees', requireAuth, hrController.getHrEmployees);

// Detalhes do Modal do RH (Extrato diário)
router.get('/api/hr/employees/:personId/details', requireAuth, hrController.getEmployeeDetails);

// Ação do RH (Fechar Folha ou Reprovar)
router.post('/api/hr/action', requireAuth, hrController.handleHrAction);

module.exports = router;