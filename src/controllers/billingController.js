const { getSfConnection } = require('../config/salesforce');
const fs = require('fs');
const extractionService = require('../services/extractionService');
const microsoftGraphService = require('../services/microsoftGraphService');

/**
 * Helper para sincronizar NF com SharePoint
 */
async function syncNfToSharePoint(conn, periodId) {
    try {
        const periodQuery = `
            SELECT Name, DataInicio__c, DataFim__c, ContratoPessoa__r.Pessoa__r.Name, 
                   (SELECT Id, DocumentoId__c FROM NotasFiscais__r WHERE Tipo__c = 'Entrada' LIMIT 1)
            FROM Periodo__c WHERE Id = '${periodId}' LIMIT 1
        `;
        const resPeriod = await conn.query(periodQuery);
        const p = resPeriod.records[0];
        const nf = p.NotasFiscais__r?.records?.[0];
        if (!nf || !nf.DocumentoId__c) return;

        const cv = await conn.sobject('ContentVersion').find({ ContentDocumentId: nf.DocumentoId__c, IsLatest: true }).limit(1).execute();
        if (cv.length === 0) return;

        const fileData = await conn.sobject('ContentVersion').record(cv[0].Id).blob('VersionData');
        const chunks = []; for await (let chunk of fileData) { chunks.push(chunk); }
        const buffer = Buffer.concat(chunks);

        const periodBaseName = p.Name.split(' - ')[0];
        const fmt = (d) => d ? d.split('-').reverse().map((v, i) => i === 2 ? v.substring(2) : v).join('-') : '';
        const folderName = `${periodBaseName} - ${fmt(p.DataInicio__c)} - ${fmt(p.DataFim__c)}`;
        const fileName = `${p.ContratoPessoa__r.Pessoa__r.Name} - ${nf.Id}.${cv[0].FileExtension}`;

        const targetPath = await microsoftGraphService.ensureFolderExists(folderName);
        await microsoftGraphService.uploadFile(targetPath, fileName, buffer);
    } catch (e) { console.error(`[SharePoint] Error:`, e.message); }
}

exports.renderBillingPortal = (req, res) => res.render('billing_portal', { user: req.session.user, page: 'billing_portal' });

exports.getColaboradorPeriods = async (req, res) => {
    try {
        const conn = await getSfConnection();
        const query = `SELECT Id, Name, DataInicio__c, DataFim__c, Status__c, ValorTotalHoras__c, ValorTotalBeneficios__c, ValorTotalPeriodo__c FROM Periodo__c WHERE ContratoPessoa__r.Pessoa__c = '${req.session.user.id}' AND (Status__c IN ('Liberado para Nota Fiscal', 'Nota em Validação', 'Pronto para Pagamento', 'Pagamento Agendado', 'Finalizado/Pago')) ORDER BY DataInicio__c DESC`;
        const result = await conn.query(query);
        const periods = result.records;
        if (periods.length === 0) return res.json([]);
        const nfs = (await conn.query(`SELECT Id, Periodo__c, Status__c, Valor__c, DocumentoId__c, MotivoReprovacao__c FROM NotaFiscal__c WHERE Periodo__c IN ('${periods.map(p=>p.Id).join("','")}') AND Tipo__c = 'Entrada'`)).records;
        res.json(periods.map(p => {
            const nf = nfs.find(n => n.Periodo__c === p.Id);
            return { id: p.Id, name: p.Name, inicio: p.DataInicio__c, fim: p.DataFim__c, statusPeriodo: p.Status__c, valorHoras: p.ValorTotalHoras__c || 0, valorTotal: p.ValorTotalPeriodo__c || 0, hasNF: !!nf, nfStatus: nf?.Status__c, nfDocumentoId: nf?.DocumentoId__c, nfMotivo: nf?.MotivoReprovacao__c };
        }));
    } catch (e) { res.status(500).json({ error: e.message }); }
};

