const fs = require('fs');
const { getSfConnection } = require('../config/salesforce');
const contaAzulService = require('../services/contaAzulService');

const formatDate = (d) => d ? new Date(d).toISOString().split('T')[0] : null;

exports.renderServicesPage = async (req, res) => {
    try {
        const conn = await getSfConnection();
        const query = "SELECT Id, Name, Conta__r.Name, Tipo__c, Status__c, DataInicio__c, DataFimOriginal__c, DataFim__c, ReceitaVendida__c, CustoVendido__c, MargemVendida__c, ReceitaPrevista__c, CustoPrevisto__c, MargemPrevista__c, ReceitaRealizada__c, CustoRealizado__c, MargemRealizada__c FROM Servico__c WHERE Status__c = 'Ativo' ORDER BY Name ASC";
        const result = await conn.query(query);
        const services = result.records.map(s => {
            const rev = s.ReceitaRealizada__c || 0;
            const cost = s.CustoRealizado__c || 0;
            let margem = 0;
            
            if (rev > 0) {
                margem = ((rev - cost) / rev) * 100;
            } else if (cost > 0) {
                margem = -100; // Caso de Investimento
            }

            return {
                id: s.Id, name: s.Name, client: s.Conta__r ? s.Conta__r.Name : '', type: s.Tipo__c, status: s.Status__c || 'Ativo',
                dataInicio: s.DataInicio__c, dataFimOriginal: s.DataFimOriginal__c, dataFim: s.DataFim__c,
                prop: { rev: s.ReceitaVendida__c || 0, margin: parseFloat((s.MargemVendida__c || 0).toFixed(2)) }, 
                act: { rev: rev, cost: cost, margin: parseFloat(margem.toFixed(2)) }, 
                fcst: { rev: s.ReceitaPrevista__c || 0, cost: s.CustoPrevisto__c || 0, margin: parseFloat((s.MargemPrevista__c || 0).toFixed(2)) }
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
        
        // Query com subqueries para flags de saúde do serviço
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
            prop: { rev: s.ReceitaVendida__c || 0, margin: parseFloat((s.MargemVendida__c || 0).toFixed(2)) }, 
            act: { rev: s.ReceitaRealizada__c || 0, margin: parseFloat((s.MargemRealizada__c || 0).toFixed(2)) }, 
            fcst: { rev: s.ReceitaPrevista__c || 0, margin: parseFloat((s.MargemPrevista__c || 0).toFixed(2)) },
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
            conn.query(`SELECT Id, IDContaAzul__c, Name, DataEmissao__c, ValorTotal__c, Status__c FROM VendaContaAzul__c WHERE Servico__c = '${id}'`)
        ]);
        
        let rFin = { records: [] };
        try {
             rFin = await conn.query(`SELECT Id, Valor__c, DataVencimento__c, Competencia__c, Status__c, Descricao__c FROM ParcelaFinanceira__c WHERE Servico__c = '${id}'`);
        } catch(errFin) {
            console.error("Erro ao buscar parcelas:", errFin.message);
        }

        if (rSvc.totalSize === 0) return res.status(404).json({ message: "Not found" });
        const svc = rSvc.records[0];
        
        let margemReal = svc.MargemRealizada__c;
        if (svc.ReceitaRealizada__c > 0) {
            margemReal = ((svc.ReceitaRealizada__c - (svc.CustoRealizado__c || 0)) / svc.ReceitaRealizada__c) * 100;
        } else if (svc.ReceitaRealizada__c == 0) {
            margemReal = 0;
        }

        let documents = [];
        if (rLinks.totalSize > 0) {
            const docIds = rLinks.records.map(l => `'${l.ContentDocumentId}'`).join(',');
            const rDocs = await conn.query(`SELECT Id, ContentDocumentId, Title, FileExtension FROM ContentVersion WHERE ContentDocumentId IN (${docIds}) AND IsLatest = true`);
            documents = rDocs.records.map(d => ({ docId: d.ContentDocumentId, name: d.Title + (d.FileExtension ? '.' + d.FileExtension : ''), type: d.Title }));
        }

        const allocationIds = rExec.records.map(r => r.Id);
        const monthlyAllocData = {};
        if (allocationIds.length > 0) {
            const orcResults = await conn.query(`SELECT Alocacao__c, Competencia__c, ReceitaRealizada__c, CustoRealizado__c, HorasRealizadas__c FROM OrcamentoCompetencia__c WHERE Alocacao__c IN ('${allocationIds.join("','")}')`);
            orcResults.records.forEach(orc => {
                const allocId = orc.Alocacao__c;
                if (!monthlyAllocData[allocId]) monthlyAllocData[allocId] = [];
                monthlyAllocData[allocId].push({ 
                    month: orc.Competencia__c, 
                    revenue: orc.ReceitaRealizada__c || 0,
                    cost: orc.CustoRealizado__c || 0, 
                    hours: orc.HorasRealizadas__c || 0 
                });
            });
        }

        const executionData = rExec.records.map(r => {
            const monthlyData = monthlyAllocData[r.Id] || [];
            const totalRealizedRevenue = monthlyData.reduce((sum, m) => sum + m.revenue, 0);
            const totalRealizedCost = monthlyData.reduce((sum, m) => sum + m.cost, 0);
            const totalRealizedHours = monthlyData.reduce((sum, m) => sum + m.hours, 0);
            return {
                id: r.Id, person: r.Pessoa__r ? r.Pessoa__r.Name : '', personId: r.Pessoa__c, start: formatDate(r.DataInicio__c), end: formatDate(r.DataFimOriginal__c), alloc: r.Percentual__c, commercialLinkId: r.AlocacaoPrevista__c, costReal: r.CustoHr__c, saleApplied: r.TaxaVenda__c,
                totalRealizedRevenue: totalRealizedRevenue,
                totalRealizedCost: totalRealizedCost,
                totalRealizedHours: totalRealizedHours,
                monthlyRealized: monthlyData
            };
        });

        res.json({
            id: svc.Id, name: svc.Name, client: svc.Conta__r ? svc.Conta__r.Name : '', sf_account_id: svc.Conta__c, ca_client_id: svc.IDContaAzul__c,
            type: svc.Tipo__c, status: svc.Status__c, lead_project: svc.Lider__c, coordinator: svc.Coordenador__c, tech_lead: svc.LiderTecnico__c,
            dataInicio: svc.DataInicio__c, dataFimOriginal: svc.DataFimOriginal__c, dataFim: svc.DataFim__c, documents,
            reqReport: svc.RequerRelatorioFaturamento__c || false,
            solReport: svc.SolicitaRelatorioHoras__c || false,
            prop: { rev: svc.ReceitaVendida__c || 0, cost: svc.CustoVendido__c || 0, margin: parseFloat((svc.MargemVendida__c || 0).toFixed(2)) },
            fcst: { rev: svc.ReceitaPrevista__c || 0, cost: svc.CustoPrevisto__c || 0, margin: parseFloat((svc.MargemPrevista__c || 0).toFixed(2)) },
            act: { rev: svc.ReceitaRealizada__c || 0, cost: svc.CustoRealizado__c || 0, margin: parseFloat((margemReal || 0).toFixed(2)) },
            commercial: rComm.records.map(r => ({ id: r.Id, productName: r.Produto__c, saleRate: r.TaxaVenda__c, costEst: r.CustoEstimado__c, start: formatDate(r.DataInicio__c), end: formatDate(r.DataFim__c), alloc: r.PercentualAlocacao__c, totalRev: r.ReceitaTotal__c, totalCost: r.CustoTotal__c, totalHours: r.HorasTotais__c })),
            execution: executionData,
            sales: rSales.records.map(s => ({ 
                id: s.Venda__r ? s.Venda__r.Id : null, 
                id_ca: s.Venda__r ? s.Venda__r.IDContaAzul__c : null, 
                number: s.Venda__r ? s.Venda__r.Name : 'S/N', 
                date: s.Venda__r ? formatDate(s.Venda__r.DataEmissao__c) : null, 
                total: s.Venda__r ? s.Venda__r.ValorTotal__c : 0, 
                status: s.Venda__r ? s.Venda__r.Status__c : null,
                allocatedValue: s.ValorAlocado__c
            })),
            installments: rFin.records.map(r => ({ id: r.Id, desc: r.Descricao__c, date: r.DataVencimento__c ? formatDate(r.DataVencimento__c) : '', value: r.Valor__c, status: r.Status__c, month: r.Competencia__c ? r.Competencia__c.substring(0,7) : '' })),
            metadata: await getMetadata()
        });
    } catch (e) { res.status(500).json({ error: e.message }); }
};

exports.getServiceRealizedData = async (req, res) => {
    const { id } = req.params;
    try {
        const conn = await getSfConnection();
        
        // 1. Buscar todos os registros de OrcamentoCompetencia__c do serviço
        const orcResults = await conn.query(`
            SELECT Id, Alocacao__c, AlocacaoPrevista__c, Competencia__c, 
                   ReceitaPrevista__c, CustoPrevisto__c, 
                   ReceitaRealizada__c, CustoRealizado__c, HorasRealizadas__c
            FROM OrcamentoCompetencia__c 
            WHERE Servico__c = '${id}'
            ORDER BY Competencia__c ASC
        `);

        // 2. Consolidar por Competência (Mês/Ano)
        const consolidated = {};
        
        orcResults.records.forEach(orc => {
            const comp = orc.Competencia__c;
            if (!consolidated[comp]) {
                consolidated[comp] = {
                    month: comp,
                    baseline: { revenue: 0, cost: 0 },
                    forecast: { revenue: 0, cost: 0 },
                    realized: { revenue: 0, cost: 0, hours: 0 }
                };
            }

            const data = consolidated[comp];

            // Se for Baseline (Item Comercial)
            if (orc.AlocacaoPrevista__c) {
                data.baseline.revenue += orc.ReceitaPrevista__c || 0;
                data.baseline.cost += orc.CustoPrevisto__c || 0;
            }

            // Se for Forecast (Alocação Real)
            if (orc.Alocacao__c) {
                data.forecast.revenue += orc.ReceitaPrevista__c || 0;
                data.forecast.cost += orc.CustoPrevisto__c || 0;
                
                // Realizado vem sempre das alocações reais
                data.realized.revenue += orc.ReceitaRealizada__c || 0;
                data.realized.cost += orc.CustoRealizado__c || 0;
                data.realized.hours += orc.HorasRealizadas__c || 0;
            }
        });

        // 3. Buscar detalhamento de horas e custos por consultor
        const timeLogs = await conn.query(`
            SELECT Responsavel__r.Name, SUM(Horas__c) hrs, SUM(ValorTotalLancamento__c) cost, CALENDAR_MONTH(DiaPeriodo__r.Data__c) m, CALENDAR_YEAR(DiaPeriodo__r.Data__c) y
            FROM LancamentoHora__c 
            WHERE Servico__c = '${id}' AND Status__c = 'Faturado'
            GROUP BY Responsavel__r.Name, CALENDAR_MONTH(DiaPeriodo__r.Data__c), CALENDAR_YEAR(DiaPeriodo__r.Data__c)
        `);

        // 4. Buscar receita por consultor baseada nas distribuições (Vínculo indireto via Orcamento)
        const revenueLogs = await conn.query(`
            SELECT OrcamentoCompetencia__r.Alocacao__r.Pessoa__r.Name person, SUM(ValorDistribuido__c) rev, CALENDAR_MONTH(OrcamentoCompetencia__r.Competencia__c) m, CALENDAR_YEAR(OrcamentoCompetencia__r.Competencia__c) y
            FROM DistribuicaoReceita__c
            WHERE OrcamentoCompetencia__r.Servico__c = '${id}'
            GROUP BY OrcamentoCompetencia__r.Alocacao__r.Pessoa__r.Name, CALENDAR_MONTH(OrcamentoCompetencia__r.Competencia__c), CALENDAR_YEAR(OrcamentoCompetencia__r.Competencia__c)
        `);

        // Mapear receita para os logs de tempo
        const revMap = {};
        revenueLogs.records.forEach(r => {
            const key = `${r.person}_${r.y}-${r.m}`;
            revMap[key] = (revMap[key] || 0) + r.rev;
        });

        res.json({ 
            success: true, 
            consolidated: Object.values(consolidated).sort((a,b) => a.month.localeCompare(b.month)),
            timeLogs: timeLogs.records.map(r => {
                const key = `${r.Name}_${r.y}-${r.m}`;
                return {
                    person: r.Name,
                    hours: r.hrs,
                    cost: r.cost,
                    revenue: revMap[key] || 0,
                    period: `${r.y}-${String(r.m).padStart(2,'0')}-01`
                };
            })
        });
    } catch (e) {
        console.error("Get Realized Data Error:", e);
        res.status(500).json({ success: false, error: e.message });
    }
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

        const svcRecord = { Id: data.id || null };
        if (data.name) svcRecord.Name = data.name;
        if (accountId) svcRecord.Conta__c = accountId;
        if (data.ca_client_id !== undefined) svcRecord.IDContaAzul__c = data.ca_client_id;
        if (data.type) svcRecord.Tipo__c = data.type;
        if (data.start !== undefined) svcRecord.DataInicio__c = cleanDate(data.start);
        if (data.end_original !== undefined) svcRecord.DataFimOriginal__c = cleanDate(data.end_original);
        if (data.end_real !== undefined) svcRecord.DataFim__c = cleanDate(data.end_real);
        if (data.lead_project !== undefined) svcRecord.Lider__c = cleanId(data.lead_project);
        if (data.coordinator !== undefined) svcRecord.Coordenador__c = cleanId(data.coordinator);
        if (data.tech_lead !== undefined) svcRecord.LiderTecnico__c = cleanId(data.tech_lead);
        if (data.reqReport !== undefined) svcRecord.RequerRelatorioFaturamento__c = data.reqReport;
        if (data.solReport !== undefined) svcRecord.SolicitaRelatorioHoras__c = data.solReport;

        let result = data.id ? await conn.sobject('Servico__c').update(svcRecord) : await conn.sobject('Servico__c').create(svcRecord);
        if (result.success) {
            const serviceId = result.id || data.id;
            if (data.docIds && data.docIds.length > 0) {
                const links = data.docIds.map(docId => ({ ContentDocumentId: docId, LinkedEntityId: serviceId, ShareType: 'V' }));
                try { await conn.sobject('ContentDocumentLink').create(links); } catch(e) {}
            }
            let tRev = 0, tCost = 0;
            const commIdMap = {};

            if (data.commercial) {
                for (const item of data.commercial) {
                    const record = { Servico__c: serviceId, Produto__c: item.productName, TaxaVenda__c: item.saleRate, CustoEstimado__c: item.costEst, DataInicio__c: cleanDate(item.start) || svcRecord.DataInicio__c, DataFim__c: cleanDate(item.end) || svcRecord.DataFimOriginal__c, PercentualAlocacao__c: item.alloc || 100, ReceitaTotal__c: item.totalRev, CustoTotal__c: item.totalCost, HorasTotais__c: item.totalHours };
                    tRev += (item.totalRev || 0); tCost += (item.totalCost || 0);
                    
                    let ret;
                    if (item.id && !item.id.startsWith('new')) {
                        const updateRecord = { ...record, Id: item.id };
                        delete updateRecord.Servico__c;
                        ret = await conn.sobject('AlocacaoPrevista__c').update(updateRecord);
                        commIdMap[item.id] = item.id;
                    } else {
                        ret = await conn.sobject('AlocacaoPrevista__c').create(record);
                        commIdMap[item.id] = ret.id;
                    }
                    
                    const allocId = ret.id || item.id;
                    if (item.monthlyData && item.monthlyData.length > 0 && allocId) {
                        const exOrcs = await conn.query(`SELECT Id FROM OrcamentoCompetencia__c WHERE AlocacaoPrevista__c = '${allocId}'`);
                        if (exOrcs.totalSize > 0) await conn.sobject('OrcamentoCompetencia__c').destroy(exOrcs.records.map(r => r.Id));
                        const orcRecords = item.monthlyData.map(m => ({ AlocacaoPrevista__c: allocId, Servico__c: serviceId, Competencia__c: m.date, ReceitaPrevista__c: m.rev, CustoPrevisto__c: m.cost }));
                        await conn.sobject('OrcamentoCompetencia__c').create(orcRecords);
                    }
                }
            }

            let tRevAlloc = 0, tCostAlloc = 0;
            if (data.execution) {
                for (const item of data.execution) {
                    let allocPrevId = null;
                    if (item.commercialLinkId) {
                        allocPrevId = commIdMap[item.commercialLinkId] || (item.commercialLinkId.startsWith('new') ? null : item.commercialLinkId);
                    }
                    
                    const record = { 
                        Servico__c: serviceId, 
                        Pessoa__c: cleanId(item.personId), 
                        AlocacaoPrevista__c: allocPrevId,
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
                        const updateRecord = { ...record, Id: item.id };
                        delete updateRecord.Servico__c; 
                        delete updateRecord.Pessoa__c;
                        ret = await conn.sobject('Alocacao__c').update(updateRecord);
                    } else {
                        ret = await conn.sobject('Alocacao__c').create(record);
                    }

                    const allocId = ret.id || item.id;
                    if (item.monthlyData && item.monthlyData.length > 0 && allocId) {
                        const exOrcs = await conn.query(`SELECT Id FROM OrcamentoCompetencia__c WHERE Alocacao__c = '${allocId}'`);
                        if (exOrcs.totalSize > 0) await conn.sobject('OrcamentoCompetencia__c').destroy(exOrcs.records.map(r => r.Id));
                        const orcRecords = item.monthlyData.map(m => ({ 
                            Alocacao__c: allocId, 
                            Servico__c: serviceId, 
                            Competencia__c: m.date, 
                            ReceitaPrevista__c: m.rev, 
                            CustoPrevisto__c: m.cost 
                        }));
                        await conn.sobject('OrcamentoCompetencia__c').create(orcRecords);
                    }
                }
            }

            // Recalcular totais previstos para o serviço
            const allocTotals = await conn.query(`SELECT SUM(ReceitaTotal__c) rev, SUM(CustoTotal__c) cost FROM Alocacao__c WHERE Servico__c = '${serviceId}'`);
            const tRevAllocReal = allocTotals.records[0].rev || 0;
            const tCostAllocReal = allocTotals.records[0].cost || 0;

            await conn.sobject('Servico__c').update({ 
                Id: serviceId, 
                ReceitaVendida__c: tRev, 
                CustoVendido__c: tCost, 
                MargemVendida__c: tRev > 0 ? ((tRev - tCost) / tRev) * 100 : 0,
                ReceitaPrevista__c: tRevAllocReal,
                CustoPrevisto__c: tCostAllocReal,
                MargemPrevista__c: tRevAllocReal > 0 ? ((tRevAllocReal - tCostAllocReal) / tRevAllocReal) * 100 : 0
            });
            res.json({ success: true, message: "Salvo!", id: serviceId });
        } else res.status(400).json({ success: false, details: result.errors });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
};

exports.uploadDocument = async (req, res) => {
    const { serviceId, type } = req.body;
    const file = req.files?.files?.[0];
    if (!file || !serviceId) return res.status(400).json({ success: false, message: 'Arquivo ou ID do serviço ausente.' });
    try {
        const conn = await getSfConnection();
        const service = await conn.sobject('Servico__c').retrieve(serviceId);
        let finalTitle = `${type} - ${service.Name}`;
        if (finalTitle.length > 255) finalTitle = finalTitle.substring(0, 255);
        const blob = fs.readFileSync(file.path);
        const cvResult = await conn.sobject('ContentVersion').create({ Title: finalTitle, PathOnClient: file.originalname, VersionData: blob.toString('base64'), Origin: 'H', FirstPublishLocationId: serviceId });
        const docIdResult = await conn.query(`SELECT ContentDocumentId FROM ContentVersion WHERE Id = '${cvResult.id}'`);
        fs.unlinkSync(file.path);
        res.json({ success: true, docId: docIdResult.records[0].ContentDocumentId });
    } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

exports.deleteAllocation = async (req, res) => {
    const { id } = req.params;
    try {
        const conn = await getSfConnection();
        const checkLogs = await conn.query(`SELECT Count(Id) total FROM LancamentoHora__c WHERE Responsavel__r.Alocacao__c = '${id}'`);
        if (checkLogs.records[0].total > 0) return res.status(400).json({ success: false, error: "Não é possível excluir: Existem horas lançadas para esta alocação." });
        const orcs = await conn.query(`SELECT Id FROM OrcamentoCompetencia__c WHERE Alocacao__c = '${id}'`);
        if (orcs.totalSize > 0) await conn.sobject('OrcamentoCompetencia__c').destroy(orcs.records.map(r => r.Id));
        await conn.sobject('Alocacao__c').destroy(id);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
};

exports.deleteDocument = async (req, res) => {
    try { const conn = await getSfConnection(); await conn.sobject('ContentDocument').delete(req.params.docId); res.json({ success: true }); } 
    catch (e) { res.status(500).json({ error: e.message }); }
};

exports.downloadDocument = async (req, res) => {
    try {
        const conn = await getSfConnection();
        const result = await conn.query(`SELECT Id, Title, FileExtension FROM ContentVersion WHERE ContentDocumentId = '${req.params.docId}' AND IsLatest = true LIMIT 1`);
        if (result.totalSize === 0) return res.status(404).send("Not found");
        const cv = result.records[0];
        res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(cv.Title + '.' + cv.FileExtension)}"`);
        conn.sobject('ContentVersion').record(cv.Id).blob('VersionData').pipe(res);
    } catch (e) { res.status(500).send("Error"); }
};

exports.getAvailableSales = async (req, res) => {
    try {
        const { caClientId } = req.query;
        if (!caClientId) return res.json([]);
        const sales = await contaAzulService.getSalesByCustomer(caClientId);
        res.json(sales);
    } catch (e) { res.status(500).json({ error: "Erro ao buscar vendas no Conta Azul" }); }
};

exports.getSaleInstallmentsPreview = async (req, res) => {
    try {
        const { saleId } = req.params;
        if (!saleId) return res.json([]);
        const installments = await contaAzulService.getSaleInstallments(saleId);
        res.json(installments.map(p => {
            let normalizedStatus = 'Pendente';
            const sUpper = (p.status || '').toUpperCase();
            if (['QUITADO', 'PAGO', 'CONFIRMADO', 'APROVADO'].includes(sUpper)) normalizedStatus = 'Pago';
            else if (sUpper === 'VENCIDO') normalizedStatus = 'Atrasado';
            else if (sUpper === 'CANCELADO') normalizedStatus = 'Cancelado';
            return { desc: p.descricao, date: p.data_vencimento ? p.data_vencimento.split('T')[0] : null, value: p.valor_composicao ? p.valor_composicao.valor_bruto : (p.valor_pago || 0), status: normalizedStatus, month: p.data_vencimento ? p.data_vencimento.substring(0, 7) : null };
        }));
    } catch (e) { res.status(500).json({ error: "Erro ao buscar parcelas" }); }
};

exports.saveSales = async (req, res) => {
    const { serviceId, sales, installments } = req.body; 
    if (!serviceId || !sales || !Array.isArray(sales)) return res.status(400).json({ success: false });
    try {
        const conn = await getSfConnection();
        
        // 1. Gerenciar Vínculos (VendaServico__c)
        const existingLinks = await conn.query(`SELECT Id, Venda__r.IDContaAzul__c FROM VendaServico__c WHERE Servico__c = '${serviceId}'`);
        const existingLinksMap = {};
        existingLinks.records.forEach(r => existingLinksMap[r.Venda__r.IDContaAzul__c] = r.Id);

        const saleToSfIdMap = {};
        
        for (const s of sales) {
            // Garantir que a venda existe no SF (pode vir direto do CA e não estar no SF ainda)
            const salesInSf = await conn.query(`SELECT Id FROM VendaContaAzul__c WHERE IDContaAzul__c = '${s.id}' LIMIT 1`);
            let sfSaleId;
            
            if (salesInSf.totalSize > 0) {
                sfSaleId = salesInSf.records[0].Id;
            } else {
                // Se não existir, criamos (segurança extra)
                const resIns = await conn.sobject('VendaContaAzul__c').create({
                    IDContaAzul__c: s.id,
                    Name: s.number ? String(s.number) : 'S/N',
                    DataEmissao__c: s.emissionDate,
                    ValorTotal__c: s.total,
                    Status__c: s.status
                });
                sfSaleId = resIns.id;
            }
            
            saleToSfIdMap[s.id] = sfSaleId;

            // Criar ou atualizar o vínculo de junção
            const junctionRecord = {
                Servico__c: serviceId,
                Venda__c: sfSaleId,
                ValorAlocado__c: s.allocatedValue || s.total // Usa o valor alocado da tela ou o total da venda
            };

            if (existingLinksMap[s.id]) {
                junctionRecord.Id = existingLinksMap[s.id];
                await conn.sobject('VendaServico__c').update(junctionRecord);
            } else {
                await conn.sobject('VendaServico__c').create(junctionRecord);
            }
        }

        // 2. Sincronizar Parcelas (Vínculo direto com Serviço e Venda)
        if (installments && installments.length > 0) {
            const currentInsts = await conn.query(`SELECT Id FROM ParcelaFinanceira__c WHERE Servico__c = '${serviceId}'`);
            if (currentInsts.totalSize > 0) await conn.sobject('ParcelaFinanceira__c').destroy(currentInsts.records.map(r => r.Id));
            
            const instToInsert = installments.map(i => ({ 
                Servico__c: serviceId, 
                VendaContaAzul__c: saleToSfIdMap[i.originSaleId] || null, 
                Descricao__c: i.desc, 
                Competencia__c: i.month ? `${i.month}-01` : null, 
                DataVencimento__c: i.date, 
                Valor__c: i.value, 
                Status__c: i.status,
                IDContaAzul__c: i.id_ca // Manter rastreabilidade se vier do preview
            }));
            await conn.sobject('ParcelaFinanceira__c').create(instToInsert);
        }
        res.json({ success: true });
    } catch (e) { 
        console.error("Erro ao salvar vínculos:", e);
        res.status(500).json({ success: false, error: e.message }); 
    }
};

exports.deleteSale = async (req, res) => {
    const { id } = req.params;
    try {
        const conn = await getSfConnection();
        const installments = await conn.query(`SELECT Id FROM ParcelaFinanceira__c WHERE VendaContaAzul__c = '${id}'`);
        const instIds = installments.records.map(r => r.Id);
        if (instIds.length > 0) {
            const distCheck = await conn.query(`SELECT Count(Id) total FROM DistribuicaoReceita__c WHERE ParcelaFinanceira__c IN (${instIds.map(id => `'${id}'`).join(',')})`);
            if (distCheck.records[0].total > 0) return res.status(400).json({ success: false, error: "Não é possível desvincular: Existem parcelas com receita já distribuída." });
            await conn.sobject('ParcelaFinanceira__c').destroy(instIds);
        }
        await conn.sobject('VendaContaAzul__c').destroy(id);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
};

exports.deleteCommercialItem = async (req, res) => {
    const { id } = req.params;
    try {
        const conn = await getSfConnection();
        const checkExec = await conn.query(`SELECT Count(Id) total FROM Alocacao__c WHERE AlocacaoPrevista__c = '${id}'`);
        if (checkExec.records[0].total > 0) return res.status(400).json({ success: false, error: "Não é possível excluir: Este item comercial está vinculado a alocações." });
        const orcs = await conn.query(`SELECT Id FROM OrcamentoCompetencia__c WHERE AlocacaoPrevista__c = '${id}'`);
        if (orcs.totalSize > 0) await conn.sobject('OrcamentoCompetencia__c').destroy(orcs.records.map(r => r.Id));
        await conn.sobject('AlocacaoPrevista__c').destroy(id);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
};

async function getMetadata() {
    const conn = await getSfConnection();
    let accounts = [], people = [], pricebooks = [], caClients = [];
    try { const r = await conn.query("SELECT Id, Name FROM Account ORDER BY Name ASC"); accounts = r.records.map(a => ({ id: a.Id, name: a.Name })); } catch(e) {}
    try { const r = await conn.query("SELECT Id, Name, Custo__c FROM Pessoa__c ORDER BY Name ASC"); people = r.records.map(p => ({ id: p.Id, name: p.Name, costRate: p.Custo__c || 0 })); } catch(e) {}
    try {
        const pb = await conn.query("SELECT Id, Name FROM Pricebook2 WHERE IsActive = true ORDER BY Name ASC");
        const pbe = await conn.query("SELECT Id, Pricebook2Id, Product2.Name, UnitPrice, Custo__c FROM PricebookEntry WHERE IsActive = true AND Pricebook2.IsActive = true");
        const map = {};
        pbe.records.forEach(p => { if(!map[p.Pricebook2Id]) map[p.Pricebook2Id] = []; map[p.Pricebook2Id].push({ name: p.Product2.Name, price: p.UnitPrice || 0, cost: p.Custo__c || 0 }); });
        pricebooks = pb.records.map(b => ({ id: b.Id, name: b.Name, products: map[b.Id] || [] }));
    } catch(e) {}
    try { caClients = await contaAzulService.searchCustomers(''); } catch(e) {}
    return { pricebooks, salesforceAccounts: accounts, contaAzulClients: caClients, people };
}
