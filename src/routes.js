const express = require('express');
const router = express.Router();

const authController = require('./controllers/authController');
const dashboardController = require('./controllers/dashboardController');
const apiController = require('./controllers/apiController');
const hrController = require('./controllers/hrController');
const timesheetController = require('./controllers/timesheetController');

const requireAuth = (req, res, next) => {
    if (!req.session || !req.session.user) {
        return res.redirect('/');
    }
    next();
};

const requireGroup = (groupCode) => {
    return (req, res, next) => {
        const user = req.session.user;
        if (user && user.grupos && user.grupos.includes(groupCode)) {
            next();
        } else {
            res.status(403).render('negado', { mensagem: `Acesso negado. Requer perfil: ${groupCode}` });
        }
    };
};

router.get('/', authController.loginPage);
router.get('/auth/login', authController.azureLogin);
router.get('/auth/callback', authController.azureCallback);
router.get('/logout', authController.logout);

router.get('/dashboard', requireAuth, dashboardController.renderHome);
router.get('/approvals', requireAuth, requireGroup('GESTOR'), dashboardController.renderApprovals);
router.get('/hr', requireAuth, requireGroup('ADMIN_RH'), hrController.renderHrDashboard);
router.get('/timesheet', requireAuth, timesheetController.renderTimesheetPage);

router.get('/api/periods', requireAuth, apiController.getPeriods);
router.get('/api/dashboard/metrics', requireAuth, apiController.getDashboardMetrics);

router.get('/api/approvals/projects', requireAuth, requireGroup('GESTOR'), apiController.getProjects);
router.get('/api/approvals/:serviceId/resources', requireAuth, requireGroup('GESTOR'), apiController.getProjectResources);
router.get('/api/approvals/:serviceId/resources/:personId/activities', requireAuth, requireGroup('GESTOR'), apiController.getResourceActivities);
router.post('/api/approvals/action', requireAuth, requireGroup('GESTOR'), apiController.handleApprovalAction);

router.get('/api/hr/employees', requireAuth, requireGroup('ADMIN_RH'), hrController.getHrEmployees);
router.get('/api/hr/employees/:personId/details', requireAuth, requireGroup('ADMIN_RH'), hrController.getEmployeeDetails);
router.post('/api/hr/action', requireAuth, requireGroup('ADMIN_RH'), hrController.handleHrAction);

// TIMESHEET
router.get('/api/timesheet/periods', requireAuth, timesheetController.getUserPeriods);
router.get('/api/timesheet/calendar', requireAuth, timesheetController.getCalendarData);
router.get('/api/timesheet/day', requireAuth, timesheetController.getDayDetails);
router.post('/api/timesheet/entry', requireAuth, timesheetController.saveEntry);
router.delete('/api/timesheet/entry/:id', requireAuth, timesheetController.deleteEntry);
router.post('/api/timesheet/submit-day', requireAuth, timesheetController.submitDay);
// NOVA ROTA:
router.post('/api/timesheet/submit-period', requireAuth, timesheetController.submitPeriod);

module.exports = router;