exports.uploadNotaFiscal = async (req, res) => {
    let tempPath = req.file?.path;
    try {
        if (!req.file) return res.status(400).json({ error: 'Erro' });
        const { periodId, valor, cnpjEmissor, cnpjReceptor, numeroNota, dataEmissao, nomeEmitente, preenchimento } = req.body;
        const conn = await getSfConnection();
        const cv = await conn.sobject('ContentVersion').create({ Title: `NF_${periodId}`, PathOnClient: req.file.originalname, VersionData: fs.readFileSync(tempPath).toString('base64'), IsMajorVersion: true });
        const docId = (await conn.sobject('ContentVersion').retrieve(cv.id)).ContentDocumentId;
        const nfExist = await conn.query(`SELECT Id FROM NotaFiscal__c WHERE Periodo__c = '${periodId}' AND Tipo__c = 'Entrada' LIMIT 1`);
        const payload = { Periodo__c: periodId, Tipo__c: 'Entrada', Status__c: 'Em Revisão', Valor__c: parseFloat(valor), CNPJ_Emissor__c: cnpjEmissor, CNPJ_Receptor__c: cnpjReceptor, NumeroNota__c: numeroNota, DataEmissao__c: dataEmissao, NomeEmitente__c: nomeEmitente, DocumentoId__c: docId, Preenchimento__c: preenchimento || 'Manual' };
        let nfId; if (nfExist.totalSize > 0) { nfId = nfExist.records[0].Id; payload.Id = nfId; await conn.sobject('NotaFiscal__c').update(payload); } else { nfId = (await conn.sobject('NotaFiscal__c').create(payload)).id; }
        await conn.sobject('ContentDocumentLink').create({ ContentDocumentId: docId, LinkedEntityId: nfId, ShareType: 'V', Visibility: 'AllUsers' });
        await conn.sobject('Periodo__c').update({ Id: periodId, Status__c: 'Nota em Validação' });
        if (tempPath) fs.unlinkSync(tempPath); res.json({ success: true });
    } catch (e) { if (tempPath) fs.unlinkSync(tempPath); res.status(500).json({ error: e.message }); }
};

exports.analyzeNotaFiscal = async (req, res) => {
    let tempPath = req.file?.path;
    try {
        const extraido = await extractionService.extrairDadosNota(fs.readFileSync(tempPath).toString('base64'), req.file.mimetype);
        if (tempPath) fs.unlinkSync(tempPath); res.json({ success: true, data: extraido });
    } catch (e) { if (tempPath) fs.unlinkSync(tempPath); res.status(500).json({ error: e.message }); }
};

/**
 * ============================================================================
 * MEDIÇÃO E FATURAMENTO (LÓGICA CONSOLIDADA)
 * ============================================================================
 */

exports.renderBilling = (req, res) => res.render('billing', { user: req.session.user, page: 'billing' });

