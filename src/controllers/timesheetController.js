const { getSfConnection } = require('../config/salesforce');

// ==============================================================================
// HELPER FUNCTIONS
// ==============================================================================

async function calculateDailyStats(conn, userId, targetDate) {
    const dateStr = targetDate.includes('T') ? targetDate.split('T')[0] : targetDate;
    
    // 1. Busca DiaPeriodo e dados do contrato
    const diaQuery = `
        SELECT Id, Periodo__c, 
               Periodo__r.ContratoPessoa__r.Hora__c,
               Periodo__r.ContratoPessoa__r.Pessoa__r.HorasContrato__c
        FROM DiaPeriodo__c 
        WHERE Data__c = ${dateStr} 
        AND Periodo__r.ContratoPessoa__r.Pessoa__c = '${userId}'
        LIMIT 1
    `;

    let diaRes = [];
    try {
        const result = await conn.query(diaQuery);
        diaRes = result.records;
    } catch (e) {
        try {
            const result2 = await conn.query(`SELECT Id, Periodo__c, Periodo__r.ContratoPessoa__r.Hora__c FROM DiaPeriodo__c WHERE Data__c = '${dateStr}' AND Periodo__r.ContratoPessoa__r.Pessoa__c = '${userId}' LIMIT 1`);
            diaRes = result2.records;
        } catch (e2) {
            return { exists: false, diaPeriodoId: null, limiteDia: 8, usedNormal: 0, usedExtra: 0 };
        }
    }
    
    if (diaRes.length === 0) return { exists: false, diaPeriodoId: null, limiteDia: 8, usedNormal: 0, usedExtra: 0 };
    
    const diaRecord = diaRes[0];
    let limiteDia = 8;
    if (diaRecord.Periodo__r && diaRecord.Periodo__r.ContratoPessoa__r) {
        limiteDia = diaRecord.Periodo__r.ContratoPessoa__r.Hora__c || diaRecord.Periodo__r.ContratoPessoa__r.Pessoa__r?.HorasContrato__c || 8;
    }

    // 2. Soma horas já lançadas
    const somaQuery = `
        SELECT SUM(Horas__c) totalNormal, SUM(HorasExtras__c) totalExtra, SUM(HorasBanco__c) totalBanco
        FROM LancamentoHora__c 
        WHERE DiaPeriodo__c = '${diaRecord.Id}' 
        AND Pessoa__c = '${userId}'
    `;
    
    let usedNormal = 0, usedExtra = 0;
    try {
        const somaRes = await conn.query(somaQuery);
        if (somaRes.totalSize > 0) {
            usedNormal = somaRes.records[0].totalNormal || 0;
            const extraBanco = (somaRes.records[0].totalBanco > 0) ? somaRes.records[0].totalBanco : 0;
            usedExtra = (somaRes.records[0].totalExtra || 0) + extraBanco;
        }
    } catch (e) {}

    return { 
        exists: true, 
        diaPeriodoId: diaRecord.Id, 
        periodoId: diaRecord.Periodo__c, 
        limiteDia: limiteDia, 
        usedNormal: usedNormal, 
        usedExtra: usedExtra 
    };
}

async function getOrCreateResponsavel(conn, atividadeId, alocacaoId) {
    if (!atividadeId || !alocacaoId) return null;
    const query = `SELECT Id FROM Responsavel__c WHERE Atividade__c = '${atividadeId}' AND Alocacao__c = '${alocacaoId}' LIMIT 1`;
    const result = await conn.query(query);
    if (result.totalSize > 0) return result.records[0].Id;
    try {
        const novo = await conn.sobject('Responsavel__c').create({ Atividade__c: atividadeId, Alocacao__c: alocacaoId });
        return novo.id;
    } catch (e) { throw e; }
}

