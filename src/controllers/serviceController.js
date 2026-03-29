const fs = require('fs');
const { getSfConnection } = require('../config/salesforce');
const contaAzulService = require('../services/contaAzulService');

const formatDate = (d) => d ? new Date(d).toISOString().split('T')[0] : null;

const calculateMargin = (rev, cost) => {
    if (rev > 0) return parseFloat((((rev - (cost || 0)) / rev) * 100).toFixed(2));
    if (cost > 0) return -100;
    return 0;
};

exports.renderServicesPage = async (req, res) => {
    try {
        const conn = await getSfConnection();
        const query = `
            SELECT Id, Name, Conta__r.Name, Tipo__c, Status__c, DataInicio__c, DataFimOriginal__c, DataFim__c, 
                   ReceitaVendida__c, CustoVendido__c, MargemVendida__c, 
                   ReceitaPrevista__c, CustoPrevisto__c, MargemPrevista__c, 
                   ReceitaRealizada__c, CustoRealizado__c, MargemRealizada__c,
                   (SELECT Id FROM VendasVinculadas__r LIMIT 1),
                   (SELECT Id FROM LancamentosHoras__r LIMIT 1)
            FROM Servico__c 
            ORDER BY Name ASC
        `;
        const result = await conn.query(query);
        const services = result.records.map(s => {
            const rev = s.ReceitaRealizada__c || 0;
            const cost = s.CustoRealizado__c || 0;
            const margem = calculateMargin(rev, cost);

            return {
                id: s.Id, name: s.Name, client: s.Conta__r ? s.Conta__r.Name : '', type: s.Tipo__c, status: s.Status__c || 'Ativo',
                dataInicio: s.DataInicio__c, dataFimOriginal: s.DataFimOriginal__c, dataFim: s.DataFim__c,
                prop: { rev: s.ReceitaVendida__c || 0, margin: parseFloat((s.MargemVendida__c || 0).toFixed(2)) }, 
                act: { rev: rev, margin: margem }, 
                fcst: { rev: s.ReceitaPrevista__c || 0, cost: s.CustoPrevisto__c || 0, margin: parseFloat((s.MargemPrevista__c || 0).toFixed(2)) },
                health: {
                    hasSales: (s.VendasVinculadas__r && s.VendasVinculadas__r.totalSize > 0),
                    hasLogs: (s.LancamentosHoras__r && s.LancamentosHoras__r.totalSize > 0)
                }
            };
        });
        res.render('services', { user: req.session.user, page: 'services', services });
    } catch (e) { res.render('services', { user: req.session.user, page: 'services', services: [] }); }
};

exports.getServices = async (req, res) => {
    try {
        const { status } = req.query;
        let whereClause = "";
        if (status === 'active') whereClause = "WHERE Status__c = 'Ativo'";
        else if (status === 'inactive') whereClause = "WHERE Status__c = 'Inativo'";
        const conn = await getSfConnection();
        const query = `
            SELECT Id, Name, Conta__r.Name, Tipo__c, Status__c, DataInicio__c, DataFimOriginal__c, DataFim__c, 
                   ReceitaVendida__c, CustoVendido__c, MargemVendida__c, 
                   ReceitaPrevista__c, CustoPrevisto__c, MargemPrevista__c, 
                   ReceitaRealizada__c, CustoRealizado__c, MargemRealizada__c,
                   (SELECT Id FROM VendasVinculadas__r LIMIT 1),
                   (SELECT Id FROM LancamentosHoras__r LIMIT 1)
            FROM Servico__c ${whereClause} 
            ORDER BY Name ASC
        `;
        const result = await conn.query(query);
        res.json(result.records.map(s => ({
            id: s.Id, name: s.Name, client: s.Conta__r ? s.Conta__r.Name : '', type: s.Tipo__c, status: s.Status__c || 'Ativo',
            dataInicio: s.DataInicio__c, dataFimOriginal: s.DataFimOriginal__c, dataFim: s.DataFim__c,
            prop: { rev: s.ReceitaVendida__c || 0, margin: calculateMargin(s.ReceitaVendida__c, s.CustoVendido__c) }, 
            act: { rev: s.ReceitaRealizada__c || 0, margin: calculateMargin(s.ReceitaRealizada__c, s.CustoRealizado__c) }, 
            fcst: { rev: s.ReceitaPrevista__c || 0, margin: calculateMargin(s.ReceitaPrevista__c, s.CustoPrevisto__c) },
            health: {
                hasSales: s.VendasVinculadas__r ? s.VendasVinculadas__r.totalSize > 0 : false,
                hasLogs: s.LancamentosHoras__r ? s.LancamentosHoras__r.totalSize > 0 : false
            }
        })));
    } catch (e) { res.status(500).json({ error: e.message }); }
};

