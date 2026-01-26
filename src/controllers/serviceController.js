const fs = require('fs');
const { getSfConnection } = require('../config/salesforce');
const contaAzulService = require('../services/contaAzulService');

const formatDate = (d) => d ? new Date(d).toISOString().split('T')[0] : null;

exports.renderServicesPage = async (req, res) => {
    try {
        const conn = await getSfConnection();
        const query = "SELECT Id, Name, Conta__r.Name, Tipo__c, Status__c, DataInicio__c, DataFimOriginal__c, DataFim__c, ReceitaVendida__c, CustoVendido__c, MargemVendida__c, ReceitaPrevista__c, CustoPrevisto__c, MargemPrevista__c, ReceitaRealizada__c, CustoRealizado__c, MargemRealizada__c FROM Servico__c WHERE Status__c = 'Ativo' ORDER BY Name ASC";
        const result = await conn.query(query);
        console.log(result.records);
        const services = result.records.map(s => ({
            id: s.Id, name: s.Name, client: s.Conta__r ? s.Conta__r.Name : '', type: s.Tipo__c, status: s.Status__c || 'Ativo',
            dataInicio: s.DataInicio__c, dataFimOriginal: s.DataFimOriginal__c, dataFim: s.DataFim__c,
            prop: { rev: s.ReceitaVendida__c || 0, margin: parseFloat((s.MargemVendida__c || 0).toFixed(2)) }, 
            act: { rev: s.ReceitaRealizada__c || 0, cost: s.CustoRealizado__c || 0, margin: parseFloat((s.MargemRealizada__c || 0).toFixed(2)) }, 
            fcst: { rev: s.ReceitaPrevista__c || 0, cost: s.CustoPrevisto__c || 0, margin: parseFloat((s.MargemPrevista__c || 0).toFixed(2)) }
        }));
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
        const query = `SELECT Id, Name, Conta__r.Name, Tipo__c, Status__c, DataInicio__c, DataFimOriginal__c, DataFim__c, ReceitaVendida__c, CustoVendido__c, MargemVendida__c, ReceitaPrevista__c, CustoPrevisto__c, MargemPrevista__c, ReceitaRealizada__c, CustoRealizado__c, MargemRealizada__c FROM Servico__c ${whereClause} ORDER BY Name ASC`;
        const result = await conn.query(query);
        console.log(result.records);
        res.json(result.records.map(s => ({
            id: s.Id, name: s.Name, client: s.Conta__r ? s.Conta__r.Name : '', type: s.Tipo__c, status: s.Status__c || 'Ativo',
            dataInicio: s.DataInicio__c, dataFimOriginal: s.DataFimOriginal__c, dataFim: s.DataFim__c,
            prop: { rev: s.ReceitaVendida__c || 0, margin: parseFloat((s.MargemVendida__c || 0).toFixed(2)) }, 
            act: { rev: s.ReceitaRealizada__c || 0, margin: parseFloat((s.MargemRealizada__c || 0).toFixed(2)) }, 
            fcst: { rev: s.ReceitaPrevista__c || 0, margin: parseFloat((s.MargemPrevista__c || 0).toFixed(2)) }
        })));
    } catch (e) { res.status(500).json({ error: e.message }); }
};