async function syncDiaPeriodoTotals(conn, diaPeriodoId) {
    if (!diaPeriodoId) return;
    
    const query = `
        SELECT Horas__c, HorasExtras__c, HorasBanco__c, HorasAusenciaRemunerada__c, HorasAusenciaNaoRemunerada__c 
        FROM LancamentoHora__c 
        WHERE DiaPeriodo__c = '${diaPeriodoId}'
    `;
    
    const result = await conn.query(query);
    
    let totalNormal = 0;
    let totalExtra = 0;
    let totalBanco = 0;
    let totalAusRem = 0;
    let totalAusNaoRem = 0;
    
    result.records.forEach(r => {
        totalNormal += (r.Horas__c || 0);
        totalExtra += (r.HorasExtras__c || 0);
        totalBanco += (r.HorasBanco__c || 0);
        totalAusRem += (r.HorasAusenciaRemunerada__c || 0);
        totalAusNaoRem += (r.HorasAusenciaNaoRemunerada__c || 0);
    });
    
    await conn.sobject('DiaPeriodo__c').update({
        Id: diaPeriodoId,
        Hora__c: totalNormal,
        HoraExtra__c: totalExtra,
        HoraBanco__c: totalBanco,
        HoraLicencaRemunerada__c: totalAusRem,
        HoraLicencaNaoRemunerada__c: totalAusNaoRem
    });
}

// ==============================================================================
// CONTROLLERS
// ==============================================================================

exports.renderTimesheetPage = async (req, res) => {
    const user = req.session.user;
    res.render('timesheet', { user: user, page: 'timesheet' });
};