exports.getServiceDetails = async (req, res) => {
    const { id } = req.params;
    if (id === 'new') return res.json({ id: null, name: "", client: "", type: "Projeto", status: "Novo", commercial: [], execution: [], installments: [], documents: [], metadata: await getMetadata() });
    try {
        const conn = await getSfConnection();
        const [rSvc, rComm, rExec, rLinks, rSales] = await Promise.all([
            conn.query(`SELECT Id, Name, Conta__c, Conta__r.Name, IDContaAzul__c, Tipo__c, Status__c, Lider__c, Coordenador__c, LiderTecnico__c, DataInicio__c, DataFimOriginal__c, DataFim__c, ReceitaVendida__c, CustoVendido__c, MargemVendida__c, ReceitaPrevista__c, CustoPrevisto__c, MargemPrevista__c, ReceitaRealizada__c, CustoRealizado__c, MargemRealizada__c, RequerRelatorioFaturamento__c, SolicitaRelatorioHoras__c FROM Servico__c WHERE Id = '${id}'`),
            conn.query(`SELECT Id, Produto__c, TaxaVenda__c, CustoEstimado__c, DataInicio__c, DataFim__c, PercentualAlocacao__c, ReceitaTotal__c, CustoTotal__c, HorasTotais__c FROM AlocacaoPrevista__c WHERE Servico__c = '${id}'`),
            conn.query(`SELECT Id, Pessoa__c, Pessoa__r.Name, DataInicio__c, DataFimOriginal__c, Percentual__c, AlocacaoPrevista__c, TaxaVenda__c, CustoHr__c, Dias__c, HorasTotais__c, ReceitaTotal__c, CustoTotal__c, Margem__c FROM Alocacao__c WHERE Servico__c = '${id}'`),
            conn.query(`SELECT ContentDocumentId FROM ContentDocumentLink WHERE LinkedEntityId = '${id}'`),
            conn.query(`SELECT Venda__r.Id, Venda__r.IDContaAzul__c, Venda__r.Name, Venda__r.DataEmissao__c, Venda__r.ValorTotal__c, Venda__r.Status__c, ValorAlocado__c FROM VendaServico__c WHERE Servico__c = '${id}'`)
        ]);
        
        let rFin = { records: [] };
        try { rFin = await conn.query(`SELECT Id, Valor__c, DataVencimento__c, Competencia__c, Status__c, Descricao__c FROM ParcelaFinanceira__c WHERE Servico__c = '${id}' AND Competencia__c >= 2025-01-01`); } catch(err) { console.error("Erro busca parcelas:", err.message); }

        if (rSvc.totalSize === 0) return res.status(404).json({ message: "Not found" });
        const svc = rSvc.records[0];

        let documents = [];
        if (rLinks.totalSize > 0) {
            const docIds = rLinks.records.map(l => `'${l.ContentDocumentId}'`).join(',');
            const rDocs = await conn.query(`SELECT Id, ContentDocumentId, Title, FileExtension FROM ContentVersion WHERE ContentDocumentId IN (${docIds}) AND IsLatest = true`);
            documents = rDocs.records.map(d => ({ docId: d.ContentDocumentId, name: d.Title + (d.FileExtension ? '.' + d.FileExtension : ''), type: d.Title }));
        }

        const allocationIds = rExec.records.map(r => r.Id);
        const monthlyAllocData = {};
        if (allocationIds.length > 0) {
            const orcResults = await conn.query(`SELECT Alocacao__c, Competencia__c, ReceitaRealizada__c, CustoRealizado__c, HorasRealizadas__c FROM OrcamentoCompetencia__c WHERE Alocacao__c IN ('${allocationIds.join("','")}') AND Competencia__c >= 2025-01-01`);
            orcResults.records.forEach(orc => {
                if (!monthlyAllocData[orc.Alocacao__c]) monthlyAllocData[orc.Alocacao__c] = [];
                monthlyAllocData[orc.Alocacao__c].push({ month: orc.Competencia__c, revenue: orc.ReceitaRealizada__c || 0, cost: orc.CustoRealizado__c || 0, hours: orc.HorasRealizadas__c || 0 });
            });
        }

        const executionData = rExec.records.map(r => {
            const monthlyData = monthlyAllocData[r.Id] || [];
            return {
                id: r.Id, person: r.Pessoa__r ? r.Pessoa__r.Name : '', personId: r.Pessoa__c, start: formatDate(r.DataInicio__c), end: formatDate(r.DataFimOriginal__c), alloc: r.Percentual__c, commercialLinkId: r.AlocacaoPrevista__c, costReal: r.CustoHr__c, saleApplied: r.TaxaVenda__c,
                totalRealizedRevenue: monthlyData.reduce((sum, m) => sum + m.revenue, 0),
                totalRealizedCost: monthlyData.reduce((sum, m) => sum + m.cost, 0),
                totalRealizedHours: monthlyData.reduce((sum, m) => sum + m.hours, 0),
                monthlyRealized: monthlyData
            };
        });

        const totalExecutionRevenue = executionData.reduce((sum, r) => sum + r.totalRealizedRevenue, 0);
        const totalExecutionCost = executionData.reduce((sum, r) => sum + r.totalRealizedCost, 0);

        res.json({
            id: svc.Id, name: svc.Name, client: svc.Conta__r ? svc.Conta__r.Name : '', sf_account_id: svc.Conta__c, ca_client_id: svc.IDContaAzul__c,
            type: svc.Tipo__c, status: svc.Status__c, lead_project: svc.Lider__c, coordinator: svc.Coordenador__c, tech_lead: svc.LiderTecnico__c,
            dataInicio: svc.DataInicio__c, dataFimOriginal: svc.DataFimOriginal__c, dataFim: svc.DataFim__c, documents,
            reqReport: svc.RequerRelatorioFaturamento__c || false, solReport: svc.SolicitaRelatorioHoras__c || false,
            prop: { rev: svc.ReceitaVendida__c || 0, cost: svc.CustoVendido__c || 0, margin: calculateMargin(svc.ReceitaVendida__c, svc.CustoVendido__c) },
            fcst: { rev: svc.ReceitaPrevista__c || 0, cost: svc.CustoPrevisto__c || 0, margin: calculateMargin(svc.ReceitaPrevista__c, svc.CustoPrevisto__c) },
            act: { rev: svc.ReceitaRealizada__c || 0, cost: svc.CustoRealizado__c || 0, margin: calculateMargin(svc.ReceitaRealizada__c, svc.CustoRealizado__c) },
            commercial: rComm.records.map(r => ({ id: r.Id, productName: r.Produto__c, saleRate: r.TaxaVenda__c, costEst: r.CustoEstimado__c, start: formatDate(r.DataInicio__c), end: formatDate(r.DataFim__c), alloc: r.PercentualAlocacao__c, totalRev: r.ReceitaTotal__c, totalCost: r.CustoTotal__c, totalHours: r.HorasTotais__c })),
            execution: executionData,
            sales: rSales.records.map(s => {
                const v = s.Venda__r || {};
                return { 
                    id: v.Id || null, 
                    id_ca: v.IDContaAzul__c || null, 
                    number: (v.Name || 'S/N').replace('Venda ', ''), 
                    date: formatDate(v.DataEmissao__c), 
                    total: v.ValorTotal__c || 0, 
                    status: v.Status__c || null,
                    allocatedValue: s.ValorAlocado__c || v.ValorTotal__c
                };
            }),
            installments: rFin.records.map(r => ({ id: r.Id, desc: r.Descricao__c, date: r.DataVencimento__c ? formatDate(r.DataVencimento__c) : '', value: r.Valor__c, status: r.Status__c, month: r.Competencia__c ? r.Competencia__c.substring(0,7) : '' })),
            metadata: await getMetadata()
        });
    } catch (e) { res.status(500).json({ error: e.message }); }
};