exports.getBillingGrid = async (req, res) => {
    try {
        const { startDate, endDate } = req.query;
        const user = req.session.user;
        const isDiretor = user.grupos?.includes('DIRETOR');
        const conn = await getSfConnection();

        console.log(`[Billing] 🚀 Grid request by ${user.email} | Period: ${startDate} to ${endDate} | isDiretor: ${isDiretor}`);

        // 1. Buscar todos os serviços ativos no período
        const servicesRes = await conn.query(`
            SELECT Id, Name, Tipo__c, Conta__c, Conta__r.Name, DataInicio__c,
                   Contrato__r.HorasContratadas__c, Contrato__r.Valor__c, Contrato__r.StartDate,
                   RequerRelatorioFaturamento__c, SolicitaRelatorioHoras__c, Lider__r.Email__c
            FROM Servico__c
            WHERE (Tipo__c IN ('Suporte', 'Alocação') OR RequerRelatorioFaturamento__c = true OR SolicitaRelatorioHoras__c = true)
              AND DataInicio__c <= ${endDate}
              AND (DataFim__c >= ${startDate} OR DataFim__c = null)
        `).execute({ autoFetch: true, maxFetch: 50000 });
        
        const allServices = Array.isArray(servicesRes) ? servicesRes : (servicesRes.records || []);
        console.log(`[Billing] Found ${allServices.length} active services total.`);

        // 2. Agrupar Serviços por Cliente + Tipo
        const groups = {};
        allServices.forEach(s => {
            const key = `${s.Conta__c}_${s.Tipo__c}`;
            if (!groups[key]) {
                groups[key] = {
                    id: key, client: s.Conta__r.Name, clientId: s.Conta__c, type: s.Tipo__c,
                    serviceIds: [], latestContract: null, latestDate: null,
                    flags: { required: false, requested: false },
                    isLeaderInGroup: false,
                    serviceNames: []
                };
            }
            groups[key].serviceIds.push(s.Id);
            groups[key].serviceNames.push(s.Name);
            if (s.Lider__r?.Email__c === user.email) groups[key].isLeaderInGroup = true;
            if (s.RequerRelatorioFaturamento__c) groups[key].flags.required = true;
            if (s.SolicitaRelatorioHoras__c) groups[key].flags.requested = true;

            const sDate = s.DataInicio__c || s.Contrato__r?.StartDate;
            if (sDate && (!groups[key].latestDate || sDate > groups[key].latestDate)) {
                groups[key].latestDate = sDate;
                if (s.Contrato__r) groups[key].latestContract = s.Contrato__r;
            }
        });

        // 3. Filtrar grupos visíveis
        const visibleGroups = Object.values(groups).filter(g => isDiretor || g.isLeaderInGroup);
        console.log(`[Billing] Visible groups for user: ${visibleGroups.length}`);

        if (visibleGroups.length === 0) return res.json([]);

        // 4. Buscar Logs
        const allServiceIds = visibleGroups.flatMap(g => g.serviceIds);
        const logsRes = await conn.query(`
            SELECT Id, Servico__c, Horas__c, HorasExtras__c, HorasFaturar__c, Pessoa__r.Name
            FROM LancamentoHora__c
            WHERE Servico__c IN ('${allServiceIds.join("','")}')
              AND DiaPeriodo__r.Data__c >= ${startDate} AND DiaPeriodo__r.Data__c <= ${endDate}
              AND (Horas__c > 0 OR HorasExtras__c > 0)
        `).execute({ autoFetch: true, maxFetch: 100000 });
        const allLogs = Array.isArray(logsRes) ? logsRes : (logsRes.records || []);
        console.log(`[Billing] Loaded ${allLogs.length} logs for visible services.`);

        // 5. Montar Grade
        const gridData = visibleGroups.map(g => {
            const isSupport = g.type === 'Suporte';
            const groupLogs = allLogs.filter(l => g.serviceIds.includes(l.Servico__c));
            
            let totalLogged = 0, totalBillable = 0;
            const personHours = {};

            groupLogs.forEach(l => {
                const logged = (l.Horas__c || 0) + 2 * (l.HorasExtras__c || 0);
                const billable = (l.HorasFaturar__c !== null && l.HorasFaturar__c !== undefined) ? l.HorasFaturar__c : logged;
                totalLogged += logged;
                totalBillable += billable;

                const pName = l.Pessoa__r?.Name || 'N/A';
                personHours[pName] = (personHours[pName] || 0) + logged;
            });

            if (g.client.includes('Doremus')) {
                console.log(`[DEBUG DOREMUS] Group: ${g.id} | Services: ${g.serviceNames.join(', ')}`);
                console.log(`[DEBUG DOREMUS] Logs in group: ${groupLogs.length} | Total Logged: ${totalLogged}`);
                console.log(`[DEBUG DOREMUS] Breakdown:`, personHours);
            }

            let franchise = 0, avgRate = 0;
            if (isSupport && g.latestContract) {
                franchise = g.latestContract.HorasContratadas__c || 0;
                avgRate = franchise > 0 ? (g.latestContract.Valor__c || 0) / franchise : 0;
            }

            return {
                id: g.id, name: `${g.type} Consolidado`, client: g.client, clientId: g.clientId, type: g.type,
                franchise, logged: totalLogged, billable: totalBillable, avgRate,
                totalValue: isSupport ? (avgRate * Math.max(totalBillable, franchise)) : 0,
                status: 'open', flags: g.flags
            };
        });

        res.json(gridData);
    } catch (err) { 
        console.error('[Billing] Grid Error:', err);
        res.status(500).json({ error: err.message }); 
    }
};