exports.getUserPeriods = async (req, res) => {
    try {
        const conn = await getSfConnection();
        const userId = req.session.user.id;
        
        const query = `
            SELECT Id, Name, DataInicio__c, DataFim__c 
            FROM Periodo__c 
            WHERE ContratoPessoa__r.Pessoa__c = '${userId}' 
            ORDER BY DataInicio__c DESC 
            LIMIT 24
        `;
        const result = await conn.query(query);
        res.json(result.records); 
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
};

exports.getCalendarData = async (req, res) => {
    try {
        const conn = await getSfConnection();
        const userId = req.session.user.id;
        const { periodId } = req.query;

        if (!periodId) return res.status(400).json({ error: "PeriodId obrigatório." });

        const soqlDias = `SELECT Id, Name, Data__c, Tipo__c FROM DiaPeriodo__c WHERE Periodo__c = '${periodId}' ORDER BY Data__c ASC`;
        const soqlPeriodo = `SELECT Status__c, ContratoPessoa__r.Hora__c, ContratoPessoa__r.Pessoa__r.HorasContrato__c FROM Periodo__c WHERE Id = '${periodId}'`;
        
        const soqlLancamentos = `
            SELECT DiaPeriodo__r.Data__c, Status__c, Horas__c, HorasExtras__c, 
                   HorasAusenciaRemunerada__c, HorasAusenciaNaoRemunerada__c, HorasBanco__c
            FROM LancamentoHora__c
            WHERE DiaPeriodo__r.Periodo__c = '${periodId}' 
            AND Pessoa__c = '${userId}'
            AND (Horas__c > 0 OR HorasExtras__c > 0 OR HorasAusenciaRemunerada__c > 0 OR HorasAusenciaNaoRemunerada__c > 0 OR (HorasBanco__c != null AND HorasBanco__c != 0))
        `;

        const soqlSaldo = `SELECT SUM(HorasBanco__c) total FROM LancamentoHora__c WHERE Pessoa__c = '${userId}' AND HorasBanco__c != NULL AND HorasBanco__c != 0`;

        const [resDias, resLancamentos, resSaldo, resPeriodo] = await Promise.all([
            conn.query(soqlDias),
            conn.query(soqlLancamentos),
            conn.query(soqlSaldo),
            conn.query(soqlPeriodo)
        ]);

        let horasDiarias = 8; 
        let statusGeral = 'Aberto';
        if (resPeriodo.totalSize > 0) {
            const pRec = resPeriodo.records[0];
            statusGeral = pRec.Status__c || 'Aberto';
            if (pRec.ContratoPessoa__r) {
                horasDiarias = pRec.ContratoPessoa__r.Hora__c || pRec.ContratoPessoa__r.Pessoa__r?.HorasContrato__c || 8;
            }
        }

        const lancamentosMap = {};
        let totalLancadoNoPeriodo = 0;
        let totalBancoPeriodo = 0;

        resLancamentos.records.forEach(l => {
            const st = l.Status__c;
            const date = l.DiaPeriodo__r.Data__c;
            if (!lancamentosMap[date]) {
                lancamentosMap[date] = { statuses: new Set(), entries: [] };
            }
            
            const hNormais = l.Horas__c || 0;
            const hExtras = l.HorasExtras__c || 0;
            const hBanco = l.HorasBanco__c || 0;
            const hAusencias = (l.HorasAusenciaRemunerada__c || 0) + (l.HorasAusenciaNaoRemunerada__c || 0);

            totalLancadoNoPeriodo += (hNormais + hExtras + hAusencias);
            totalBancoPeriodo += hBanco;

            if (st) lancamentosMap[date].statuses.add(st);
            lancamentosMap[date].entries.push(l);
        });

        const calendarGrid = {};
        let diasUteisCount = 0;

        resDias.records.forEach(dia => {
            const date = dia.Data__c;
            const data = lancamentosMap[date] || { statuses: new Set(), entries: [] };
            
            const totalDia = data.entries.reduce((acc, curr) => 
                acc + (curr.Horas__c||0) + (curr.HorasExtras__c||0) + Math.abs(curr.HorasBanco__c||0) + (curr.HorasAusenciaRemunerada__c||0) + (curr.HorasAusenciaNaoRemunerada__c||0)
            , 0);

            let isDiaUtil = (dia.Tipo__c !== 'Feriado' && dia.Tipo__c !== 'Férias' && dia.Tipo__c !== 'Não Útil' && !dia.Name.toLowerCase().includes('sábado') && !dia.Name.toLowerCase().includes('domingo'));
            if (isDiaUtil) diasUteisCount++; 

            const statusList = Array.from(data.statuses).map(st => {
                if (st === 'Rascunho') return 'draft';
                if (st === 'Em aprovação do serviço') return 'submitted_service';
                if (st === 'Em aprovação do RH') return 'submitted_rh';
                if (st === 'Aprovado') return 'approved';
                if (st === 'Reprovado serviço') return 'rejected_service';
                if (st === 'Reprovado RH') return 'rejected_rh';
                if (st === 'Faturado') return 'billed';
                if (st === 'Fechado') return 'closed';
                return 'draft';
            });

            let statusDay = 'normal';
            let label = '';
            if (dia.Tipo__c === 'Feriado') { statusDay = 'holiday'; label = 'Feriado'; }
            else if (dia.Tipo__c === 'Férias') { statusDay = 'vacation'; label = 'Férias'; }
            else if (dia.Tipo__c === 'Não Útil') { statusDay = 'weekend'; }

            calendarGrid[date] = {
                id: dia.Id, date: date, weekday: dia.Name, total: totalDia,
                status_day: statusDay, label: label, status_list: statusList, entries: data.entries
            };
        });

        const totalContratado = horasDiarias * diasUteisCount;
        const saldoBancoTotal = (resSaldo.records && resSaldo.records[0] && resSaldo.records[0].total) ? resSaldo.records[0].total : 0;

        res.json({ periodId, grid: calendarGrid, summary: { totalContratado, totalRealizado: totalLancadoNoPeriodo, saldoBancoTotal, variacaoPeriodo: totalBancoPeriodo, statusGeral, limiteDiario: horasDiarias } });
    } catch (error) { res.status(500).json({ error: error.message }); }
};

exports.getDayDetails = async (req, res) => {
    try {
        const { date } = req.query;
        const userId = req.session.user.id;
        const conn = await getSfConnection();
        const dateStr = date.includes('T') ? date.split('T')[0] : date;

        const logsQuery = `
            SELECT Id, Horas__c, HorasExtras__c, HorasAusenciaRemunerada__c, HorasAusenciaNaoRemunerada__c, HorasBanco__c, 
                   Status__c, Servico__r.Name, Servico__c, Atividade__r.Name, Atividade__c, Justificativa__c, MotivoReprovacao__c 
            FROM LancamentoHora__c 
            WHERE Pessoa__c = '${userId}' AND DiaPeriodo__r.Data__c = ${dateStr}
        `;
        const logsRes = await conn.query(logsQuery);

        const diaQuery = `SELECT Id, Periodo__r.Status__c, Periodo__r.ContratoPessoa__r.Hora__c, Periodo__r.ContratoPessoa__r.Pessoa__r.HorasContrato__c FROM DiaPeriodo__c WHERE Data__c = ${dateStr} AND Periodo__r.ContratoPessoa__r.Pessoa__c = '${userId}' LIMIT 1`;
        let diaRes = await conn.query(diaQuery);
        if (diaRes.totalSize === 0) {
            diaRes = await conn.query(`SELECT Id, Periodo__r.Status__c, Periodo__r.ContratoPessoa__r.Hora__c, Periodo__r.ContratoPessoa__r.Pessoa__r.HorasContrato__c FROM DiaPeriodo__c WHERE Data__c = '${dateStr}' AND Periodo__r.ContratoPessoa__r.Pessoa__c = '${userId}' LIMIT 1`);
        }

        const entries = logsRes.records.map(l => ({
            id: l.Id, projectId: l.Servico__c, project: l.Servico__r ? l.Servico__r.Name : 'N/A',
            activityId: l.Atividade__c, activity: l.Atividade__r ? l.Atividade__r.Name : 'N/A',
            hours: (l.Horas__c||0), hoursExtra: (l.HorasExtras__c||0), hoursBank: (l.HorasBanco__c||0),
            hoursAbsence: (l.HorasAusenciaRemunerada__c||0) + (l.HorasAusenciaNaoRemunerada__c||0) + (l.HorasBanco__c < 0 ? Math.abs(l.HorasBanco__c) : 0),
            status: l.Status__c, reason: l.MotivoReprovacao__c, justification: l.Justificativa__c
        }));

        const uniqueStatuses = Array.from(new Set(logsRes.records.map(l => l.Status__c)));

        const soqlAlloc = `SELECT Id, Servico__r.Name, Servico__c, Percentual__c FROM Alocacao__c WHERE Pessoa__c = '${userId}' AND DataInicio__c <= ${dateStr} AND (DataFim__c >= ${dateStr} OR DataFim__c = NULL)`;
        const resAlloc = await conn.query(soqlAlloc);
        const allocations = resAlloc.records.map(r => ({ id: r.Servico__c, alocacaoId: r.Id, name: r.Servico__r.Name }));
        
        let activities = [];
        if(allocations.length > 0) {
            const servIds = allocations.map(a => `'${a.id}'`).join(',');
            const resAct = await conn.query(`SELECT Id, Name, Servico__c FROM Atividade__c WHERE Servico__c IN (${servIds}) ORDER BY Name ASC`);
            activities = resAct.records.map(r => ({ id: r.Id, name: r.Name, projectId: r.Servico__c }));
        }

        const pStatus = diaRes.records[0]?.Periodo__r?.Status__c || 'Aberto';
        const isLocked = pStatus !== 'Aberto';
        const limiteDiario = diaRes.records[0]?.Periodo__r?.ContratoPessoa__r?.Hora__c || diaRes.records[0]?.Periodo__r?.ContratoPessoa__r?.Pessoa__r?.HorasContrato__c || 8;

        res.json({ date: dateStr, allocations, activities, entries, isLocked, periodoStatus: pStatus, status_list: uniqueStatuses, diaPeriodoId: diaRes.records[0]?.Id, limiteDiario });
    } catch (e) { res.status(500).json({ error: e.message }); }
};

exports.saveEntry = async (req, res) => {
    try {
        const { entryId, diaPeriodoId, projectId, alocacaoId, activityId, activityName, hoursNormal, hoursExtra, hoursAbsence, reason, extraType, absenceType, date } = req.body;
        const userId = req.session.user.id;
        const conn = await getSfConnection();
        const dateStr = date.split('T')[0];

        const stats = await calculateDailyStats(conn, userId, dateStr);
        if(!stats.exists) return res.status(400).json({ success: false, message: 'Dia não encontrado no contrato.' });

        // TRAVAS DE SEGURANÇA
        if (entryId) {
            const oldLog = await conn.sobject('LancamentoHora__c').retrieve(entryId);
            if (!['Rascunho', 'Reprovado serviço', 'Reprovado RH'].includes(oldLog.Status__c)) {
                return res.status(400).json({ success: false, message: `Este lançamento (${oldLog.Status__c}) não pode ser editado.` });
            }
        } else {
            const pQuery = `SELECT Status__c FROM Periodo__c WHERE Id = '${stats.periodoId}' LIMIT 1`;
            const pRes = await conn.query(pQuery);
            const pStatus = pRes.records[0]?.Status__c;
            if (pStatus && pStatus !== 'Aberto') {
                return res.status(400).json({ success: false, message: `O período está ${pStatus}. Não é possível adicionar novos lançamentos.` });
            }
        }

        let oldVal = {n:0, e:0};
        if(entryId) {
            const old = await conn.sobject('LancamentoHora__c').retrieve(entryId);
            oldVal.n = old.Horas__c || 0;
            const oldBanco = old.HorasBanco__c > 0 ? old.HorasBanco__c : 0;
            oldVal.e = (old.HorasExtras__c || 0) + oldBanco;
        }

        const inNorm = Math.round((parseFloat(hoursNormal)||0) * 2) / 2;
        const inExtraVal = Math.round((parseFloat(hoursExtra)||0) * 2) / 2;
        const inAbs = Math.round((parseFloat(hoursAbsence)||0) * 2) / 2;

        let finalNorm = parseFloat(inNorm.toFixed(1));
        let finalExtra = 0;
        let finalBanco = 0;
        let finalAusRem = 0;
        let finalAusNaoRem = 0;
        let finalJust = reason||'';

        if(inExtraVal > 0) {
            const val = parseFloat(inExtraVal.toFixed(1));
            if(extraType === 'Banco') { finalBanco += val; if(!finalJust.includes('[Banco]')) finalJust = '[Banco] ' + finalJust; } 
            else { finalExtra = val; if(!finalJust.includes('[Extra]')) finalJust = '[Extra] ' + finalJust; }
        }
        if(inAbs > 0) {
            const val = parseFloat(inAbs.toFixed(1));
            if(absenceType === 'Banco') { finalBanco -= val; if(!finalJust.includes('[Aus.Banco]')) finalJust = '[Aus.Banco] ' + finalJust; }
            else if(absenceType === 'Abonada') finalAusRem = val;
            else finalAusNaoRem = val;
        }

        const newTotalNormal = (stats.usedNormal - oldVal.n) + finalNorm;
        const newBancoPos = finalBanco > 0 ? finalBanco : 0;
        const newTotalExtra = (stats.usedExtra - oldVal.e) + finalExtra + newBancoPos;

        if((newTotalNormal + newTotalExtra) > 24) return res.status(400).json({ success: false, message: 'Total > 24h.' });
        if(newTotalNormal > (stats.limiteDia + 0.1)) return res.status(400).json({ success: false, message: `Limite normal (${stats.limiteDia}h) excedido.` });

        let finalActivityId = activityId;
        if (!finalActivityId || finalActivityId === 'NEW') {
            const actCheck = await conn.query(`SELECT Id FROM Atividade__c WHERE Name = '${activityName}' AND Servico__c = '${projectId}' LIMIT 1`);
            if (actCheck.totalSize > 0) finalActivityId = actCheck.records[0].Id;
            else {
                const newAct = await conn.sobject('Atividade__c').create({ Name: activityName, Servico__c: projectId });
                finalActivityId = newAct.id;
            }
        }

        const payload = {
            Horas__c: finalNorm, HorasExtras__c: finalExtra, HorasBanco__c: finalBanco,
            HorasAusenciaRemunerada__c: finalAusRem, HorasAusenciaNaoRemunerada__c: finalAusNaoRem,
            Justificativa__c: finalJust, Status__c: 'Rascunho', MotivoReprovacao__c: null
        };

        if(entryId) {
            payload.Id = entryId;
            await conn.sobject('LancamentoHora__c').update(payload);
        } else {
            const responsavelId = await getOrCreateResponsavel(conn, finalActivityId, alocacaoId);
            payload.Pessoa__c = userId; payload.DiaPeriodo__c = stats.diaPeriodoId; payload.Periodo__c = stats.periodoId;
            payload.Servico__c = projectId; payload.Atividade__c = finalActivityId; payload.Responsavel__c = responsavelId;
            await conn.sobject('LancamentoHora__c').create(payload);
        }

        await syncDiaPeriodoTotals(conn, stats.diaPeriodoId);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

exports.deleteEntry = async (req, res) => {
    try {
        const { id } = req.params;
        const conn = await getSfConnection();
        const userId = req.session.user.id;
        const log = await conn.sobject('LancamentoHora__c').retrieve(id);
        if(log.Pessoa__c !== userId) return res.status(403).json({ success: false, message: 'Sem permissão.' });

        if(!['Rascunho', 'Reprovado serviço', 'Reprovado RH'].includes(log.Status__c)) {
            return res.status(400).json({ success: false, message: `Lançamento (${log.Status__c}) bloqueado para exclusão.` });
        }
        const diaPeriodoId = log.DiaPeriodo__c;
        await conn.sobject('LancamentoHora__c').destroy(id);
        await syncDiaPeriodoTotals(conn, diaPeriodoId);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

exports.submitDay = async (req, res) => {
    return res.status(405).json({ success: false, message: 'Envio por dia desativado. Use o envio por período.' });
};

exports.submitPeriod = async (req, res) => {
    try {
        const { periodId } = req.body;
        const userId = req.session.user.id;
        const conn = await getSfConnection();

        // 1. Busca todos os lançamentos que podem ser enviados
        const query = `
            SELECT Id 
            FROM LancamentoHora__c 
            WHERE Periodo__c = '${periodId}' 
            AND Pessoa__c = '${userId}' 
            AND Status__c IN ('Rascunho', 'Reprovado serviço', 'Reprovado RH')
        `;
        const result = await conn.query(query);
        
        // Mesmo que não existam lançamentos para atualizar, vamos atualizar o status do período
        // para garantir que ele mude conforme a ação do usuário.
        
        // 2. Atualiza Lançamentos se existirem
        if (result.totalSize > 0) {
            const updates = result.records.map(r => ({ Id: r.Id, Status__c: 'Em aprovação do serviço' }));
            await conn.sobject('LancamentoHora__c').update(updates);
        }

        // 3. Atualiza o Status do PERÍODO para 'Em aprovação do serviço'
        await conn.sobject('Periodo__c').update({
            Id: periodId,
            Status__c: 'Em aprovação do serviço'
        });

        res.json({ success: true, message: 'Lançamentos enviados e período encaminhado para aprovação!' });
    } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

exports.recallPeriod = async (req, res) => {
    try {
        const { periodId } = req.body;
        const userId = req.session.user.id;
        const conn = await getSfConnection();

        // 1. Busca todos os lançamentos que NÃO estão aprovados para resetar para Rascunho
        const query = `
            SELECT Id
            FROM LancamentoHora__c
            WHERE Periodo__c = '${periodId}'
            AND Pessoa__c = '${userId}'
            AND Status__c NOT IN ('Aprovado', 'Faturado', 'Fechado')
        `;
        const result = await conn.query(query);

        // 2. Volta Lançamentos para Rascunho se existirem
        if (result.totalSize > 0) {
            // Dividir em lotes de 200 para o Salesforce se necessário (jsforce cuida disso geralmente, mas garantimos)
            const updates = result.records.map(r => ({ Id: r.Id, Status__c: 'Rascunho' }));
            await conn.sobject('LancamentoHora__c').update(updates);
        }

        // 3. Volta o Status do PERÍODO para 'Aberto'
        await conn.sobject('Periodo__c').update({
            Id: periodId,
            Status__c: 'Aberto'
        });

        res.json({ success: true, message: 'Período e lançamentos reabertos para edição.' });
    } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};
