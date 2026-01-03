const express = require('express');
const router = express.Router();
const multer = require('multer');
const upload = multer({ dest: 'uploads/' });

const authController = require('./controllers/authController');
const dashboardController = require('./controllers/dashboardController');
const apiController = require('./controllers/apiController');
const hrController = require('./controllers/hrController');
const timesheetController = require('./controllers/timesheetController');
const operationsController = require('./controllers/operationsController'); 

const requireAuth = (req, res, next) => {
    if (!req.session || !req.session.user) { return res.redirect('/'); }
    next();
};

const requireGroup = (groupCode) => {
    return (req, res, next) => {
        const user = req.session.user;
        if (user && user.grupos && user.grupos.includes(groupCode)) { next(); } 
        else { res.status(403).render('negado', { mensagem: `Requer: ${groupCode}` }); }
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

// --- OPERAÇÕES ---
router.get('/operations', requireAuth, requireGroup('OPERACAO'), operationsController.renderOperations);
router.get('/api/ops/tickets', requireAuth, operationsController.getTickets); 
router.get('/api/ops/tickets/:id/details', requireAuth, operationsController.getTicketDetails);
router.get('/api/ops/tickets/:id/activities', requireAuth, operationsController.getTicketActivities);
router.get('/api/ops/limits', requireAuth, operationsController.getLimits);
router.get('/api/ops/create-options', requireAuth, operationsController.getCreateOptions);
router.get('/api/ops/account/:id/contacts', requireAuth, operationsController.getAccountContacts);

router.post('/api/ops/tickets/create', requireAuth, operationsController.createTicket);
router.post('/api/ops/tickets/update', requireAuth, operationsController.updateTicket);
router.post('/api/ops/tickets/assign', requireAuth, operationsController.assignTicket);
router.post('/api/ops/tickets/return-queue', requireAuth, operationsController.returnToQueue);
router.post('/api/ops/tickets/reopen', requireAuth, operationsController.reopenTicket); // NOVA
router.post('/api/ops/log', requireAuth, operationsController.saveLog);
router.post('/api/ops/log/delete', requireAuth, operationsController.deleteLog);
router.post('/api/ops/comment', requireAuth, operationsController.addComment);
router.post('/api/ops/contact/create', requireAuth, operationsController.createContact);
router.post('/api/ops/tickets/transfer', requireAuth, operationsController.transferTicket);
router.post('/api/ops/tickets/:id/upload', requireAuth, upload.array('files'), operationsController.uploadAttachments);
router.get('/api/ops/attachments/:id/download', requireAuth, operationsController.downloadAttachment);

// --- GERAIS ---
router.get('/api/periods', requireAuth, apiController.getPeriods);
router.get('/api/dashboard/metrics', requireAuth, apiController.getDashboardMetrics);
router.get('/api/approvals/projects', requireAuth, requireGroup('GESTOR'), apiController.getProjects);
router.get('/api/approvals/:serviceId/resources', requireAuth, requireGroup('GESTOR'), apiController.getProjectResources);
router.get('/api/approvals/:serviceId/resources/:personId/activities', requireAuth, requireGroup('GESTOR'), apiController.getResourceActivities);
router.post('/api/approvals/action', requireAuth, requireGroup('GESTOR'), apiController.handleApprovalAction);
router.get('/api/hr/employees', requireAuth, requireGroup('ADMIN_RH'), hrController.getHrEmployees);
router.get('/api/hr/employees/:personId/details', requireAuth, requireGroup('ADMIN_RH'), hrController.getEmployeeDetails);
router.post('/api/hr/action', requireAuth, requireGroup('ADMIN_RH'), hrController.handleHrAction);
router.get('/api/timesheet/periods', requireAuth, timesheetController.getUserPeriods);
router.get('/api/timesheet/calendar', requireAuth, timesheetController.getCalendarData);
router.get('/api/timesheet/day', requireAuth, timesheetController.getDayDetails);
router.post('/api/timesheet/entry', requireAuth, timesheetController.saveEntry);
router.delete('/api/timesheet/entry/:id', requireAuth, timesheetController.deleteEntry);
router.post('/api/timesheet/submit-day', requireAuth, timesheetController.submitDay);
router.post('/api/timesheet/submit-period', requireAuth, timesheetController.submitPeriod);

module.exports = router;