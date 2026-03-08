const { getSfConnection } = require('../config/salesforce');
const fs = require('fs');
const extractionService = require('../services/extractionService');

/**
 * ============================================================================
 * PORTAL DO COLABORADOR (NOTAS FISCAIS)
 * ============================================================================
 */

exports.renderBillingPortal = (req, res) => {
    res.render('billing_portal', { user: req.session.user, page: 'billing_portal' });
};

exports.getColaboradorPeriods = async (req, res) => {
    try {
        const conn = await getSfConnection();
        const userId = req.session.user.id;

        // 1. Buscar os Períodos do Colaborador
        const query = `
            SELECT Id, Name, DataInicio__c, DataFim__c, Status__c, 
                   ValorTotalHoras__c, ValorTotalBeneficios__c, ValorTotalPeriodo__c
            FROM Periodo__c
            WHERE ContratoPessoa__r.Pessoa__c = '${userId}'
            AND (Status__c = 'Liberado para Nota Fiscal' OR Status__c = 'Nota em Validação' OR Status__c = 'Pronto para Pagamento' OR Status__c = 'Pagamento Agendado' OR Status__c = 'Finalizado/Pago')
            ORDER BY DataInicio__c DESC
        `;
        
        const result = await conn.query(query);
        const periods = result.records;

        if (periods.length === 0) return res.json([]);

        // 2. Buscar as Notas Fiscais separadamente para evitar erro de relacionamento (Relationship Name)
        const periodIds = periods.map(p => p.Id);
        const nfQuery = `
            SELECT Id, Periodo__c, Status__c, Valor__c, DocumentoId__c, MotivoReprovacao__c 
            FROM NotaFiscal__c 
            WHERE Periodo__c IN ('${periodIds.join("','")}') 
            AND Tipo__c = 'Entrada'
        `;
        const nfResult = await conn.query(nfQuery);
        const nfs = nfResult.records;
        
        // 3. Cruzar os dados
        const data = periods.map(p => {
            const nf = nfs.find(n => n.Periodo__c === p.Id);
            return {
                id: p.Id,
                name: p.Name,
                inicio: p.DataInicio__c,
                fim: p.DataFim__c,
                statusPeriodo: p.Status__c,
                valorHoras: p.ValorTotalHoras__c || 0,
                valorTotal: p.ValorTotalPeriodo__c || 0,
                hasNF: !!nf,
                nfStatus: nf ? nf.Status__c : null,
                nfDocumentoId: nf ? nf.DocumentoId__c : null,
                nfMotivo: nf ? nf.MotivoReprovacao__c : null
            };
        });

        res.json(data);
    } catch (e) {
        console.error("❌ Erro em getColaboradorPeriods:", e.message);
        res.status(500).json({ error: e.message });
    }
};