exports.getServiceDetails = async (req, res) => {
    const { id } = req.params;
    if (id === 'new') return res.json({ id: null, name: "", client: "", type: "Projeto", status: "Novo", commercial: [], execution: [], installments: [], documents: [], metadata: await getMetadata() });
    try {
        const conn = await getSfConnection();
        const [rSvc, rComm, rExec, rLinks, rSales] = await Promise.all([
            conn.query(`SELECT Id, Name, Conta__c, Conta__r.Name, IDContaAzul__c, Tipo__c, Status__c, Lider__c, Coordenador__c, LiderTecnico__c, DataInicio__c, DataFimOriginal__c, DataFim__c, ReceitaVendida__c, CustoVendido__c, MargemVendida__c, ReceitaPrevista__c, CustoPrevisto__c, MargemPrevista__c, ReceitaRealizada__c, MargemRealizada__c FROM Servico__c WHERE Id = '${id}'`),
            conn.query(`SELECT Id, Produto__c, TaxaVenda__c, CustoEstimado__c, DataInicio__c, DataFim__c, PercentualAlocacao__c, ReceitaTotal__c, CustoTotal__c, HorasTotais__c FROM AlocacaoPrevista__c WHERE Servico__c = '${id}'`),
            conn.query(`SELECT Id, Pessoa__c, Pessoa__r.Name, DataInicio__c, DataFimOriginal__c, Percentual__c, AlocacaoPrevista__c, TaxaVenda__c, CustoHr__c, Dias__c, HorasTotais__c, ReceitaTotal__c, CustoTotal__c, Margem__c FROM Alocacao__c WHERE Servico__c = '${id}'`),
            conn.query(`SELECT ContentDocumentId FROM ContentDocumentLink WHERE LinkedEntityId = '${id}'`),
            conn.query(`SELECT Id, IDContaAzul__c, Name, DataEmissao__c, ValorTotal__c, Status__c FROM VendaContaAzul__c WHERE Servico__c = '${id}'`)
        ]);
        
        let rFin = { records: [] };
        try {
             rFin = await conn.query(`SELECT Id, Valor__c, DataVencimento__c, Competencia__c, Status__c, Descricao__c FROM ParcelaFinanceira__c WHERE Servico__c = '${id}'`);
        } catch(errFin) {
            console.error("Erro ao buscar parcelas (campo inexistente?):", errFin.message);
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
            prop: { rev: svc.ReceitaVendida__c || 0, cost: svc.CustoVendido__c || 0, margin: parseFloat((svc.MargemVendida__c || 0).toFixed(2)) },
            fcst: { rev: svc.ReceitaPrevista__c || 0, cost: svc.CustoPrevisto__c || 0, margin: parseFloat((svc.MargemPrevista__c || 0).toFixed(2)) },
            act: { rev: svc.ReceitaRealizada__c || 0, cost: svc.CustoRealizado__c || 0, margin: parseFloat((margemReal || 0).toFixed(2)) },
            commercial: rComm.records.map(r => ({ id: r.Id, productName: r.Produto__c, saleRate: r.TaxaVenda__c, costEst: r.CustoEstimado__c, start: formatDate(r.DataInicio__c), end: formatDate(r.DataFim__c), alloc: r.PercentualAlocacao__c, totalRev: r.ReceitaTotal__c, totalCost: r.CustoTotal__c, totalHours: r.HorasTotais__c })),
            execution: executionData,
            sales: rSales.records.map(s => ({ id: s.Id, id_ca: s.IDContaAzul__c, number: s.Name, date: formatDate(s.DataEmissao__c), total: s.ValorTotal__c, status: s.Status__c })),
            installments: rFin.records.map(r => ({ id: r.Id, desc: r.Descricao__c, date: r.DataVencimento__c ? formatDate(r.DataVencimento__c) : '', value: r.Valor__c, status: r.Status__c, month: r.Competencia__c ? r.Competencia__c.substring(0,7) : '' })),
            metadata: await getMetadata()
        });
    } catch (e) { res.status(500).json({ error: e.message }); }
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
        const svcRecord = { Name: data.name, Conta__c: accountId, IDContaAzul__c: data.ca_client_id, Tipo__c: data.type, DataInicio__c: cleanDate(data.start), DataFimOriginal__c: cleanDate(data.end_original), DataFim__c: cleanDate(data.end_real), Lider__c: cleanId(data.lead_project), Coordenador__c: cleanId(data.coordinator), LiderTecnico__c: cleanId(data.tech_lead) };
        let result = data.id ? await conn.sobject('Servico__c').update({ ...svcRecord, Id: data.id }) : await conn.sobject('Servico__c').create(svcRecord);
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
                        // Remove Master-Detail field for update
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
                        console.log(`Saving ${item.monthlyData.length} monthly records for alloc ${allocId}`);
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
                    
                    tRevAlloc += (item.totalRev || 0);
                    tCostAlloc += (item.totalCost || 0);

                    const record = { 
                        Servico__c: serviceId, 
                        Pessoa__c: cleanId(item.personId), 
                        AlocacaoPrevista__c: allocPrevId,
                        DataInicio__c: cleanDate(item.start) || svcRecord.DataInicio__c, 
                        DataFimOriginal__c: cleanDate(item.end) || svcRecord.DataFimOriginal__c, 
                        Percentual__c: item.alloc || 100,
                        TaxaVenda__c: item.saleRate,
                        CustoHr__c: item.costRate,
                        Dias__c: item.days,
                        HorasTotais__c: item.totalHours,
                        ReceitaTotal__c: item.totalRev,
                        CustoTotal__c: item.totalCost,
                        Margem__c: item.margin
                    };
                    
                    let ret;
                    if (item.id && !item.id.startsWith('new')) {
                        const updateRecord = { ...record, Id: item.id };
                        delete updateRecord.Servico__c; 
                        delete updateRecord.Pessoa__c; // Remove Master-Detail from update
                        ret = await conn.sobject('Alocacao__c').update(updateRecord);
                    } else {
                        ret = await conn.sobject('Alocacao__c').create(record);
                    }

                    const allocId = ret.id || item.id;
                    if (item.monthlyData && item.monthlyData.length > 0 && allocId) {
                        // Limpar orçamentos antigos vinculados a esta alocação (Execução)
                        const exOrcs = await conn.query(`SELECT Id FROM OrcamentoCompetencia__c WHERE Alocacao__c = '${allocId}'`);
                        if (exOrcs.totalSize > 0) await conn.sobject('OrcamentoCompetencia__c').destroy(exOrcs.records.map(r => r.Id));
                        
                        // Criar novos orçamentos mensais
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

            await conn.sobject('Servico__c').update({ 
                Id: serviceId, 
                ReceitaVendida__c: tRev, 
                CustoVendido__c: tCost, 
                MargemVendida__c: tRev > 0 ? ((tRev - tCost) / tRev) * 100 : 0,
                ReceitaPrevista__c: tRevAlloc,
                CustoPrevisto__c: tCostAlloc,
                MargemPrevista__c: tRevAlloc > 0 ? ((tRevAlloc - tCostAlloc) / tRevAlloc) * 100 : 0
            });
            res.json({ success: true, message: "Salvo!", id: serviceId });
        } else res.status(400).json({ success: false, details: result.errors });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
};