exports.getServiceLogs = async (req, res) => {
    try {
        const { serviceId, startDate, endDate } = req.query;
        if (!serviceId) return res.json([]);
        const conn = await getSfConnection();

        let serviceIds = [serviceId];
        if (serviceId.includes('_')) {
            const [accId, type] = serviceId.split('_');
            const svcs = await conn.query(`SELECT Id FROM Servico__c WHERE Conta__c = '${accId}' AND Tipo__c = '${type}'`).execute();
            serviceIds = (Array.isArray(svcs) ? svcs : svcs.records).map(s => s.Id);
        }

        const logsRes = await conn.query(`
            SELECT Id, Servico__c, Horas__c, HorasExtras__c, HorasFaturar__c, DiaPeriodo__r.Data__c, Atividade__r.Name, Pessoa__r.Name
            FROM LancamentoHora__c
            WHERE Servico__c IN ('${serviceIds.join("','")}')
              AND DiaPeriodo__r.Data__c >= ${startDate} AND DiaPeriodo__r.Data__c <= ${endDate}
              AND (Horas__c > 0 OR HorasExtras__c > 0)
            ORDER BY DiaPeriodo__r.Data__c ASC
        `).execute({ autoFetch: true, maxFetch: 100000 });
        
        const logs = Array.isArray(logsRes) ? logsRes : (logsRes.records || []);
        res.json(logs.map(l => ({
            id: l.Id, date: l.DiaPeriodo__r?.Data__c, resourceName: l.Pessoa__r?.Name || 'N/A', desc: l.Atividade__r?.Name || 'Sem atividade',
            logged: (l.Horas__c || 0) + 2 * (l.HorasExtras__c || 0),
            billable: l.HorasFaturar__c !== null && l.HorasFaturar__c !== undefined ? l.HorasFaturar__c : ((l.Horas__c || 0) + 2 * (l.HorasExtras__c || 0)),
            rate: 0
        })));
    } catch (err) { res.json([]); }
};

exports.saveAdjustments = async (req, res) => {
    try {
        const { serviceId, logs, reportData } = req.body;
        const conn = await getSfConnection();
        await conn.sobject('LancamentoHora__c').update(logs.map(l => ({ Id: l.id, HorasFaturar__c: l.billable })));

        let targetServiceId = serviceId;
        if (serviceId.includes('_')) {
            const [accId, type] = serviceId.split('_');
            const svc = await conn.query(`SELECT Id FROM Servico__c WHERE Conta__c = '${accId}' AND Tipo__c = '${type}' LIMIT 1`);
            targetServiceId = svc.records[0]?.Id;
        }

        const reportId = (await conn.sobject('RelatorioHorasFaturar__c').create({
            Servico__c: targetServiceId, Cliente__c: reportData.clientId, FranquiaPrevista__c: reportData.franchise,
            HorasLancadas__c: reportData.logged, HorasAFaturar__c: reportData.billable, Status__c: 'Em Ajuste'
        })).id;

        await conn.sobject('RelatorioHorasFaturarLancamento__c').create(logs.map(l => ({ RelatorioHorasFaturar__c: reportId, LancamentoHora__c: l.id })));
        res.json({ success: true, reportId });
    } catch (err) { res.status(500).json({ error: err.message }); }
}

