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
const supportController = require('./controllers/supportController');
const serviceController = require('./controllers/serviceController');
const serviceIndicatorController = require('./controllers/serviceIndicatorController');
const utilityController = require('./controllers/utilityController');
const billingController = require('./controllers/billingController');

const requireAuth = (req, res, next) => {
    if (!req.session || !req.session.user) { return res.redirect('/'); }
    next();
};

const requireGroup = (groupCodes) => {
    return (req, res, next) => {
        const user = req.session.user;
        const codes = Array.isArray(groupCodes) ? groupCodes : [groupCodes];
        
        if (user && user.grupos && codes.some(code => user.grupos.includes(code))) { 
            next(); 
        } else { 
            res.status(403).render('negado', { mensagem: `Acesso restrito. Requer um dos grupos: ${codes.join(', ')}` }); 
        }
    };
};

router.get('/', authController.loginPage);
router.get('/health', (req, res) => res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() }));
router.get('/auth/login', authController.azureLogin);
router.get('/auth/callback', authController.azureCallback);
router.get('/logout', authController.logout);

// --- IMPERSONATION (LOGIN AS) ---
router.post('/auth/impersonate', requireAuth, requireGroup('LOGIN_AS'), authController.impersonateUser);
router.get('/auth/stop-impersonate', requireAuth, authController.stopImpersonation);
router.get('/api/admin/users', requireAuth, requireGroup('LOGIN_AS'), authController.getUsersForImpersonation);

router.get('/dashboard', requireAuth, dashboardController.renderHome);

// --- GESTÃO DE SERVIÇOS (NOVO MÓDULO) ---
router.get('/services', requireAuth, requireGroup('GESTOR_FINANCEIRO'), serviceController.renderServicesPage);
router.get('/services/indicators', requireAuth, requireGroup('GESTOR_FINANCEIRO'), serviceIndicatorController.renderIndicatorsPage);
router.get('/api/services/indicators/data', requireAuth, requireGroup('GESTOR_FINANCEIRO'), serviceIndicatorController.getIndicatorData);
router.get('/api/services', requireAuth, requireGroup('GESTOR_FINANCEIRO'), serviceController.getServices);
router.get('/api/services/:id', requireAuth, requireGroup('GESTOR_FINANCEIRO'), serviceController.getServiceDetails);
router.post('/api/services', requireAuth, requireGroup('GESTOR_FINANCEIRO'), serviceController.saveService);
router.post('/api/services/doc', requireAuth, requireGroup('GESTOR_FINANCEIRO'), upload.fields([{ name: 'files', maxCount: 1 }]), serviceController.uploadDocument);
router.delete('/api/services/doc/:docId', requireAuth, requireGroup('GESTOR_FINANCEIRO'), serviceController.deleteDocument);
router.get('/api/services/doc/:docId', requireAuth, requireGroup('GESTOR_FINANCEIRO'), serviceController.downloadDocument);
router.get('/api/services/sales/available', requireAuth, requireGroup('GESTOR_FINANCEIRO'), serviceController.getAvailableSales);
router.get('/api/services/sales/:saleId/installments', requireAuth, requireGroup('GESTOR_FINANCEIRO'), serviceController.getSaleInstallmentsPreview);
router.get('/api/services/:id/realized', requireAuth, requireGroup('GESTOR_FINANCEIRO'), serviceController.getServiceRealizedData);
router.delete('/api/services/allocations/:id', requireAuth, requireGroup('GESTOR_FINANCEIRO'), serviceController.deleteAllocation);
router.post('/api/services/sales', requireAuth, requireGroup('GESTOR_FINANCEIRO'), serviceController.saveSales);
router.delete('/api/services/sales/:id/:serviceId', requireAuth, requireGroup('GESTOR_FINANCEIRO'), serviceController.deleteSale);
router.delete('/api/services/commercial/:id', requireAuth, requireGroup('GESTOR_FINANCEIRO'), serviceController.deleteCommercialItem);