exports.uploadDocument = async (req, res) => {
    if (!req.file) return res.status(400).json({ error: "No file" });
    const { type } = req.body;
    try {
        const conn = await getSfConnection();
        const b64 = fs.readFileSync(req.file.path, { encoding: 'base64' });
        const title = (type && type !== 'Outros') ? type : req.file.originalname;
        const resCV = await conn.sobject('ContentVersion').create({ Title: title, PathOnClient: req.file.originalname, VersionData: b64, FirstPublishLocationId: req.session.user.id });
        fs.unlinkSync(req.file.path);
        if (resCV.success) {
            const cv = await conn.query(`SELECT ContentDocumentId FROM ContentVersion WHERE Id = '${resCV.id}'`);
            res.json({ success: true, docId: cv.records[0].ContentDocumentId });
        } else res.status(400).json({ error: "SF Error" });
    } catch (e) { res.status(500).json({ error: e.message }); }
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
        
        // Busca vendas direto da API Conta Azul (via Service)
        const sales = await contaAzulService.getSalesByCustomer(caClientId);
        
        // Retorna para o frontend (que vai filtrar o que já está salvo se necessário)
        res.json(sales);
    } catch (e) {
        console.error("Erro ao buscar vendas CA:", e);
        res.status(500).json({ error: "Erro ao buscar vendas no Conta Azul" });
    }
};

