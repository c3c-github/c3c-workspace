const { getSfConnection } = require('../config/salesforce');

exports.getPeriods = async (req, res) => {
    try {
        const conn = await getSfConnection();
        const contrato = req.session.user.contrato;

        const result = await conn.query(`
            SELECT Id, Name, DataInicio__c, DataFim__c 
            FROM Periodo__c
            WHERE ContratoPessoa__r.Name = '${contrato}'
            ORDER BY DataFim__c DESC
        `);
        res.json(result.records);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
};

exports.getDashboardMetrics = async (req, res) => {
    try {
        const conn = await getSfConnection();
        const emailLider = req.session.user.email;
        const { inicio, fim } = req.query; 

        if (!inicio || !fim) return res.status(400).json({ error: 'Período obrigatório.' });

        const [resLancamentos, resAlocacao, resPeriodos] = await Promise.all([
            conn.query(`
                SELECT Status__c, SUM(Horas__c) total
                FROM LancamentoHora__c 
                WHERE Servico__r.Lider__r.Email__c = '${emailLider}'
                AND DiaPeriodo__r.Data__c >= ${inicio}
                AND DiaPeriodo__r.Data__c <= ${fim}
                AND (Horas__c > 0 OR HorasExtras__c > 0)
                GROUP BY Status__c
            `),
            conn.query(`
                SELECT SUM(HorasAlocadas__c) totalHorasDia, Pessoa__c
                FROM Alocacao__c 
                WHERE Servico__r.Lider__r.Email__c = '${emailLider}'
                AND DataInicio__c <= ${fim}
                AND (DataFim__c >= ${inicio} OR DataFim__c = NULL)
                GROUP BY Pessoa__c
            `),
            conn.query(`
                SELECT SUM(QuantidadeDiasUteis__c) diasUteis, ContratoPessoa__r.Pessoa__c pessoaId
                FROM Periodo__c
                WHERE DataInicio__c >= ${inicio}
                AND DataFim__c <= ${fim}
                GROUP BY ContratoPessoa__r.Pessoa__c
            `)
        ]);

        // Processamento (Idêntico ao original)
        const mapaDiasUteis = {};
        resPeriodos.records.forEach(row => {
            const id = row.pessoaId || row.expr1; 
            const dias = row.diasUteis || row.expr0 || 0;
            if(id) mapaDiasUteis[id] = dias;
        });

        let totalAlocadoGeral = 0;
        resAlocacao.records.forEach(row => {
            const pessoaId = row.Pessoa__c;
            const horasDia = row.totalHorasDia || row.expr0 || 0;
            const diasUteisPessoa = mapaDiasUteis[pessoaId] || 0;
            totalAlocadoGeral += (horasDia * diasUteisPessoa);
        });

        let totalLancadas = 0;
        let totalFaturaveis = 0;
        let totalPendentes = 0;
        
        resLancamentos.records.forEach(row => {
            const horas = row.total || row.expr0 || 0; 
            const status = row.Status__c;
            totalLancadas += horas;
            if (['Aprovado', 'Faturado'].includes(status)) totalFaturaveis += horas;
            if (['Lançado', 'Pendente'].includes(status)) totalPendentes += horas;
        });

        let eficiencia = 0;
        if (totalAlocadoGeral > 0) {
            eficiencia = Math.round((totalFaturaveis / totalAlocadoGeral) * 100);
        } else if (totalFaturaveis > 0) {
            eficiencia = 100; 
        }

        res.json({ totalAlocadas: totalAlocadoGeral, totalLancadas, eficiencia, totalPendentes });

    } catch (e) {
        console.error("Erro Metrics:", e);
        res.status(500).json({ error: e.message });
    }
};

exports.getProjects = async (req, res) => {
    try {
        const conn = await getSfConnection();
        const { inicio, fim } = req.query;
        const emailLider = req.session.user.email;

        if (!inicio || !fim) return res.status(400).json({ error: 'Período obrigatório.' });

        const [resHoras, resAlocacao, resDias] = await Promise.all([
            conn.query(`
                SELECT Servico__r.Id projetoId, Servico__r.Name projeto, Servico__r.Conta__r.Name conta, 
                       Status__c, SUM(Horas__c) totalHoras, SUM(HorasExtras__c) totalExtra
                FROM LancamentoHora__c 
                WHERE DiaPeriodo__r.Data__c >= ${inicio} AND DiaPeriodo__r.Data__c <= ${fim}
                AND Servico__r.Lider__r.Email__c = '${emailLider}'
                AND (Horas__c > 0 OR HorasExtras__c > 0)
                GROUP BY Servico__r.Id, Servico__r.Name, Servico__r.Conta__r.Name, Status__c
            `),
            conn.query(`
                SELECT Servico__c, Servico__r.Name nomeProjeto, Servico__r.Conta__r.Name nomeCliente, 
                       Pessoa__c, SUM(HorasAlocadas__c) horasDia
                FROM Alocacao__c 
                WHERE Servico__r.Lider__r.Email__c = '${emailLider}'
                AND DataInicio__c <= ${fim} AND (DataFim__c >= ${inicio} OR DataFim__c = NULL)
                GROUP BY Servico__c, Servico__r.Name, Servico__r.Conta__r.Name, Pessoa__c
            `),
            conn.query(`
                SELECT ContratoPessoa__r.Pessoa__c pessoaId, SUM(QuantidadeDiasUteis__c) dias
                FROM Periodo__c
                WHERE DataInicio__c >= ${inicio} AND DataFim__c <= ${fim}
                GROUP BY ContratoPessoa__r.Pessoa__c
            `)
        ]);

        const mapDias = {};
        resDias.records.forEach(r => mapDias[r.pessoaId || r.expr1] = r.dias || r.expr0 || 0);

        const projectsMap = {};
        
        // Mapeia Alocação
        resAlocacao.records.forEach(row => {
            const servicoId = row.Servico__c;
            const pessoaId = row.Pessoa__c;
            const nomeProjeto = row.nomeProjeto || 'Projeto'; 
            const nomeCliente = row.nomeCliente || 'Cliente';
            const horasDia = row.horasDia || row.expr0 || 0;
            const diasUteis = mapDias[pessoaId] || 0;

            if (!projectsMap[servicoId]) {
                projectsMap[servicoId] = {
                    serviceId: servicoId, serviceName: nomeProjeto, client: nomeCliente,
                    metrics: { alocado: 0, normal: 0, extra: 0, ponderado: 0 },
                    teamSize: 0, statusUI: 'Ok'
                };
            }
            projectsMap[servicoId].metrics.alocado += (horasDia * diasUteis);
            projectsMap[servicoId].teamSize += 1;
        });

        // Mapeia Realizado
        resHoras.records.forEach(row => {
            const id = row.projetoId;
            if (!projectsMap[id]) {
                projectsMap[id] = {
                    serviceId: id, serviceName: row.projeto, client: row.conta || 'Cliente',
                    metrics: { alocado: 0, normal: 0, extra: 0, ponderado: 0 },
                    teamSize: 0, statusUI: 'Ok'
                };
            }
            const hNormal = row.totalHoras || 0;
            const hExtra = row.totalExtra || 0;
            const status = row.Status__c;

            projectsMap[id].metrics.normal += hNormal;
            projectsMap[id].metrics.extra += hExtra;
            projectsMap[id].metrics.ponderado += (hNormal + (hExtra * 2));

            if (['Lançado', 'Pendente'].includes(status)) projectsMap[id].statusUI = 'Aberto';
        });

        const result = Object.values(projectsMap).map(p => {
            let percent = 0;
            if (p.metrics.alocado > 0) percent = Math.round((p.metrics.ponderado / p.metrics.alocado) * 100);
            else if (p.metrics.ponderado > 0) percent = 999;
            return { ...p, percentual: percent };
        });

        result.sort((a, b) => a.serviceName.localeCompare(b.serviceName));
        res.json(result);

    } catch (e) {
        console.error("Erro Projetos:", e);
        res.status(500).json({ error: e.message });
    }
};

exports.getProjectResources = async (req, res) => {
    try {
        const conn = await getSfConnection();
        const { serviceId } = req.params;
        const { inicio, fim } = req.query;
        const emailLider = req.session.user.email;

        // ... Lógica igual ao server.js original para Resources ...
        // (Resumindo para brevidade, mas deve conter a lógica completa do ROTA 3)
        
        // 1. Alocações
        const resAlocacao = await conn.query(`SELECT Pessoa__c, Pessoa__r.Name, SUM(HorasAlocadas__c) horasDia FROM Alocacao__c WHERE Servico__c = '${serviceId}' AND Servico__r.Lider__r.Email__c = '${emailLider}' AND DataInicio__c <= ${fim} AND (DataFim__c >= ${inicio} OR DataFim__c = NULL) GROUP BY Pessoa__c, Pessoa__r.Name`);
        
        // 2. Dias Úteis
        const resDias = await conn.query(`SELECT ContratoPessoa__r.Pessoa__c pessoaId, SUM(QuantidadeDiasUteis__c) dias FROM Periodo__c WHERE DataInicio__c >= ${inicio} AND DataFim__c <= ${fim} GROUP BY ContratoPessoa__r.Pessoa__c`);

        // 3. Lançamentos
        const resLancamentos = await conn.query(`SELECT Pessoa__c, Status__c, SUM(Horas__c) total, SUM(HorasExtras__c) totalExtra FROM LancamentoHora__c WHERE Servico__c = '${serviceId}' AND DiaPeriodo__r.Data__c >= ${inicio} AND DiaPeriodo__r.Data__c <= ${fim} AND (Horas__c > 0 OR HorasExtras__c > 0) GROUP BY Pessoa__c, Status__c`);

        // Processamento (Mesmo do original)
        const mapDias = {};
        resDias.records.forEach(r => mapDias[r.pessoaId || r.expr1] = r.dias || r.expr0 || 0);

        const resourcesMap = {};
        resAlocacao.records.forEach(row => {
            const pId = row.Pessoa__c;
            const pName = row.Name || row.Pessoa__r.Name || 'Sem Nome';
            const diasUteis = mapDias[pId] || 0;
            const horasDia = row.horasDia || row.expr0 || 0;

            resourcesMap[pId] = {
                id: pId, name: pName, alocado: horasDia * diasUteis,
                horasNormais: 0, horasExtras: 0, countPending: 0, countApproved: 0, countRejected: 0
            };
        });

        resLancamentos.records.forEach(row => {
            const pId = row.Pessoa__c;
            if (pId && resourcesMap[pId]) {
                const h = row.total || row.expr0 || 0;
                const hExtra = row.totalExtra || row.expr1 || 0;
                const status = row.Status__c;
                resourcesMap[pId].horasNormais += h;
                resourcesMap[pId].horasExtras += hExtra;
                if (['Lançado', 'Pendente'].includes(status)) resourcesMap[pId].countPending++;
                else if (['Aprovado', 'Faturado'].includes(status)) resourcesMap[pId].countApproved++;
                else if (['Reprovado'].includes(status)) resourcesMap[pId].countRejected++;
            }
        });

        const result = Object.values(resourcesMap).map(r => {
            const totalPonderado = r.horasNormais + (r.horasExtras * 2);
            let percentual = 0;
            if (r.alocado > 0) percentual = Math.round((totalPonderado / r.alocado) * 100);
            else if (totalPonderado > 0) percentual = 999;
            else percentual = 100;

            let statusClass = 'success';
            if (percentual > 105) statusClass = 'danger';
            else if (percentual < 95) statusClass = 'warning';
            return { ...r, totalPonderado, percentual, statusClass };
        });

        res.json(result);

    } catch (e) {
        res.status(500).json({ error: e.message });
    }
};

exports.getResourceActivities = async (req, res) => {
    try {
        const conn = await getSfConnection();
        const { serviceId, personId } = req.params;
        const { inicio, fim } = req.query;

        const result = await conn.query(`
            SELECT Atividade__r.Name, Status__c, SUM(Horas__c) total, SUM(HorasExtras__c) totalExtra
            FROM LancamentoHora__c 
            WHERE DiaPeriodo__r.Data__c >= ${inicio}
            AND DiaPeriodo__r.Data__c <= ${fim}
            AND Servico__c = '${serviceId}'
            AND Pessoa__c = '${personId}'
            AND (Horas__c > 0 OR HorasExtras__c > 0)
            GROUP BY Atividade__r.Name, Status__c
        `);

        const activities = result.records.map(r => ({
            atividade: r.Name || 'Sem Atividade',
            status: r.Status__c,
            total: r.total || r.expr0 || 0,
            extra: r.totalExtra || r.expr1 || 0
        }));
        res.json(activities);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
};

exports.handleApprovalAction = async (req, res) => {
    const { serviceId, personId, action, inicio, fim } = req.body;
    const novoStatus = (action === 'approve') ? 'Aprovado' : 'Reprovado';

    try {
        const conn = await getSfConnection();
        const soqlBusca = `
            SELECT Id FROM LancamentoHora__c 
            WHERE Servico__c = '${serviceId}' AND Pessoa__c = '${personId}'
            AND DiaPeriodo__r.Data__c >= ${inicio} AND DiaPeriodo__r.Data__c <= ${fim}
            AND Status__c IN ('Lançado', 'Pendente', 'Reprovado')
            AND (Horas__c > 0 OR HorasExtras__c > 0) 
        `;
        const resultBusca = await conn.query(soqlBusca);

        if (resultBusca.totalSize === 0) return res.json({ success: false, message: 'Nada para aprovar.' });

        const allUpdates = resultBusca.records.map(rec => ({ Id: rec.Id, Status__c: novoStatus }));
        
        // Simples update em lote (pode otimizar com batches se necessário)
        const results = await conn.update('LancamentoHora__c', allUpdates);
        
        const errors = results.filter(r => !r.success);
        if (errors.length > 0) return res.status(400).json({ success: false, message: 'Erro parcial.' });

        res.json({ success: true, message: 'Atualizado.' });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
};