// --- APROVAÇÕES ---
router.get('/approvals', requireAuth, requireGroup('GESTOR'), (req, res) => { res.render('approvals', { user: req.session.user, page: 'approvals' }); });
router.get('/api/dashboard/metrics', requireAuth, apiController.getDashboardMetrics);
router.get('/api/dashboard/allocations', requireAuth, apiController.getMyAllocations);
router.get('/api/approvals/projects', requireAuth, requireGroup('GESTOR'), apiController.getProjects);
router.get('/api/approvals/:serviceId/resources', requireAuth, requireGroup('GESTOR'), apiController.getProjectResources);
router.get('/api/approvals/:serviceId/resources/:personId/activities', requireAuth, requireGroup('GESTOR'), apiController.getResourceActivities);
router.post('/api/approvals/action', requireAuth, requireGroup('GESTOR'), apiController.handleApprovalAction);

// --- TIMESHEET ---
router.get('/timesheet', requireAuth, timesheetController.renderTimesheetPage);
router.get('/api/periods', requireAuth, apiController.getPeriods); // ROTA UNIFICADA
router.get('/api/timesheet/calendar', requireAuth, timesheetController.getCalendarData);
router.get('/api/timesheet/day', requireAuth, timesheetController.getDayDetails);
router.post('/api/timesheet/entry', requireAuth, timesheetController.saveEntry);
router.delete('/api/timesheet/entry/:id', requireAuth, timesheetController.deleteEntry);
router.post('/api/timesheet/submit-day', requireAuth, timesheetController.submitDay);
router.post('/api/timesheet/submit-period', requireAuth, timesheetController.submitPeriod);
router.post('/api/timesheet/recall-period', requireAuth, timesheetController.recallPeriod);

// --- OPERAÇÕES ---
router.get('/operations', requireAuth, requireGroup('OPERACAO'), operationsController.renderOperations);
router.get('/api/ops/tickets', requireAuth, operationsController.getTickets); 
router.get('/api/ops/tickets/:id/details', requireAuth, operationsController.getTicketDetails);
router.get('/api/ops/tickets/:id/activities', requireAuth, operationsController.getTicketActivities);
router.get('/api/ops/limits', requireAuth, operationsController.getLimits);
router.get('/api/ops/create-options', requireAuth, operationsController.getCreateOptions);
router.get('/api/ops/account/:id/contacts', requireAuth, operationsController.getAccountContacts);
router.get('/api/ops/attachments/:id/download', requireAuth, operationsController.downloadAttachment);

router.post('/api/ops/tickets/create', requireAuth, operationsController.createTicket);
router.post('/api/ops/tickets/update', requireAuth, operationsController.updateTicket);
router.post('/api/ops/tickets/assign', requireAuth, operationsController.assignTicket);
router.post('/api/ops/tickets/return-queue', requireAuth, operationsController.returnToQueue);
router.post('/api/ops/tickets/reopen', requireAuth, operationsController.reopenTicket);
router.post('/api/ops/log', requireAuth, operationsController.saveLog);
router.post('/api/ops/log/delete', requireAuth, operationsController.deleteLog);
router.post('/api/ops/comment', requireAuth, operationsController.addComment);
router.post('/api/ops/contact/create', requireAuth, operationsController.createContact);
router.post('/api/ops/tickets/transfer', requireAuth, operationsController.transferTicket);
router.post('/api/ops/tickets/:id/upload', requireAuth, upload.array('files'), operationsController.uploadAttachments);