exports.getSaleInstallmentsPreview = async (req, res) => {
    try {
        const { saleId } = req.params;
        if (!saleId) return res.json([]);
        const installments = await contaAzulService.getSaleInstallments(saleId);
        res.json(installments.map(p => {
            // Normalização redundante para garantir que o front receba o status correto
            let normalizedStatus = 'Pendente';
            const rawStatus = p.status || '';
            const statusUpper = rawStatus.toUpperCase();
            if (['QUITADO', 'PAGO', 'CONFIRMADO', 'APROVADO'].includes(statusUpper)) normalizedStatus = 'Pago';
            else if (statusUpper === 'VENCIDO') normalizedStatus = 'Atrasado';
            else if (statusUpper === 'CANCELADO') normalizedStatus = 'Cancelado';

            return {
                desc: p.descricao,
                date: p.data_vencimento ? p.data_vencimento.split('T')[0] : null,
                value: p.valor_composicao ? p.valor_composicao.valor_bruto : (p.valor_pago || 0),
                status: normalizedStatus,
                month: p.data_vencimento ? p.data_vencimento.substring(0, 7) : null
            };
        }));
    } catch (e) {
        console.error("Erro ao buscar preview de parcelas:", e);
        res.status(500).json({ error: "Erro ao buscar parcelas" });
    }
};

exports.saveSales = async (req, res) => {
    const { serviceId, sales, installments } = req.body; 
    console.log(`[saveSales] ServiceId: ${serviceId}, Sales: ${sales?.length}, Installments: ${installments?.length}`); // Debug

    if (!serviceId || !sales || !Array.isArray(sales)) {
        console.error("[saveSales] Invalid Payload");
        return res.status(400).json({ success: false });
    }

    try {
        const conn = await getSfConnection();
        
        // 1. Buscar vendas vinculadas
        const existing = await conn.query(`SELECT Id, IDContaAzul__c FROM VendaContaAzul__c WHERE Servico__c = '${serviceId}'`);
        const existingMap = {};
        existing.records.forEach(r => existingMap[r.IDContaAzul__c] = r.Id);

        const saleToSfIdMap = {};

        for (const s of sales) {
            // Pegar ID do evento financeiro se ainda não tivermos (melhoria futura: enviar do front)
            // const caInstallments = await contaAzulService.getSaleInstallments(s.id); 
            // REMOVIDO: Nao buscar parcelas aqui novamente para economizar API e usar o que veio do front
            // Porem, precisamos do ID do evento financeiro se for novo.
            // Para performance, vamos confiar que o front mandou as parcelas corretas. 
            // Se precisarmos do IDEventoFinanceiro__c, idealmente o front mandaria ou buscamos sob demanda.
            // Mantendo a busca apenas para garantir dados consistentes na Venda, mas sem gerar parcelas duplicadas.
            
            // Mas espere, se eu não buscar aqui, como preencho IDEventoFinanceiro__c?
            // O front não tem esse ID explicitamente na lista de vendas (só tem nas parcelas como financialEventId invisivel?).
            
            // Vamos manter a busca leve OU assumir que o front pode mandar.
            // Para debug agora, vou manter a lógica original mas logar.
            
            console.log(`[saveSales] Processing Sale: ${s.number}`);
            
            const caInstallments = await contaAzulService.getSaleInstallments(s.id);
            let financialEventId = caInstallments.length > 0 ? caInstallments[0].financialEventId : null;

            const saleRecord = {
                Servico__c: serviceId,
                IDContaAzul__c: s.id,
                Name: s.number ? String(s.number) : 'S/N',
                DataEmissao__c: s.emissionDate,
                ValorTotal__c: s.total,
                Status__c: s.status,
                IDEventoFinanceiro__c: financialEventId
            };

            if (existingMap[s.id]) {
                saleRecord.Id = existingMap[s.id];
                await conn.sobject('VendaContaAzul__c').update(saleRecord);
                saleToSfIdMap[s.id] = saleRecord.Id;
            } else {
                const resIns = await conn.sobject('VendaContaAzul__c').create(saleRecord);
                saleToSfIdMap[s.id] = resIns.id;
            }
        }

        // 2. Persistir Parcelas (baseado no estado do front)
        if (installments && Array.isArray(installments) && installments.length > 0) {
            console.log(`[saveSales] Processing ${installments.length} Installments from Frontend`);
            
            // Limpar parcelas atuais do serviço para refletir o estado do front
            const currentInsts = await conn.query(`SELECT Id FROM ParcelaFinanceira__c WHERE Servico__c = '${serviceId}'`);
            if (currentInsts.totalSize > 0) {
                console.log(`[saveSales] Deleting ${currentInsts.totalSize} existing installments`);
                await conn.sobject('ParcelaFinanceira__c').destroy(currentInsts.records.map(r => r.Id));
            }

            const instToInsert = installments.map(i => {
                let status = i.status || 'Pendente';
                const sUpper = status.toUpperCase();
                if (['QUITADO', 'PAGO', 'CONFIRMADO', 'APROVADO'].includes(sUpper)) status = 'Pago';
                else if (sUpper === 'VENCIDO' || sUpper === 'ATRASADO') status = 'Atrasado';
                else if (sUpper === 'CANCELADO') status = 'Cancelado';

                return {
                    Servico__c: serviceId,
                    VendaContaAzul__c: saleToSfIdMap[i.originSaleId] || null, // Link to the SF Sale ID we just mapped
                    Descricao__c: i.desc,
                    Competencia__c: i.month ? `${i.month}-01` : null,
                    DataVencimento__c: i.date,
                    Valor__c: i.value,
                    Status__c: status
                };
            });
            
            if (instToInsert.length > 0) {
                console.log(`[saveSales] First Installment to Insert:`, JSON.stringify(instToInsert[0]));
            }
            
            console.log(`[saveSales] Inserting ${instToInsert.length} new installments`);
            await conn.sobject('ParcelaFinanceira__c').create(instToInsert);
        } else {
            console.log("[saveSales] No installments to save.");
        }

        res.json({ success: true, message: "Vendas e parcelas sincronizadas com sucesso." });

    } catch (e) {
        console.error("[saveSales] Error:", e);
        res.status(500).json({ success: false, error: e.message });
    }
};