exports.uploadNotaFiscal = async (req, res) => {
    let tempPath = req.file ? req.file.path : null;
    try {
        if (!req.file) return res.status(400).json({ error: 'Arquivo não enviado.' });
        
        const { periodId, valor, cnpjEmissor, cnpjReceptor, numeroNota, dataEmissao, nomeEmitente } = req.body;
        const conn = await getSfConnection();
        const userId = req.session.user.id;
        const fileContent = fs.readFileSync(tempPath).toString('base64');

        // 1. Criar ContentVersion no Salesforce
        const cv = await conn.sobject('ContentVersion').create({
            Title: `NF_Entrada_${periodId}`,
            PathOnClient: req.file.originalname,
            VersionData: fileContent,
            IsMajorVersion: true
        });

        // 2. Recuperar ContentDocumentId
        const cvFull = await conn.sobject('ContentVersion').retrieve(cv.id);
        const docId = cvFull.ContentDocumentId;

        // 3. Verificar se já existe Nota Fiscal para este período
        const nfExistente = await conn.query(`SELECT Id FROM NotaFiscal__c WHERE Periodo__c = '${periodId}' AND Tipo__c = 'Entrada' LIMIT 1`);
        
        const payloadNF = {
            Periodo__c: periodId,
            Tipo__c: 'Entrada',
            Status__c: 'Em Revisão',
            Valor__c: parseFloat(valor),
            CNPJ_Emissor__c: cnpjEmissor,
            CNPJ_Receptor__c: cnpjReceptor,
            NumeroNota__c: numeroNota,
            DataEmissao__c: dataEmissao,
            NomeEmitente__c: nomeEmitente,
            DocumentoId__c: docId,
            MotivoReprovacao__c: null 
        };

        let nfId;
        if (nfExistente.totalSize > 0) {
            nfId = nfExistente.records[0].Id;
            payloadNF.Id = nfId;
            await conn.sobject('NotaFiscal__c').update(payloadNF);
        } else {
            const resultNF = await conn.sobject('NotaFiscal__c').create(payloadNF);
            nfId = resultNF.id;
        }

        // 4. Criar o vínculo do documento (ContentDocumentLink)
        await conn.sobject('ContentDocumentLink').create({
            ContentDocumentId: docId,
            LinkedEntityId: nfId,
            ShareType: 'V', // Viewer
            Visibility: 'AllUsers'
        });

        // 5. Atualizar Status do Período
        await conn.sobject('Periodo__c').update({
            Id: periodId,
            Status__c: 'Nota em Validação'
        });

        // Limpa arquivo temporário
        if (tempPath && fs.existsSync(tempPath)) fs.unlinkSync(tempPath);

        res.json({ success: true, message: 'Nota Fiscal enviada com sucesso!' });

    } catch (e) {
        console.error("❌ Erro upload NF:", e);
        if (tempPath && fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
        res.status(500).json({ error: e.message });
    }
};

exports.analyzeNotaFiscal = async (req, res) => {
    let tempPath = req.file ? req.file.path : null;
    try {
        if (!req.file) return res.status(400).json({ error: 'Arquivo não enviado.' });
        
        const fileContent = fs.readFileSync(tempPath).toString('base64');
        const mimeType = req.file.mimetype;

        const extraido = await extractionService.extrairDadosNota(fileContent, mimeType);

        // Limpa arquivo temporário
        if (tempPath && fs.existsSync(tempPath)) fs.unlinkSync(tempPath);

        res.json({ success: true, data: extraido });

    } catch (e) {
        console.error("❌ Erro análise NF:", e);
        if (tempPath && fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
        res.status(500).json({ error: e.message });
    }
};

/**
 * ============================================================================
 * MEDIÇÃO E FATURAMENTO (GESTOR / DIRETOR)
 * ============================================================================
 */

exports.renderBilling = (req, res) => {
    const user = req.session.user || { nome: 'Usuário', grupos: [] };
    res.render('billing', { user, page: 'billing' });
};

exports.renderPrintReport = async (req, res) => {
    try {
        const { serviceId, startDate, endDate, showValues } = req.query;
        if (!serviceId || !startDate || !endDate) return res.send('Parâmetros ausentes.');

        const conn = await getSfConnection();

        // 1. Dados do Serviço
        const svcResult = await conn.query(`
            SELECT Id, Name, Tipo__c, Conta__r.Name, 
                   Contrato__r.HorasContratadas__c, Contrato__r.Valor__c
            FROM Servico__c WHERE Id = '${serviceId}' LIMIT 1
        `);
        if (svcResult.totalSize === 0) return res.send('Serviço não encontrado.');
        const svc = svcResult.records[0];

        // 2. Buscar Lançamentos (Regra Condicional)
        let logsQuery = `
            SELECT Id, Horas__c, HorasExtras__c, HorasFaturar__c,
                   DiaPeriodo__r.Data__c, Atividade__r.Name,
                   Responsavel__r.Alocacao__r.Pessoa__r.Name,
                   Responsavel__r.Alocacao__r.AlocacaoPrevista__r.TaxaVenda__c
            FROM LancamentoHora__c
            WHERE Responsavel__r.Servico__c = '${serviceId}'
              AND DiaPeriodo__r.Data__c >= ${startDate}
              AND DiaPeriodo__r.Data__c <= ${endDate}
              AND (Horas__c > 0 OR HorasExtras__c > 0)
        `;

        if (svc.Tipo__c !== 'Suporte') {
            logsQuery += ` AND Responsavel__r.Alocacao__r.AlocacaoPrevista__c != null`;
        }

        logsQuery += ` ORDER BY DiaPeriodo__r.Data__c ASC`;
        
        const logsResult = await conn.query(logsQuery);
        
        const logs = logsResult.records.map(l => ({
            date: l.DiaPeriodo__r?.Data__c,
            resourceName: l.Responsavel__r?.Alocacao__r?.Pessoa__r?.Name || 'N/A',
            desc: l.Atividade__r?.Name || 'Sem atividade',
            logged: (l.Horas__c || 0) + 2 * (l.HorasExtras__c || 0),
            billable: l.HorasFaturar__c !== null && l.HorasFaturar__c !== undefined ? l.HorasFaturar__c : ((l.Horas__c || 0) + 2 * (l.HorasExtras__c || 0)),
            rate: l.Responsavel__r?.Alocacao__r?.AlocacaoPrevista__r?.TaxaVenda__c || 0
        }));

        res.render('billing_report_print', { 
            svc, 
            logs, 
            period: { start: startDate, end: endDate },
            showValues: showValues === 'true',
            user: req.session.user 
        });
    } catch (err) {
        res.status(500).send('Erro ao gerar relatório: ' + err.message);
    }
};

exports.getBillingGrid = async (req, res) => {
    try {
        const { startDate, endDate } = req.query;
        if (!startDate || !endDate) {
            return res.status(400).json({ success: false, error: 'Datas de início e fim são obrigatórias.' });
        }

        const user = req.session.user;
        const isDiretor = user.grupos && user.grupos.includes('DIRETOR');
        const isGestor = user.grupos && user.grupos.includes('GESTOR');
        
        if (!isDiretor && !isGestor) {
            return res.status(403).json({ success: false, error: 'Acesso negado.' });
        }

        const conn = await getSfConnection();

        // 1. Buscar Serviços ativos no período
        let servicesQuery = `
            SELECT Id, Name, Tipo__c, Conta__c, Conta__r.Name, 
                   Contrato__r.HorasContratadas__c, Contrato__r.Valor__c,
                   RequerRelatorioFaturamento__c, SolicitaRelatorioHoras__c
            FROM Servico__c
            WHERE (Tipo__c = 'Suporte' 
               OR Tipo__c = 'Alocação'
               OR RequerRelatorioFaturamento__c = true 
               OR SolicitaRelatorioHoras__c = true)
              AND DataInicio__c <= ${endDate}
              AND (DataFim__c >= ${startDate} OR DataFim__c = null)
        `;

        if (isGestor && !isDiretor) {
            servicesQuery += ` AND Lider__r.Email__c = '${user.email}'`;
        }

        const servicesResult = await conn.query(servicesQuery);
        const services = servicesResult.records;

        if (services.length === 0) return res.json([]);

        const serviceIds = services.map(s => s.Id);

        // 2. Buscar Alocações
        const allocationsQuery = `
            SELECT Id, Servico__c, Pessoa__c, DataInicio__c, DataFimOriginal__c, Percentual__c, AlocacaoPrevista__c
            FROM Alocacao__c
            WHERE Servico__c IN ('${serviceIds.join("','")}')
              AND DataInicio__c <= ${endDate}
              AND (DataFimOriginal__c >= ${startDate} OR DataFimOriginal__c = null)
        `;
        const allocationsResult = await conn.query(allocationsQuery);
        const allAllocations = allocationsResult.records;
        const peopleIds = [...new Set(allAllocations.map(a => a.Pessoa__c))];

        // 3. Buscar Carga Horária (DiaPeriodo)
        let dailyHours = [];
        if (peopleIds.length > 0) {
            const dailyQuery = `
                SELECT Pessoa__c, Data__c, Hora__c, Tipo__c,
                       Periodo__r.ContratoPessoa__r.Hora__c
                FROM DiaPeriodo__c
                WHERE Pessoa__c IN ('${peopleIds.join("','")}')
                  AND Data__c >= ${startDate}
                  AND Data__c <= ${endDate}
                  AND Tipo__c = 'Útil'
            `;
            const dailyResult = await conn.query(dailyQuery);
            dailyHours = dailyResult.records;
        }

        // 4. Buscar Lançamentos
        const logsQuery = `
            SELECT Id, Responsavel__r.Servico__c, Horas__c, HorasExtras__c, HorasFaturar__c,
                   DiaPeriodo__r.Data__c, Responsavel__r.Alocacao__r.AlocacaoPrevista__c,
                   Responsavel__r.Alocacao__r.AlocacaoPrevista__r.TaxaVenda__c
            FROM LancamentoHora__c
            WHERE Responsavel__r.Servico__c IN ('${serviceIds.join("','")}')
              AND DiaPeriodo__r.Data__c >= ${startDate}
              AND DiaPeriodo__r.Data__c <= ${endDate}
              AND (Horas__c > 0 OR HorasExtras__c > 0)
        `;
        const logsResult = await conn.query(logsQuery);
        const allLogs = logsResult.records;

        // 5. Processar grade
        const gridData = services.map(s => {
            const isSupport = s.Tipo__c === 'Suporte';
            
            const logs = allLogs.filter(l => {
                if (l.Responsavel__r.Servico__c !== s.Id) return false;
                if (!isSupport && l.Responsavel__r.Alocacao__r.AlocacaoPrevista__c === null) return false;
                return true;
            });

            const allocations = allAllocations.filter(a => {
                if (a.Servico__c !== s.Id) return false;
                if (!isSupport && a.AlocacaoPrevista__c === null) return false;
                return true;
            });
            
            let totalLogged = 0, totalBillable = 0, totalWeightedValue = 0;

            logs.forEach(l => {
                const logged = (l.Horas__c || 0) + 2 * (l.HorasExtras__c || 0);
                const billable = l.HorasFaturar__c !== null && l.HorasFaturar__c !== undefined ? l.HorasFaturar__c : logged;
                const rate = l.Responsavel__r?.Alocacao__r?.AlocacaoPrevista__r?.TaxaVenda__c || 0;
                totalLogged += logged;
                totalBillable += billable;
                totalWeightedValue += (billable * rate);
            });

            // NOVA REGRA DE TAXA (avgRate)
            let avgRate = 0;
            if (isSupport) {
                const contratoValor = s.Contrato__r?.Valor__c || 0;
                const contratoHoras = s.Contrato__r?.HorasContratadas__c || 0;
                avgRate = contratoHoras > 0 ? contratoValor / contratoHoras : 0;
            } else {
                avgRate = totalBillable > 0 ? totalWeightedValue / totalBillable : 0;
            }
            
            let franchise = 0;
            if (isSupport) {
                franchise = s.Contrato__r?.HorasContratadas__c || 0;
            } else {
                allocations.forEach(alloc => {
                    const personDaily = dailyHours.filter(d => d.Pessoa__c === alloc.Pessoa__c);
                    personDaily.forEach(day => {
                        const dayDate = day.Data__c;
                        const contractHours = day.Periodo__r?.ContratoPessoa__r?.Hora__c || day.Hora__c || 0;
                        if (contractHours > 0 && dayDate >= alloc.DataInicio__c && (!alloc.DataFimOriginal__c || dayDate <= alloc.DataFimOriginal__c)) {
                            franchise += contractHours * (alloc.Percentual__c / 100);
                        }
                    });
                });
            }

            // TOTAL FATURÁVEL: Para suporte, respeita o mínimo da franquia contratada
            const totalFaturavel = isSupport 
                ? avgRate * Math.max(totalBillable, franchise)
                : avgRate * totalBillable;

            return {
                id: s.Id,
                name: s.Name,
                client: s.Conta__r?.Name || 'N/A',
                clientId: s.Conta__c,
                type: s.Tipo__c,
                franchise: franchise,
                logged: totalLogged,
                billable: totalBillable,
                avgRate: avgRate,
                totalValue: totalFaturavel,
                status: 'open',
                flags: {
                    required: s.RequerRelatorioFaturamento__c,
                    requested: s.SolicitaRelatorioHoras__c
                }
            };
        });

        res.json(gridData);
    } catch (err) {
        console.error('Erro ao buscar dados de faturamento:', err);
        res.status(500).json({ success: false, error: err.message });
    }
};

exports.getServiceLogs = async (req, res) => {
    try {
        const { serviceId, startDate, endDate } = req.query;
        if (!serviceId || !startDate || !endDate) return res.json([]);
        const conn = await getSfConnection();
        const svcInfo = await conn.query(`SELECT Tipo__c FROM Servico__c WHERE Id = '${serviceId}' LIMIT 1`);
        const isSupport = svcInfo.records[0]?.Tipo__c === 'Suporte';

        let logsQuery = `
            SELECT Id, Horas__c, HorasExtras__c, HorasFaturar__c,
                   DiaPeriodo__r.Data__c, Atividade__r.Name,
                   Responsavel__r.Alocacao__r.Pessoa__r.Name,
                   Responsavel__r.Alocacao__r.AlocacaoPrevista__r.TaxaVenda__c
            FROM LancamentoHora__c
            WHERE Responsavel__r.Servico__c = '${serviceId}'
              AND DiaPeriodo__r.Data__c >= ${startDate}
              AND DiaPeriodo__r.Data__c <= ${endDate}
              AND (Horas__c > 0 OR HorasExtras__c > 0)
        `;
        if (!isSupport) logsQuery += ` AND Responsavel__r.Alocacao__r.AlocacaoPrevista__c != null`;
        logsQuery += ` ORDER BY DiaPeriodo__r.Data__c ASC`;

        const result = await conn.query(logsQuery);
        if (!result.records || result.records.length === 0) return res.json([]);
        const logs = result.records.map(l => ({
            id: l.Id,
            date: l.DiaPeriodo__r?.Data__c,
            resourceName: l.Responsavel__r?.Alocacao__r?.Pessoa__r?.Name || 'N/A',
            desc: l.Atividade__r?.Name || 'Sem atividade',
            logged: (l.Horas__c || 0) + 2 * (l.HorasExtras__c || 0),
            billable: l.HorasFaturar__c !== null && l.HorasFaturar__c !== undefined ? l.HorasFaturar__c : ((l.Horas__c || 0) + 2 * (l.HorasExtras__c || 0)),
            rate: l.Responsavel__r?.Alocacao__r?.AlocacaoPrevista__r?.TaxaVenda__c || 0
        }));
        res.json(logs);
    } catch (err) {
        console.error('Erro em getServiceLogs:', err);
        res.json([]);
    }
};

exports.saveAdjustments = async (req, res) => {
    try {
        const { serviceId, logs, reportData } = req.body;
        const conn = await getSfConnection();
        const updates = logs.map(l => ({ Id: l.id, HorasFaturar__c: l.billable }));
        await conn.sobject('LancamentoHora__c').update(updates);
        const report = {
            Servico__c: serviceId,
            Cliente__c: reportData.clientId,
            FranquiaPrevista__c: reportData.franchise,
            HorasLancadas__c: reportData.logged,
            HorasAFaturar__c: reportData.billable,
            Status__c: 'Em Ajuste'
        };
        const reportResult = await conn.sobject('RelatorioHorasFaturar__c').create(report);
        const reportId = reportResult.id;
        const junctions = logs.map(l => ({ RelatorioHorasFaturar__c: reportId, LancamentoHora__c: l.id }));
        await conn.sobject('RelatorioHorasFaturarLancamento__c').create(junctions);
        res.json({ success: true, reportId });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
};

/**
 * ============================================================================
 * COCKPIT FINANCEIRO (V1)
 * ============================================================================
 */

exports.renderFinanceDashboard = (req, res) => {
    res.render('finance_dashboard', { user: req.session.user, page: 'finance' });
};

exports.getFinancePeriods = async (req, res) => {
    try {
        const { startDate, endDate, status } = req.query;
        const conn = await getSfConnection();

        let filters = [`Status__c IN ('Nota em Validação', 'Pronto para Pagamento', 'Pagamento Agendado', 'Finalizado/Pago')`];
        if (startDate && endDate) filters.push(`DataInicio__c = ${startDate} AND DataFim__c = ${endDate}`);
        if (status) filters.push(`Status__c = '${status}'`);

        const query = `
            SELECT Id, Name, Status__c, ContratoPessoa__r.Pessoa__r.Name, ValorTotalPeriodo__c
            FROM Periodo__c
            WHERE ${filters.join(' AND ')}
            ORDER BY ContratoPessoa__r.Pessoa__r.Name ASC
        `;
        const result = await conn.query(query);
        
        res.json(result.records.map(p => ({
            id: p.Id,
            name: p.Name,
            status: p.Status__c,
            employeeName: p.ContratoPessoa__r?.Pessoa__r?.Name || 'N/A',
            value: p.ValorTotalPeriodo__c || 0
        })));
    } catch (e) { res.status(500).json({ error: e.message }); }
};

exports.updateFinanceStatus = async (req, res) => {
    try {
        const { periodIds, newStatus } = req.body;
        const conn = await getSfConnection();
        const updates = periodIds.map(id => ({ Id: id, Status__c: newStatus }));
        await conn.sobject('Periodo__c').update(updates);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
};