// --- GESTÃO DE SUPORTE (NOVO MÓDULO) ---
router.get('/support-management', requireAuth, requireGroup(['GESTAO_SUPORTE', 'DIRETOR', 'GESTOR']), supportController.renderPage);
router.get('/api/support-management/metrics', requireAuth, requireGroup(['GESTAO_SUPORTE', 'DIRETOR', 'GESTOR']), supportController.getGlobalMetrics);
router.get('/api/support-management/contracts', requireAuth, requireGroup(['GESTAO_SUPORTE', 'DIRETOR', 'GESTOR']), supportController.getContractsPerformance);
router.get('/api/support-management/team', requireAuth, requireGroup(['GESTAO_SUPORTE', 'DIRETOR', 'GESTOR']), supportController.getTeamPerformance);
router.get('/api/support-management/extract', requireAuth, requireGroup(['GESTAO_SUPORTE', 'DIRETOR', 'GESTOR']), supportController.getContractExtract);
router.get('/api/support-management/search-people', requireAuth, requireGroup(['GESTAO_SUPORTE', 'DIRETOR', 'GESTOR']), supportController.searchPeople);
router.get('/api/support-management/contract-cases', requireAuth, requireGroup(['GESTAO_SUPORTE', 'DIRETOR', 'GESTOR']), supportController.getContractCases);

// --- RH ---
router.get('/hr', requireAuth, requireGroup('ADMIN_RH'), hrController.renderHrDashboard);
router.get('/api/hr/employees', requireAuth, requireGroup('ADMIN_RH'), hrController.getHrEmployees);
router.get('/api/hr/employees/:personId/details', requireAuth, requireGroup('ADMIN_RH'), hrController.getEmployeeDetails);
router.post('/api/hr/action', requireAuth, requireGroup('ADMIN_RH'), hrController.handleHrAction);

// --- UTILIDADES ---
router.get('/utilities/signature', requireAuth, utilityController.renderSignaturePage);
router.post('/api/utility/upload-photo', requireAuth, upload.single('file'), utilityController.uploadPhoto);

// --- FATURAMENTO / NOTAS FISCAIS ---
router.get('/billing-portal', requireAuth, billingController.renderBillingPortal);
router.get('/api/billing/periods', requireAuth, billingController.getColaboradorPeriods);
router.post('/api/billing/upload', requireAuth, upload.single('file'), billingController.uploadNotaFiscal);
router.post('/api/billing/analyze', requireAuth, upload.single('file'), billingController.analyzeNotaFiscal);

// --- COCKPIT FINANCEIRO (V1) ---
router.get('/finance-dashboard', requireAuth, requireGroup('GESTOR_FINANCEIRO'), billingController.renderFinanceDashboard);
router.get('/api/finance/periods', requireAuth, requireGroup('GESTOR_FINANCEIRO'), billingController.getFinancePeriods);
router.get('/api/finance/counts', requireAuth, requireGroup('GESTOR_FINANCEIRO'), billingController.getFinanceCounts);
router.post('/api/finance/update-status', requireAuth, requireGroup('GESTOR_FINANCEIRO'), billingController.updateFinanceStatus);
router.post('/api/finance/reprove-nf', requireAuth, requireGroup('GESTOR_FINANCEIRO'), billingController.reproveNotaFiscal);
router.get('/api/billing/download/:docId', requireAuth, billingController.downloadDocument);

// --- MEDIÇÃO E FATURAMENTO (GESTOR) ---
const canAccessBilling = (req, res, next) => {
    const user = req.session.user;
    if (user && user.grupos && (user.grupos.includes('GESTOR') || user.grupos.includes('DIRETOR'))) {
        return next();
    }
    res.status(403).render('negado', { mensagem: 'Acesso restrito a Gestores e Diretores' });
};

router.get('/billing', requireAuth, canAccessBilling, billingController.renderBilling);
router.get('/billing/report-print', requireAuth, canAccessBilling, billingController.renderPrintReport);
router.get('/api/billing/grid', requireAuth, canAccessBilling, billingController.getBillingGrid);
router.get('/api/billing/service-logs', requireAuth, canAccessBilling, billingController.getServiceLogs);
router.post('/api/billing/save', requireAuth, canAccessBilling, billingController.saveAdjustments);

module.exports = router;