exports.deleteSale = async (req, res) => {
    const { id } = req.params;
    try {
        const conn = await getSfConnection();
        
        // 0. Verify dependencies (Parcelas)
        const checkInstallments = await conn.query(`SELECT Count() FROM ParcelaFinanceira__c WHERE VendaContaAzul__c = '${id}'`);
        if (checkInstallments.totalSize > 0) {
            return res.status(400).json({ 
                success: false, 
                error: "Não é possível excluir: Existem parcelas financeiras vinculadas a esta venda." 
            });
        }

        // 1. Delete VendaContaAzul__c
        await conn.sobject('VendaContaAzul__c').destroy(id);

        res.json({ success: true });
    } catch (e) {
        console.error("Delete Sale Error:", e);
        res.status(500).json({ success: false, error: e.message });
    }
};

exports.deleteInstallment = async (req, res) => {
    const { id } = req.params;
    try {
        const conn = await getSfConnection();
        
        // 0. Verify dependencies (DistribuicaoReceita__c)
        // Check if there is any revenue distribution linked to this installment
        try {
            const distCheck = await conn.query(`SELECT Count() FROM DistribuicaoReceita__c WHERE ParcelaFinanceira__c = '${id}'`);
            if (distCheck.totalSize > 0) { // Count() returns totalSize, records is empty
                return res.status(400).json({ 
                    success: false, 
                    error: "Não é possível excluir: Esta parcela possui distribuição de receita vinculada." 
                });
            }
        } catch (errDist) {
             console.warn("Skipping Revenue Distribution check (Object might not exist):", errDist.message);
        }

        // 1. Delete ParcelaFinanceira__c
        await conn.sobject('ParcelaFinanceira__c').destroy(id);

        res.json({ success: true });
    } catch (e) {
        console.error("Delete Installment Error:", e);
        res.status(500).json({ success: false, error: e.message });
    }
};