exports.getServiceRealizedData = async (req, res) => {
    const { id } = req.params;
    try {
        const conn = await getSfConnection();
        
        // 1. Buscar Consolidados de Baseline e Alocação (OrcamentoCompetencia__c)
        const orcResults = await conn.query(`
            SELECT Competencia__c, ReceitaPrevista__c, CustoPrevisto__c, AlocacaoPrevista__c, Alocacao__c 
            FROM OrcamentoCompetencia__c 
            WHERE Servico__c = '${id}' AND Competencia__c >= 2025-01-01
            ORDER BY Competencia__c ASC
        `);
        
        const consolidated = {};
        
        orcResults.records.forEach(orc => {
            const comp = orc.Competencia__c;
            if (!consolidated[comp]) consolidated[comp] = { month: comp, baseline: { revenue: 0, cost: 0 }, forecast: { revenue: 0, cost: 0 }, realized: { revenue: 0, cost: 0, hours: 0 } };
            
            const data = consolidated[comp];
            
            // Dados de Baseline (Comercial)
            if (orc.AlocacaoPrevista__c) {
                data.baseline.revenue += orc.ReceitaPrevista__c || 0;
                data.baseline.cost += orc.CustoPrevisto__c || 0;
            }
            
            // Dados de Forecast (Alocação Planejada)
            if (orc.Alocacao__c) {
                data.forecast.revenue += orc.ReceitaPrevista__c || 0;
                data.forecast.cost += orc.CustoPrevisto__c || 0;
            }
        });

        // 2. Buscar Dados Reais diretamente dos Lançamentos de Horas
        const timeLogs = await conn.query(`
            SELECT 
                CALENDAR_MONTH(DiaPeriodo__r.Data__c) m, 
                CALENDAR_YEAR(DiaPeriodo__r.Data__c) y, 
                SUM(Horas__c) hrs, 
                SUM(ValorTotalLancamento__c) cost,
                SUM(ValorReceita__c) rev
            FROM LancamentoHora__c 
            WHERE Servico__c = '${id}' AND DiaPeriodo__r.Data__c >= 2025-01-01
            GROUP BY CALENDAR_YEAR(DiaPeriodo__r.Data__c), CALENDAR_MONTH(DiaPeriodo__r.Data__c)
            ORDER BY CALENDAR_YEAR(DiaPeriodo__r.Data__c) ASC, CALENDAR_MONTH(DiaPeriodo__r.Data__c) ASC
        `);

        timeLogs.records.forEach(log => {
            const comp = `${log.y}-${String(log.m).padStart(2, '0')}-01`;
            if (!consolidated[comp]) consolidated[comp] = { month: comp, baseline: { revenue: 0, cost: 0 }, forecast: { revenue: 0, cost: 0 }, realized: { revenue: 0, cost: 0, hours: 0 } };
            
            const data = consolidated[comp];
            data.realized.revenue = log.rev || 0;
            data.realized.cost = log.cost || 0;
            data.realized.hours = log.hrs || 0;
        });

        // 3. Buscar Detalhamento por Pessoa (Totalizado por Projeto)
        const personLogs = await conn.query(`
            SELECT Pessoa__r.Name personName, SUM(Horas__c) hrs, SUM(ValorTotalLancamento__c) cost, SUM(ValorReceita__c) rev
            FROM LancamentoHora__c 
            WHERE Servico__c = '${id}' AND DiaPeriodo__r.Data__c >= 2025-01-01
            GROUP BY Pessoa__r.Name
        `);

        res.json({ 
            success: true, 
            consolidated: Object.values(consolidated).sort((a,b) => a.month.localeCompare(b.month)), 
            timeLogs: personLogs.records.map(r => ({ 
                person: r.personName || 'Indefinido', 
                hours: r.hrs || 0, 
                cost: r.cost || 0, 
                revenue: r.rev || 0,
                margin: calculateMargin(r.rev || 0, r.cost || 0)
            })) 
        });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
};

exports.saveService = async (req, res) => {
    const data = req.body;
    if (!data.name || !data.sf_account_id || !data.start) return res.status(400).json({ success: false, message: "Campos obrigatórios ausentes." });
    try {
        const conn = await getSfConnection();
        let accountId = data.sf_account_id;
        if (!accountId.startsWith('001')) {
            const accRet = await conn.sobject('Account').create({ Name: accountId });
            if (accRet.success) accountId = accRet.id; else throw new Error("Acc create error");
        }
        const cleanId = (val) => (val && val.length >= 15) ? val : null;
        const cleanDate = (val) => (val && val.trim() !== "") ? val : null;
        const svcRecord = { Id: data.id || null, Name: data.name, Conta__c: accountId, IDContaAzul__c: data.ca_client_id, Tipo__c: data.type, DataInicio__c: cleanDate(data.start), DataFimOriginal__c: cleanDate(data.end_original), DataFim__c: cleanDate(data.end_real), Lider__c: cleanId(data.lead_project), Coordenador__c: cleanId(data.coordinator), LiderTecnico__c: cleanId(data.tech_lead), RequerRelatorioFaturamento__c: data.reqReport, SolicitaRelatorioHoras__c: data.solReport };
        let result = data.id ? await conn.sobject('Servico__c').update(svcRecord) : await conn.sobject('Servico__c').create(svcRecord);
        if (result.success) {
            const serviceId = result.id || data.id;
            if (data.docIds && data.docIds.length > 0) await conn.sobject('ContentDocumentLink').create(data.docIds.map(docId => ({ ContentDocumentId: docId, LinkedEntityId: serviceId, ShareType: 'V' })));
            let tRev = 0, tCost = 0; const commIdMap = {};
            if (data.commercial) {
                for (const item of data.commercial) {
                    const record = { Produto__c: item.productName, TaxaVenda__c: item.saleRate, CustoEstimado__c: item.costEst, DataInicio__c: cleanDate(item.start) || svcRecord.DataInicio__c, DataFim__c: cleanDate(item.end) || svcRecord.DataFimOriginal__c, PercentualAlocacao__c: item.alloc || 100, ReceitaTotal__c: item.totalRev, CustoTotal__c: item.totalCost, HorasTotais__c: item.totalHours };
                    tRev += (item.totalRev || 0); tCost += (item.totalCost || 0);
                    let ret;
                    if (item.id && !item.id.startsWith('new')) {
                        ret = await conn.sobject('AlocacaoPrevista__c').update({ ...record, Id: item.id });
                    } else {
                        ret = await conn.sobject('AlocacaoPrevista__c').create({ ...record, Servico__c: serviceId });
                    }
                    commIdMap[item.id] = ret.id || item.id;
                    if (item.monthlyData && item.monthlyData.length > 0) {
                        const exOrcs = await conn.query(`SELECT Id FROM OrcamentoCompetencia__c WHERE AlocacaoPrevista__c = '${commIdMap[item.id]}'`);
                        if (exOrcs.totalSize > 0) await conn.sobject('OrcamentoCompetencia__c').destroy(exOrcs.records.map(r => r.Id));
                        await conn.sobject('OrcamentoCompetencia__c').create(item.monthlyData.map(m => ({ 
                            AlocacaoPrevista__c: commIdMap[item.id], 
                            Servico__c: serviceId, 
                            Competencia__c: m.date, 
                            ReceitaPrevista__c: m.rev, 
                            CustoPrevisto__c: m.cost 
                        })));
                    }
                }
            }
            if (data.execution) {
                for (const item of data.execution) {
                    const record = { 
                        AlocacaoPrevista__c: commIdMap[item.commercialLinkId] || (item.commercialLinkId && !item.commercialLinkId.startsWith('new') ? item.commercialLinkId : null), 
                        DataInicio__c: cleanDate(item.start) || svcRecord.DataInicio__c, 
                        DataFimOriginal__c: cleanDate(item.end) || svcRecord.DataFimOriginal__c, 
                        Percentual__c: item.alloc || 100, 
                        TaxaVenda__c: item.saleApplied, 
                        CustoHr__c: item.costReal, 
                        ReceitaTotal__c: item.totalRealizedRevenue, 
                        CustoTotal__c: item.totalRealizedCost, 
                        HorasTotais__c: item.totalRealizedHours 
                    };
                    let ret;
                    if (item.id && !item.id.startsWith('new')) {
                        ret = await conn.sobject('Alocacao__c').update({ ...record, Id: item.id });
                    } else {
                        ret = await conn.sobject('Alocacao__c').create({ ...record, Servico__c: serviceId, Pessoa__c: cleanId(item.personId) });
                    }
                    if (item.monthlyData && item.monthlyData.length > 0) {
                        const exOrcs = await conn.query(`SELECT Id FROM OrcamentoCompetencia__c WHERE Alocacao__c = '${ret.id || item.id}'`);
                        if (exOrcs.totalSize > 0) await conn.sobject('OrcamentoCompetencia__c').destroy(exOrcs.records.map(r => r.Id));
                        await conn.sobject('OrcamentoCompetencia__c').create(item.monthlyData.map(m => ({ 
                            Alocacao__c: ret.id || item.id, 
                            Servico__c: serviceId, 
                            Competencia__c: m.date, 
                            ReceitaPrevista__c: m.rev, 
                            CustoPrevisto__c: m.cost 
                        })));
                    }
                }
            }
            const allocTotals = await conn.query(`SELECT SUM(ReceitaTotal__c) rev, SUM(CustoTotal__c) cost FROM Alocacao__c WHERE Servico__c = '${serviceId}' AND DataFimOriginal__c >= 2025-01-01`);
            const tMargin = tRev > 0 ? ((tRev - tCost) / tRev) * 100 : (tCost > 0 ? -100 : 0);
            const pRev = allocTotals.records[0].rev || 0;
            const pCost = allocTotals.records[0].cost || 0;
            const pMargin = pRev > 0 ? ((pRev - pCost) / pRev) * 100 : (pCost > 0 ? -100 : 0);
            await conn.sobject('Servico__c').update({ Id: serviceId, ReceitaVendida__c: tRev, CustoVendido__c: tCost, MargemVendida__c: tMargin, ReceitaPrevista__c: pRev, CustoPrevisto__c: pCost, MargemPrevista__c: pMargin });
            res.json({ success: true, message: "Salvo!", id: serviceId });
        } else res.status(400).json({ success: false, details: result.errors });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
};

exports.saveSales = async (req, res) => {
    const { serviceId, sales, installments } = req.body; 
    if (!serviceId || !sales || !Array.isArray(sales)) return res.status(400).json({ success: false });
    try {
        const conn = await getSfConnection();
        const existingLinks = await conn.query(`SELECT Id, Venda__r.IDContaAzul__c FROM VendaServico__c WHERE Servico__c = '${serviceId}'`);
        const existingLinksMap = {};
        existingLinks.records.forEach(r => existingLinksMap[r.Venda__r.IDContaAzul__c] = r.Id);
        const saleToSfIdMap = {};
        for (const s of sales) {
            const salesInSf = await conn.query(`SELECT Id FROM VendaContaAzul__c WHERE IDContaAzul__c = '${s.id}' LIMIT 1`);
            let sfSaleId = salesInSf.totalSize > 0 ? salesInSf.records[0].Id : (await conn.sobject('VendaContaAzul__c').create({ IDContaAzul__c: s.id, Name: s.number ? String(s.number) : 'S/N', DataEmissao__c: s.emissionDate, ValorTotal__c: s.total, Status__c: s.status })).id;
            saleToSfIdMap[s.id] = sfSaleId;
            if (existingLinksMap[s.id]) await conn.sobject('VendaServico__c').update({ Id: existingLinksMap[s.id], ValorAlocado__c: s.allocatedValue || s.total });
            else await conn.sobject('VendaServico__c').create({ Servico__c: serviceId, Venda__c: sfSaleId, ValorAlocado__c: s.allocatedValue || s.total });
        }
        if (installments && installments.length > 0) {
            const currentInsts = await conn.query(`SELECT Id FROM ParcelaFinanceira__c WHERE Servico__c = '${serviceId}'`);
            if (currentInsts.totalSize > 0) await conn.sobject('ParcelaFinanceira__c').destroy(currentInsts.records.map(r => r.Id));
            await conn.sobject('ParcelaFinanceira__c').create(installments.map(i => ({ Servico__c: serviceId, VendaContaAzul__c: saleToSfIdMap[i.originSaleId] || null, Descricao__c: i.desc, Competencia__c: i.month ? `${i.month}-01` : null, DataVencimento__c: i.date, Valor__c: i.value, Status__c: i.status, IDContaAzul__c: i.id_ca })));
        }
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
};

exports.deleteSale = async (req, res) => {
    const { id, serviceId } = req.params;
    try {
        const conn = await getSfConnection();
        const links = await conn.query(`SELECT Id FROM VendaServico__c WHERE Venda__c = '${id}' AND Servico__c = '${serviceId}'`);
        if (links.totalSize > 0) await conn.sobject('VendaServico__c').destroy(links.records.map(r => r.Id));
        const installments = await conn.query(`SELECT Id FROM ParcelaFinanceira__c WHERE VendaContaAzul__c = '${id}' AND Servico__c = '${serviceId}'`);
        if (installments.totalSize > 0) {
            const distCheck = await conn.query(`SELECT Count(Id) total FROM DistribuicaoReceita__c WHERE ParcelaFinanceira__c IN (${installments.records.map(r => `'${r.Id}'`).join(',')})`);
            if (distCheck.records[0].total > 0) return res.status(400).json({ success: false, error: "Existem parcelas com receita já distribuída." });
            await conn.sobject('ParcelaFinanceira__c').destroy(installments.records.map(r => r.Id));
        }
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
};

exports.uploadDocument = async (req, res) => {
    const { serviceId, type } = req.body; const file = req.files?.files?.[0];
    if (!file || !serviceId) return res.status(400).json({ success: false, message: 'Arquivo ausente.' });
    try {
        const conn = await getSfConnection(); const service = await conn.sobject('Servico__c').retrieve(serviceId);
        const cvResult = await conn.sobject('ContentVersion').create({ Title: `${type} - ${service.Name}`.substring(0, 255), PathOnClient: file.originalname, VersionData: fs.readFileSync(file.path).toString('base64'), Origin: 'H', FirstPublishLocationId: serviceId });
        const docIdResult = await conn.query(`SELECT ContentDocumentId FROM ContentVersion WHERE Id = '${cvResult.id}'`);
        fs.unlinkSync(file.path); res.json({ success: true, docId: docIdResult.records[0].ContentDocumentId });
    } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

exports.deleteAllocation = async (req, res) => {
    const { id } = req.params;
    try {
        const conn = await getSfConnection();
        const checkLogs = await conn.query(`SELECT Count(Id) total FROM LancamentoHora__c WHERE Responsavel__r.Alocacao__c = '${id}'`);
        if (checkLogs.records[0].total > 0) return res.status(400).json({ success: false, error: "Existem horas lançadas." });
        const orcs = await conn.query(`SELECT Id FROM OrcamentoCompetencia__c WHERE Alocacao__c = '${id}'`);
        if (orcs.totalSize > 0) await conn.sobject('OrcamentoCompetencia__c').destroy(orcs.records.map(r => r.Id));
        await conn.sobject('Alocacao__c').destroy(id); res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
};

exports.deleteDocument = async (req, res) => { try { const conn = await getSfConnection(); await conn.sobject('ContentDocument').delete(req.params.docId); res.json({ success: true }); } catch (e) { res.status(500).json({ error: e.message }); } };
exports.downloadDocument = async (req, res) => {
    try {
        const conn = await getSfConnection(); const result = await conn.query(`SELECT Id, Title, FileExtension FROM ContentVersion WHERE ContentDocumentId = '${req.params.docId}' AND IsLatest = true LIMIT 1`);
        if (result.totalSize === 0) return res.status(404).send("Not found");
        res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(result.records[0].Title + '.' + result.records[0].FileExtension)}"`);
        conn.sobject('ContentVersion').record(result.records[0].Id).blob('VersionData').pipe(res);
    } catch (e) { res.status(500).send("Error"); }
};

exports.getAvailableSales = async (req, res) => { try { const { caClientId } = req.query; if (!caClientId) return res.json([]); res.json(await contaAzulService.getSalesByCustomer(caClientId)); } catch (e) { res.status(500).json({ error: "Erro busca vendas" }); } };
exports.getSaleInstallmentsPreview = async (req, res) => {
    try {
        const { saleId } = req.params; if (!saleId) return res.json([]);
        const installments = await contaAzulService.getSaleInstallments(saleId);
        res.json(installments.map(p => {
            let normalizedStatus = 'Pendente'; const sUpper = (p.status || '').toUpperCase();
            if (['QUITADO', 'PAGO', 'CONFIRMADO', 'APROVADO'].includes(sUpper)) normalizedStatus = 'Pago';
            else if (sUpper === 'VENCIDO') normalizedStatus = 'Atrasado';
            else if (sUpper === 'CANCELADO') normalizedStatus = 'Cancelado';
            return { desc: p.descricao, date: p.data_vencimento ? p.data_vencimento.split('T')[0] : null, value: p.valor_composicao ? p.valor_composicao.valor_bruto : (p.valor_pago || 0), status: normalizedStatus, month: p.data_vencimento ? p.data_vencimento.substring(0, 7) : null, id_ca: p.id };
        }));
    } catch (e) { res.status(500).json({ error: "Erro busca parcelas" }); }
};

exports.deleteCommercialItem = async (req, res) => {
    const { id } = req.params;
    try {
        const conn = await getSfConnection();
        const checkExec = await conn.query(`SELECT Count(Id) total FROM Alocacao__c WHERE AlocacaoPrevista__c = '${id}'`);
        if (checkExec.records[0].total > 0) return res.status(400).json({ success: false, error: "Vínculo com alocações ativo." });
        const orcResults = await conn.query(`SELECT Id FROM OrcamentoCompetencia__c WHERE AlocacaoPrevista__c = '${id}'`);
        if (orcResults.totalSize > 0) await conn.sobject('OrcamentoCompetencia__c').destroy(orcResults.records.map(r => r.Id));
        await conn.sobject('AlocacaoPrevista__c').destroy(id); res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
};

async function getMetadata() {
    const conn = await getSfConnection();
    let accounts = [], people = [], pricebooks = [], caClients = [], serviceTypes = [];
    try { accounts = (await conn.query("SELECT Id, Name FROM Account ORDER BY Name ASC")).records.map(a => ({ id: a.Id, name: a.Name })); } catch(e) {}
    try { people = (await conn.query("SELECT Id, Name, Custo__c FROM Pessoa__c ORDER BY Name ASC")).records.map(p => ({ id: p.Id, name: p.Name, costRate: p.Custo__c || 0 })); } catch(e) {}
    try {
        const describe = await conn.sobject('Servico__c').describe();
        const typeField = describe.fields.find(f => f.name === 'Tipo__c');
        if (typeField && typeField.picklistValues) serviceTypes = typeField.picklistValues.filter(v => v.active).map(v => ({ label: v.label, value: v.value }));
    } catch(e) {}
    try {
        const pb = await conn.query("SELECT Id, Name FROM Pricebook2 WHERE IsActive = true ORDER BY Name ASC");
        const pbe = await conn.query("SELECT Id, Pricebook2Id, Product2.Name, UnitPrice, Custo__c FROM PricebookEntry WHERE IsActive = true AND Pricebook2.IsActive = true");
        const map = {}; pbe.records.forEach(p => { if(!map[p.Pricebook2Id]) map[p.Pricebook2Id] = []; map[p.Pricebook2Id].push({ name: p.Product2.Name, price: p.UnitPrice || 0, cost: p.Custo__c || 0 }); });
        pricebooks = pb.records.map(b => ({ id: b.Id, name: b.Name, products: map[b.Id] || [] }));
    } catch(e) {}
    try { caClients = await contaAzulService.searchCustomers(''); } catch(e) {}
    return { pricebooks, salesforceAccounts: accounts, contaAzulClients: caClients, people, serviceTypes };
}