exports.renderPrintReport = async (req, res) => {
    try {
        const { serviceId, startDate, endDate, showValues } = req.query;
        const conn = await getSfConnection();
        let serviceIds = [serviceId], displaySvc;

        if (serviceId.includes('_')) {
            const [accId, type] = serviceId.split('_');
            const svcs = (await conn.query(`SELECT Id, Name, Tipo__c, Conta__r.Name, Contrato__r.HorasContratadas__c, Contrato__r.Valor__c, Contrato__r.StartDate FROM Servico__c WHERE Conta__c = '${accId}' AND Tipo__c = '${type}' ORDER BY DataInicio__c DESC`).execute());
            const list = Array.isArray(svcs) ? svcs : svcs.records;
            serviceIds = list.map(s => s.Id); displaySvc = list[0];
        } else {
            displaySvc = (await conn.query(`SELECT Id, Name, Tipo__c, Conta__r.Name, Contrato__r.HorasContratadas__c, Contrato__r.Valor__c FROM Servico__c WHERE Id = '${serviceId}' LIMIT 1`)).records[0];
        }

        const logsRes = await conn.query(`SELECT Id, Horas__c, HorasExtras__c, HorasFaturar__c, DiaPeriodo__r.Data__c, Atividade__r.Name, Pessoa__r.Name FROM LancamentoHora__c WHERE Servico__c IN ('${serviceIds.join("','")}') AND DiaPeriodo__r.Data__c >= ${startDate} AND DiaPeriodo__r.Data__c <= ${endDate} AND (Horas__c > 0 OR HorasExtras__c > 0) ORDER BY DiaPeriodo__r.Data__c ASC`).execute({ autoFetch: true, maxFetch: 100000 });
        const logs = (Array.isArray(logsRes) ? logsRes : (logsRes.records || [])).map(l => ({
            date: l.DiaPeriodo__r?.Data__c, resourceName: l.Pessoa__r?.Name || 'N/A', desc: l.Atividade__r?.Name || 'Sem atividade',
            logged: (l.Horas__c || 0) + 2 * (l.HorasExtras__c || 0),
            billable: l.HorasFaturar__c !== null && l.HorasFaturar__c !== undefined ? l.HorasFaturar__c : ((l.Horas__c || 0) + 2 * (l.HorasExtras__c || 0)),
            rate: 0
        }));
        res.render('billing_report_print', { svc: displaySvc, logs, period: { start: startDate, end: endDate }, showValues: showValues === 'true', user: req.session.user });
    } catch (err) { res.status(500).send(err.message); }
};

