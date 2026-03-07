const { getSfConnection } = require('../config/salesforce');

// --- HELPER: GARANTIR QUE EXISTE O BANCO DE HORAS PAI ---
async function getOrCreateBancoHoras(conn, pessoaId) {
    const query = `SELECT Id FROM BancoHoras__c WHERE Pessoa__c = '${pessoaId}' LIMIT 1`;
    const result = await conn.query(query);
    if (result.totalSize > 0) return result.records[0].Id;
    const novoBanco = await conn.sobject('BancoHoras__c').create({ Pessoa__c: pessoaId });
    if (novoBanco.success) return novoBanco.id;
    throw new Error("Falha ao criar Banco de Horas.");
}

// --- PAINEL UNIFICADO: GESTÃO DE PONTO & CICLO ---
exports.getHrEmployees = async (req, res) => {
    try {
        const conn = await getSfConnection();
        const { inicio, fim, statusPeriodo } = req.query;

        let wherePeriodo = `WHERE DataInicio__c = ${inicio} AND DataFim__c = ${fim}`;
        if (statusPeriodo) wherePeriodo += ` AND Status__c = '${statusPeriodo}'`;

        const soqlPeriodos = `
            SELECT Id, Name, Status__c, ContratoPessoa__r.Pessoa__c, ContratoPessoa__r.Pessoa__r.Name, 
                   ContratoPessoa__r.Cargo__c, QuantidadeDiasUteis__c, ContratoPessoa__r.Hora__c,
                   (SELECT Id FROM DiasPeriodo__r WHERE Tipo__c = 'Útil' AND DiaCompleto__c = false)
            FROM Periodo__c
            ${wherePeriodo}
        `;

        const filtroHoras = `(Horas__c > 0 OR HorasExtras__c > 0 OR (HorasBanco__c != 0 AND HorasBanco__c != null) OR HorasAusenciaRemunerada__c > 0 OR HorasAusenciaNaoRemunerada__c > 0)`;

        const soqlAgregado = `
            SELECT DiaPeriodo__r.Periodo__c, Status__c,
                   SUM(Horas__c) normal, SUM(HorasExtras__c) extra, SUM(HorasBanco__c) banco,
                   SUM(HorasAusenciaRemunerada__c) ausRem, SUM(HorasAusenciaNaoRemunerada__c) ausNaoRem
            FROM LancamentoHora__c 
            WHERE DiaPeriodo__r.Data__c >= ${inicio} AND DiaPeriodo__r.Data__c <= ${fim}
            AND ${filtroHoras}
            GROUP BY DiaPeriodo__r.Periodo__c, Status__c
        `;

        const [resPeriodos, resAgregado] = await Promise.all([
            conn.query(soqlPeriodos), conn.query(soqlAgregado)
        ]);

        const periodDataMap = {};
        resPeriodos.records.forEach(p => {
            periodDataMap[p.Id] = { pendingRH: 0, pendingService: 0, totalRealizado: 0 };
        });

        resAgregado.records.forEach(r => {
            const data = periodDataMap[r.Periodo__c];
            if (!data) return;
            if (r.Status__c === 'Em aprovação do RH') data.pendingRH += 1;
            if (r.Status__c === 'Em aprovação do serviço' || r.Status__c === 'Rascunho') data.pendingService += 1;
            data.totalRealizado += (r.normal||0) + (r.extra||0) + Math.abs(r.banco||0) + (r.ausRem||0) + (r.ausNaoRem||0);
        });

        const tableData = resPeriodos.records.map(per => {
            const data = periodDataMap[per.Id];
            const contractHours = (per.QuantidadeDiasUteis__c || 0) * (per.ContratoPessoa__r?.Hora__c || 8);
            const incompleteDays = per.DiasPeriodo__r ? per.DiasPeriodo__r.totalSize : 0;

            return {
                id: per.ContratoPessoa__r?.Pessoa__c,
                periodId: per.Id,
                name: per.ContratoPessoa__r?.Pessoa__r?.Name || 'Desconhecido',
                role: per.ContratoPessoa__r?.Cargo__c || 'Consultor',
                total: data ? data.totalRealizado : 0,
                contract: contractHours,
                statusPeriodo: per.Status__c,
                incompleteDays: incompleteDays,
                hasLogsPendingRH: data ? data.pendingRH > 0 : false
            };
        });

        const funnelQuery = `SELECT Status__c, COUNT(Id) total FROM Periodo__c WHERE DataInicio__c = ${inicio} AND DataFim__c = ${fim} GROUP BY Status__c`;
        const resFunnel = await conn.query(funnelQuery);

        res.json({ funnel: resFunnel.records, data: tableData });
    } catch (e) { res.status(500).json({ error: e.message }); }
};

