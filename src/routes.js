const express = require('express');
const router = express.Router();

// Importação dos Controllers
const authController = require('./controllers/authController');
const dashboardController = require('./controllers/dashboardController');
const apiController = require('./controllers/apiController');
const hrController = require('./controllers/hrController');
const timesheetController = require('./controllers/timesheetController');

// Middleware Básico de Autenticação
const requireAuth = (req, res, next) => {
    if (!req.session || !req.session.user) {
        return res.redirect('/');
    }
    next();
};

// [NOVO] Middleware de Grupo (Permissão)
const requireGroup = (groupCode) => {
    return (req, res, next) => {
        const user = req.session.user;
        // Verifica se usuário tem grupos e se o código exigido está lá
        if (user && user.grupos && user.grupos.includes(groupCode)) {
            next();
        } else {
            // Se não tiver permissão, renderiza página de erro ou redireciona
            res.status(403).render('negado', { mensagem: `Acesso negado. Requer perfil: ${groupCode}` });
        }
    };
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

// Dashboard Principal (Acesso Geral)
router.get('/dashboard', requireAuth, dashboardController.renderHome);

// Página de Aprovação (Apenas GESTOR)
router.get('/approvals', requireAuth, requireGroup('GESTOR'), dashboardController.renderApprovals);

// Página de RH (Apenas ADMIN_RH)
router.get('/hr', requireAuth, requireGroup('ADMIN_RH'), hrController.renderHrDashboard);

// Rota da Folha de Ponto (Timesheet)
router.get('/timesheet', requireAuth, timesheetController.renderTimesheetPage);

// =========================================
// 3. APIS - DADOS GERAIS
// =========================================
router.get('/api/periods', requireAuth, apiController.getPeriods);
router.get('/api/dashboard/metrics', requireAuth, apiController.getDashboardMetrics);

// =========================================
// 4. APIS - GESTOR (Protegidas)
// =========================================
router.get('/api/approvals/projects', requireAuth, requireGroup('GESTOR'), apiController.getProjects);
router.get('/api/approvals/:serviceId/resources', requireAuth, requireGroup('GESTOR'), apiController.getProjectResources);
router.get('/api/approvals/:serviceId/resources/:personId/activities', requireAuth, requireGroup('GESTOR'), apiController.getResourceActivities);
router.post('/api/approvals/action', requireAuth, requireGroup('GESTOR'), apiController.handleApprovalAction);

// =========================================
// 5. APIS - RH (Protegidas)
// =========================================
router.get('/api/hr/employees', requireAuth, requireGroup('ADMIN_RH'), hrController.getHrEmployees);
router.get('/api/hr/employees/:personId/details', requireAuth, requireGroup('ADMIN_RH'), hrController.getEmployeeDetails);
router.post('/api/hr/action', requireAuth, requireGroup('ADMIN_RH'), hrController.handleHrAction);


router.get('/api/timesheet/periods', requireAuth, timesheetController.getUserPeriods);
router.get('/api/timesheet/calendar', requireAuth, timesheetController.getCalendarData); // Grid Leve
router.get('/api/timesheet/day', requireAuth, timesheetController.getDayDetails);        // Detalhes Lazy
router.post('/api/timesheet/entry', requireAuth, timesheetController.saveEntry);
router.delete('/api/timesheet/entry/:id', requireAuth, timesheetController.deleteEntry);
module.exports = router;