exports.deleteAllocation = async (req, res) => {
    const { id } = req.params;
    try {
        const conn = await getSfConnection();
        
        // 0. Verify dependencies
        // Check if there are any Responsavel__c records linked to this Allocation
        try {
            const responsavelCheck = await conn.query(`SELECT Count() FROM Responsavel__c WHERE Alocacao__c = '${id}'`);
            if (responsavelCheck.totalSize > 0) {
                return res.status(400).json({ 
                    success: false, 
                    error: "Não é possível excluir: Existem responsabilidades vinculadas a esta alocação." 
                });
            }
        } catch (errResp) {
            console.warn("Skipping Responsavel__c check (Object might not exist):", errResp.message);
        }

        // Check if there are any LancamentoHora__c records linked to this Allocation via Responsavel__r
        try {
            const timesheetCheck = await conn.query(`SELECT Count() FROM LancamentoHora__c WHERE Responsavel__r.Alocacao__c = '${id}'`);
            if (timesheetCheck.totalSize > 0) {
                return res.status(400).json({ 
                    success: false, 
                    error: "Não é possível excluir: Existem horas lançadas para esta alocação." 
                });
            }
        } catch (errTime) {
             console.warn("Skipping Timesheet check (Field might not exist):", errTime.message);
        }

        // 1. Delete dependent OrcamentoCompetencia__c
        const orcs = await conn.query(`SELECT Id FROM OrcamentoCompetencia__c WHERE Alocacao__c = '${id}'`);
        if (orcs.totalSize > 0) {
            await conn.sobject('OrcamentoCompetencia__c').destroy(orcs.records.map(r => r.Id));
        }

        // 2. Delete Alocacao__c
        await conn.sobject('Alocacao__c').destroy(id);

        res.json({ success: true });
    } catch (e) {
        console.error("Delete Allocation Error:", e);
        res.status(500).json({ success: false, error: e.message });
    }
};

exports.deleteCommercialItem = async (req, res) => {
    const { id } = req.params;
    try {
        const conn = await getSfConnection();
        
        // 0. Verify dependencies (Active Allocations)
        const checkExec = await conn.query(`SELECT Count() FROM Alocacao__c WHERE AlocacaoPrevista__c = '${id}'`);
        if (checkExec.totalSize > 0) {
            return res.status(400).json({ 
                success: false, 
                error: "Não é possível excluir: Este item comercial está vinculado a alocações de recursos." 
            });
        }

        // 1. Delete dependent OrcamentoCompetencia__c
        const orcs = await conn.query(`SELECT Id FROM OrcamentoCompetencia__c WHERE AlocacaoPrevista__c = '${id}'`);
        if (orcs.totalSize > 0) {
            await conn.sobject('OrcamentoCompetencia__c').destroy(orcs.records.map(r => r.Id));
        }

        // 2. Delete AlocacaoPrevista__c
        await conn.sobject('AlocacaoPrevista__c').destroy(id);

        res.json({ success: true });
    } catch (e) {
        console.error("Delete Commercial Item Error:", e);
        res.status(500).json({ success: false, error: e.message });
    }
};

async function getMetadata() {
    const conn = await getSfConnection();
    let accounts = [], people = [], pricebooks = [], caClients = [];
    try { const r = await conn.query("SELECT Id, Name FROM Account ORDER BY Name ASC"); accounts = r.records.map(a => ({ id: a.Id, name: a.Name })); } catch(e) { console.error("Meta Acc Error:", e); }
    try { const r = await conn.query("SELECT Id, Name, Custo__c FROM Pessoa__c ORDER BY Name ASC"); people = r.records.map(p => ({ id: p.Id, name: p.Name, costRate: p.Custo__c || 0 })); } catch(e) { console.error("Meta Ppl Error:", e); }
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