exports.advancePeriodStatus = async (req, res) => {
    try {
        const { periodIds } = req.body;
        const conn = await getSfConnection();
        const periods = await conn.query(`SELECT Id, Status__c FROM Periodo__c WHERE Id IN ('${periodIds.join("','")}')`);
        const periodUpdates = [];
        const logUpdates = [];

        for (const p of periods.records) {
            // VALIDAÇÃO: Não permite avançar se houver lançamentos reprovados
            const rejectedLogs = await conn.query(`SELECT Id FROM LancamentoHora__c WHERE Periodo__c = '${p.Id}' AND (Status__c = 'Reprovado serviço' OR Status__c = 'Reprovado RH') LIMIT 1`);
            if (rejectedLogs.totalSize > 0) {
                return res.status(400).json({ success: false, error: `O período de um ou mais colaboradores possui lançamentos reprovados e não pode avançar.` });
            }

            let nextStatus = '';
            let nextLogStatus = '';
            if (p.Status__c === 'Aberto') {
                nextStatus = 'Aguardando Aprovação Líder';
                nextLogStatus = 'Em aprovação do serviço';
            } else if (p.Status__c === 'Aguardando Aprovação Líder') {
                nextStatus = 'Aguardando Aprovação RH';
                nextLogStatus = 'Em aprovação do RH';
            } else if (p.Status__c === 'Aguardando Aprovação RH') {
                nextStatus = 'Liberado para Nota Fiscal';
                nextLogStatus = 'Aprovado';
            }

            if (nextStatus) {
                periodUpdates.push({ Id: p.Id, Status__c: nextStatus });
                const logsRes = await conn.query(`SELECT Id FROM LancamentoHora__c WHERE Periodo__c = '${p.Id}' AND Status__c != '${nextLogStatus}'`);
                logsRes.records.forEach(l => logUpdates.push({ Id: l.Id, Status__c: nextLogStatus }));
            }
        }

        if (periodUpdates.length > 0) await conn.sobject('Periodo__c').update(periodUpdates);
        if (logUpdates.length > 0) {
            for (let i = 0; i < logUpdates.length; i += 200) {
                await conn.sobject('LancamentoHora__c').update(logUpdates.slice(i, i + 200));
            }
        }
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
};

exports.regressPeriodStatus = async (req, res) => {
    try {
        const { periodIds } = req.body;
        const conn = await getSfConnection();
        const periods = await conn.query(`SELECT Id, Status__c FROM Periodo__c WHERE Id IN ('${periodIds.join("','")}')`);
        const periodUpdates = [];
        const logUpdates = [];

        for (const p of periods.records) {
            let prevStatus = '';
            let prevLogStatus = '';
            if (p.Status__c === 'Aguardando Aprovação Líder') { prevStatus = 'Aberto'; prevLogStatus = 'Rascunho'; }
            else if (p.Status__c === 'Aguardando Aprovação RH') { prevStatus = 'Aguardando Aprovação Líder'; prevLogStatus = 'Em aprovação do serviço'; }
            else if (p.Status__c === 'Liberado para Nota Fiscal') { prevStatus = 'Aguardando Aprovação RH'; prevLogStatus = 'Em aprovação do RH'; }

            if (prevStatus) {
                periodUpdates.push({ Id: p.Id, Status__c: prevStatus });
                const logs = await conn.query(`SELECT Id FROM LancamentoHora__c WHERE Periodo__c = '${p.Id}' AND Status__c != '${prevLogStatus}'`);
                logs.records.forEach(l => logUpdates.push({ Id: l.Id, Status__c: prevLogStatus }));
            }
        }

        if (periodUpdates.length > 0) await conn.sobject('Periodo__c').update(periodUpdates);
        if (logUpdates.length > 0) {
            for (let i = 0; i < logUpdates.length; i += 200) {
                await conn.sobject('LancamentoHora__c').update(logUpdates.slice(i, i + 200));
            }
        }
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
};

exports.getEmployeeDetails = async (req, res) => {
    try {
        const conn = await getSfConnection();
        const { personId } = req.params;
        const { inicio, fim } = req.query;
        const filtroHoras = `(Horas__c > 0 OR HorasExtras__c > 0 OR (HorasBanco__c != 0 AND HorasBanco__c != null) OR HorasAusenciaRemunerada__c > 0 OR HorasAusenciaNaoRemunerada__c > 0)`;
        const result = await conn.query(`
            SELECT Id, DiaPeriodo__r.Data__c, Servico__r.Name, Atividade__r.Name, Justificativa__c, Status__c, MotivoReprovacao__c,
                   Horas__c, HorasExtras__c, HorasBanco__c, HorasAusenciaRemunerada__c, HorasAusenciaNaoRemunerada__c
            FROM LancamentoHora__c 
            WHERE Pessoa__c = '${personId}' AND DiaPeriodo__r.Data__c >= ${inicio} AND DiaPeriodo__r.Data__c <= ${fim} AND ${filtroHoras}
            ORDER BY DiaPeriodo__r.Data__c ASC
        `);

        let sumNormal = 0, sumExtra = 0, sumBanco = 0, sumAusencia = 0;
        const logs = result.records.map(r => {
            const hN = r.Horas__c || 0; const hE = r.HorasExtras__c || 0; const hB = r.HorasBanco__c || 0; const hA = (r.HorasAusenciaRemunerada__c || 0) + (r.HorasAusenciaNaoRemunerada__c || 0);
            sumNormal += hN; sumExtra += hE; sumBanco += hB; sumAusencia += hA;
            return {
                id: r.Id, date: r.DiaPeriodo__r?.Data__c, project: r.Servico__r?.Name, activity: r.Atividade__r?.Name,
                justification: r.Justificativa__c, reason: r.MotivoReprovacao__c, status: r.Status__c,
                normal: hN, extraPgto: hE, banco: hB, ausencia: hA
            };
        });

        const resMeta = await conn.query(`SELECT QuantidadeDiasUteis__c, ContratoPessoa__r.Hora__c FROM Periodo__c WHERE ContratoPessoa__r.Pessoa__c = '${personId}' AND DataInicio__c >= ${inicio} AND DataFim__c <= ${fim} LIMIT 1`);
        let contractHours = 0;
        if (resMeta.totalSize > 0) contractHours = (resMeta.records[0].QuantidadeDiasUteis__c || 0) * (resMeta.records[0].ContratoPessoa__r?.Hora__c || 8);

        res.json({ logs, summary: { normal: sumNormal, extra: sumExtra, banco: sumBanco, ausencia: sumAusencia, totalRealizado: sumNormal + sumExtra + Math.abs(sumBanco) + sumAusencia, contract: contractHours } });
    } catch (e) { res.status(500).json({ error: e.message }); }
};

exports.handleHrAction = async (req, res) => {
    const { personId, action, inicio, fim, motivo, entryIds } = req.body;
    const novoStatus = (action === 'approve') ? 'Aprovado' : 'Reprovado RH';
    
    try {
        const conn = await getSfConnection();
        let updates = [];
        let affectedPeriodIds = new Set();

        if (entryIds && Array.isArray(entryIds) && entryIds.length > 0) {
            // AÇÃO EM LOGS ESPECÍFICOS
            updates = entryIds.map(id => ({ Id: id, Status__c: novoStatus, MotivoReprovacao__c: action === 'reject' ? motivo : null }));
            // Busca os períodos destes logs (usando ambos os caminhos por segurança)
            const logsInfo = await conn.query(`SELECT Periodo__c, DiaPeriodo__r.Periodo__c FROM LancamentoHora__c WHERE Id IN ('${entryIds.join("','")}')`);
            logsInfo.records.forEach(r => { 
                const pId = r.Periodo__c || r.DiaPeriodo__r?.Periodo__c;
                if(pId) affectedPeriodIds.add(pId); 
            });
        } else {
            // AÇÃO NO COLABORADOR INTEIRO
            const query = `SELECT Id, Periodo__c, DiaPeriodo__r.Periodo__c FROM LancamentoHora__c WHERE Pessoa__c = '${personId}' AND DiaPeriodo__r.Data__c >= ${inicio} AND DiaPeriodo__r.Data__c <= ${fim} AND Status__c = 'Em aprovação do RH'`;
            const result = await conn.query(query);
            updates = result.records.map(r => ({ Id: r.Id, Status__c: novoStatus, MotivoReprovacao__c: action === 'reject' ? motivo : null }));
            result.records.forEach(r => { 
                const pId = r.Periodo__c || r.DiaPeriodo__r?.Periodo__c;
                if(pId) affectedPeriodIds.add(pId); 
            });
        }

        if (updates.length > 0) {
            await conn.sobject('LancamentoHora__c').update(updates);
            
            // LOGICA DE EVOLUÇÃO / RETROCESSO DO PERÍODO
            if (action === 'reject' && affectedPeriodIds.size > 0) {
                // REABRE SE REPROVAR
                const periodUpdates = Array.from(affectedPeriodIds).map(id => ({ Id: id, Status__c: 'Aberto' }));
                await conn.sobject('Periodo__c').update(periodUpdates);
            } else if (action === 'approve' && affectedPeriodIds.size > 0) {
                // VERIFICA SE PODE LIBERAR P/ NF SE APROVAR
                for (const periodId of affectedPeriodIds) {
                    const checkPending = await conn.query(`SELECT Id FROM LancamentoHora__c WHERE Periodo__c = '${periodId}' AND Status__c != 'Aprovado' LIMIT 1`);
                    if (checkPending.totalSize === 0) {
                        await conn.sobject('Periodo__c').update({ Id: periodId, Status__c: 'Liberado para Nota Fiscal' });
                    }
                }
            }
        } else if (action === 'reject' && personId !== 'MASS') {
            // FALLBACK: Se não encontrou logs pendentes mas o RH clicou em reprovar na linha,
            // força a reabertura do período atual daquela pessoa.
            const periodRes = await conn.query(`SELECT Id FROM Periodo__c WHERE ContratoPessoa__r.Pessoa__c = '${personId}' AND DataInicio__c = ${inicio} AND DataFim__c = ${fim} LIMIT 1`);
            if (periodRes.totalSize > 0) {
                await conn.sobject('Periodo__c').update({ Id: periodRes.records[0].Id, Status__c: 'Aberto' });
            }
        }
        res.json({ success: true, message: updates.length > 0 ? `${updates.length} lançamentos processados.` : "Período reaberto para correção." });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
};

exports.renderHrDashboard = (req, res) => {
    res.render('hr_dashboard', { user: req.session.user, page: 'hr' });
};