exports.renderFinanceDashboard = (req, res) => res.render('finance_dashboard', { user: req.session.user, page: 'finance' });
exports.getFinancePeriods = async (req, res) => {
    try {
        const { status, startDate, endDate } = req.query; const conn = await getSfConnection();
        let filters = [`ContratoPessoa__r.Pessoa__c != null`];
        if (status === 'Reprovados') { filters.push(`Status__c = 'Liberado para Nota Fiscal' AND Id IN (SELECT Periodo__c FROM NotaFiscal__c WHERE Status__c = 'Reprovada')`); }
        else if (status) filters.push(`Status__c = '${status}'`);
        else filters.push(`Status__c IN ('Nota em Validação', 'Pronto para Pagamento', 'Pagamento Agendado')`);
        if (startDate) filters.push(`DataInicio__c >= ${startDate}`);
        if (endDate) filters.push(`DataFim__c <= ${endDate}`);
        const result = await conn.query(`SELECT Id, Name, Status__c, ContratoPessoa__r.Pessoa__r.Name, ContratoPessoa__r.Pessoa__r.URL_Foto__c, ValorTotalHoras__c, ValorTotalBeneficios__c, ValorTotalPeriodo__c, (SELECT Id, Status__c, Valor__c, DocumentoId__c, CNPJ_Emissor__c, CNPJ_Receptor__c, NomeEmitente__c, NumeroNota__c, Preenchimento__c, DataEmissao__c FROM NotasFiscais__r WHERE Tipo__c = 'Entrada' LIMIT 1) FROM Periodo__c WHERE ${filters.join(' AND ')} ORDER BY ContratoPessoa__r.Pessoa__r.Name ASC LIMIT 500`);
        res.json(result.records.map(p => ({ id: p.Id, name: p.Name, status: p.Status__c, employeeName: p.ContratoPessoa__r?.Pessoa__r?.Name || 'N/A', employeePhoto: p.ContratoPessoa__r?.Pessoa__r?.URL_Foto__c, valueHoras: p.ValorTotalHoras__c || 0, valueBeneficios: p.ValorTotalBeneficios__c || 0, valueTotal: p.ValorTotalPeriodo__c || 0, nf: p.NotasFiscais__r?.records?.[0] ? { id: p.NotasFiscais__r.records[0].Id, status: p.NotasFiscais__r.records[0].Status__c, valor: p.NotasFiscais__r.records[0].Valor__c, docId: p.NotasFiscais__r.records[0].DocumentoId__c, cnpjEmissor: p.NotasFiscais__r.records[0].CNPJ_Emissor__c, cnpjReceptor: p.NotasFiscais__r.records[0].CNPJ_Receptor__c, nomeEmitente: p.NotasFiscais__r.records[0].NomeEmitente__c, numeroNota: p.NotasFiscais__r.records[0].NumeroNota__c, preenchimento: p.NotasFiscais__r.records[0].Preenchimento__c, dataEmissao: p.NotasFiscais__r.records[0].DataEmissao__c } : null })));
    } catch (e) { res.status(500).json({ error: e.message }); }
};
exports.getFinanceCounts = async (req, res) => {
    try {
        const conn = await getSfConnection();
        const r1 = await conn.query(`SELECT Status__c, count(Id) total FROM Periodo__c WHERE ContratoPessoa__r.Pessoa__c != null AND Status__c IN ('Nota em Validação', 'Pronto para Pagamento', 'Pagamento Agendado', 'Finalizado/Pago') GROUP BY Status__c`);
        const r2 = await conn.query(`SELECT count(Id) total FROM Periodo__c WHERE Status__c = 'Liberado para Nota Fiscal' AND Id IN (SELECT Periodo__c FROM NotaFiscal__c WHERE Status__c = 'Reprovada')`);
        const data = r1.records.map(r => ({ status: r.Status__c, total: r.total })); data.push({ status: 'Reprovados', total: r2.records[0].total }); res.json(data);
    } catch (e) { res.status(500).json({ error: e.message }); }
};
exports.reproveNotaFiscal = async (req, res) => {
    try {
        const { periodIds, motivo } = req.body; const conn = await getSfConnection();
        const nfs = await conn.query(`SELECT Id FROM NotaFiscal__c WHERE Periodo__c IN ('${periodIds.join("','")}') AND Status__c != 'Reprovada'`);
        if (nfs.records.length) await conn.sobject('NotaFiscal__c').update(nfs.records.map(nf => ({ Id: nf.Id, Status__c: 'Reprovada', MotivoReprovacao__c: motivo })));
        await conn.sobject('Periodo__c').update(periodIds.map(id => ({ Id: id, Status__c: 'Liberado para Nota Fiscal' })));
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
};
exports.downloadDocument = async (req, res) => {
    try {
        const conn = await getSfConnection(); const cv = await conn.sobject('ContentVersion').find({ ContentDocumentId: req.params.docId, IsLatest: true }).limit(1).execute();
        res.setHeader('Content-Disposition', `attachment; filename="${cv[0].Title}.${cv[0].FileExtension}"`); conn.sobject('ContentVersion').record(cv[0].Id).blob('VersionData').pipe(res);
    } catch (e) { res.status(500).send('Error'); }
};
exports.updateFinanceStatus = async (req, res) => {
    try {
        const { periodIds, newStatus } = req.body; const conn = await getSfConnection();
        let nfSt = newStatus === 'Pronto para Pagamento' ? 'Aprovada' : newStatus === 'Pagamento Agendado' ? 'Pagamento Agendado' : newStatus === 'Finalizado/Pago' ? 'Pago' : null;
        await conn.sobject('Periodo__c').update(periodIds.map(id => ({ Id: id, Status__c: newStatus })));
        if (nfSt) { const nfs = await conn.query(`SELECT Id FROM NotaFiscal__c WHERE Periodo__c IN ('${periodIds.join("','")}') AND Tipo__c = 'Entrada'`); if (nfs.records.length) await conn.sobject('NotaFiscal__c').update(nfs.records.map(nf => ({ Id: nf.Id, Status__c: nfSt }))); }
        if (newStatus === 'Finalizado/Pago') periodIds.forEach(id => syncNfToSharePoint(conn, id).catch(console.error));
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
};
