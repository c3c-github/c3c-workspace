const { getSfConnection } = require('../config/salesforce');

// ==============================================================================
// HELPER FUNCTIONS
// ==============================================================================

async function calculateDailyStats(conn, userId, targetDate) {
    const dateStr = targetDate.includes('T') ? targetDate.split('T')[0] : targetDate;
    
    // 1. Busca DiaPeriodo
    const diaQuery = `
        SELECT Id, Periodo__c, Periodo__r.ContratoPessoa__r.Hora__c 
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
    const limiteDia = (diaRecord.Periodo__r && diaRecord.Periodo__r.ContratoPessoa__r && diaRecord.Periodo__r.ContratoPessoa__r.Hora__c) ? diaRecord.Periodo__r.ContratoPessoa__r.Hora__c : 8;

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
        const soqlPeriodo = `SELECT ContratoPessoa__r.Hora__c FROM Periodo__c WHERE Id = '${periodId}'`;
        
        const soqlLancamentos = `
            SELECT DiaPeriodo__r.Data__c, Status__c, Horas__c, HorasExtras__c, 
                   HorasAusenciaRemunerada__c, HorasAusenciaNaoRemunerada__c, HorasBanco__c
            FROM LancamentoHora__c
            WHERE DiaPeriodo__r.Periodo__c = '${periodId}' 
            AND Pessoa__c = '${userId}'
            AND (Horas__c > 0 OR HorasExtras__c > 0 OR HorasAusenciaRemunerada__c > 0 OR HorasAusenciaNaoRemunerada__c > 0 OR (HorasBanco__c != null AND HorasBanco__c != 0))
        `;

        const soqlSaldo = `SELECT SUM(HorasBanco__c) total FROM LancamentoHora__c WHERE Pessoa__c = '${userId}' AND HorasBanco__c != null AND HorasBanco__c != 0`;

        const [resDias, resLancamentos, resSaldo, resPeriodo] = await Promise.all([
            conn.query(soqlDias),
            conn.query(soqlLancamentos),
            conn.query(soqlSaldo),
            conn.query(soqlPeriodo)
        ]);

        let horasDiarias = 8; 
        if (resPeriodo.totalSize > 0 && resPeriodo.records[0].ContratoPessoa__r && resPeriodo.records[0].ContratoPessoa__r.Hora__c) {
            horasDiarias = resPeriodo.records[0].ContratoPessoa__r.Hora__c;
        }

        const lancamentosMap = {};
        let totalLancadoNoPeriodo = 0;
        let totalBancoPeriodo = 0;
        const allStatuses = new Set();
        let hasEntries = false;

        resLancamentos.records.forEach(l => {
            hasEntries = true;
            if (l.Status__c) allStatuses.add(l.Status__c);

            const date = l.DiaPeriodo__r.Data__c;
            if (!lancamentosMap[date]) lancamentosMap[date] = { status: 'Rascunho', entries: [] };
            
            const hNormais = l.Horas__c || 0;
            const hExtras = l.HorasExtras__c || 0;
            const hBanco = l.HorasBanco__c || 0;
            const hAusencias = (l.HorasAusenciaRemunerada__c || 0) + (l.HorasAusenciaNaoRemunerada__c || 0);

            totalLancadoNoPeriodo += (hNormais + hExtras + hAusencias);
            totalBancoPeriodo += hBanco;

            const st = l.Status__c;
            if (st === 'Reprovado') lancamentosMap[date].status = 'Reprovado';
            else if (st === 'Rascunho' && lancamentosMap[date].status !== 'Reprovado') lancamentosMap[date].status = 'Rascunho';
            else if ((st === 'Lançado' || st === 'Submetido') && !['Reprovado', 'Rascunho'].includes(lancamentosMap[date].status)) lancamentosMap[date].status = 'Lançado'; 
            else if (!['Reprovado', 'Rascunho', 'Lançado', 'Submetido'].includes(lancamentosMap[date].status)) lancamentosMap[date].status = st;
            
            lancamentosMap[date].entries.push(l);
        });

        const calendarGrid = {};
        let diasUteisCount = 0;

        resDias.records.forEach(dia => {
            const date = dia.Data__c;
            const data = lancamentosMap[date] || { status: 'empty', entries: [] };
            
            const totalDia = data.entries.reduce((acc, curr) => 
                acc + (curr.Horas__c||0) + (curr.HorasExtras__c||0) + Math.abs(curr.HorasBanco__c||0) + (curr.HorasAusenciaRemunerada__c||0) + (curr.HorasAusenciaNaoRemunerada__c||0)
            , 0);

            let isDiaUtil = (dia.Tipo__c !== 'Feriado' && dia.Tipo__c !== 'Férias' && dia.Tipo__c !== 'Não Útil' && !dia.Name.toLowerCase().includes('sábado') && !dia.Name.toLowerCase().includes('domingo'));
            if (isDiaUtil) diasUteisCount++; 

            let statusApproval = 'draft';
            if (data.status === 'empty') statusApproval = 'empty';
            else if (data.status === 'Rascunho') statusApproval = 'draft';
            else if (data.status === 'Lançado' || data.status === 'Submetido') statusApproval = 'submitted';
            else if (data.status === 'Aprovado') statusApproval = 'approved';
            else if (data.status === 'Reprovado') statusApproval = 'rejected';
            else if (data.status === 'Faturado') statusApproval = 'billed';
            else if (data.status === 'Fechado') statusApproval = 'closed';

            let statusDay = 'normal';
            let label = '';
            if (dia.Tipo__c === 'Feriado') { statusDay = 'holiday'; label = 'Feriado'; }
            else if (dia.Tipo__c === 'Férias') { statusDay = 'vacation'; label = 'Férias'; }
            else if (dia.Tipo__c === 'Não Útil') { statusDay = 'weekend'; }

            calendarGrid[date] = {
                id: dia.Id, date: date, weekday: dia.Name, total: totalDia,
                status_day: statusDay, label: label, status_approval: statusApproval, entries: data.entries
            };
        });

        const totalContratado = horasDiarias * diasUteisCount;

        let statusGeral = 'Em Aberto';
        if (hasEntries) {
            if (allStatuses.has('Rascunho') || allStatuses.has('Reprovado')) statusGeral = 'Em Aberto';
            else if (allStatuses.has('Lançado') || allStatuses.has('Submetido')) statusGeral = 'Aguardando Aprovação';
            else if ([...allStatuses].every(s => ['Fechado', 'Faturado', 'Aprovado'].includes(s))) statusGeral = 'Aprovado';
        } else { statusGeral = 'Novo'; }

        const saldoBancoTotal = (resSaldo.length > 0 && resSaldo[0].total) ? resSaldo[0].total : 0;

        res.json({ periodId, grid: calendarGrid, summary: { totalContratado, totalRealizado: totalLancadoNoPeriodo, saldoBancoTotal, variacaoPeriodo: totalBancoPeriodo, statusGeral } });
    } catch (error) { res.status(500).json({ error: error.message }); }
};

exports.getDayDetails = async (req, res) => {
    try {
        const { date } = req.query;
        const userId = req.session.user.id;
        const conn = await getSfConnection();

        const logsQuery = `
            SELECT Id, Horas__c, HorasExtras__c, HorasAusenciaRemunerada__c, HorasAusenciaNaoRemunerada__c, HorasBanco__c, 
                   Status__c, Servico__r.Name, Servico__c, Atividade__r.Name, Atividade__c, Justificativa__c, MotivoReprovacao__c 
            FROM LancamentoHora__c 
            WHERE Pessoa__c = '${userId}' AND DiaPeriodo__r.Data__c = ${date}
        `;
        const logsRes = await conn.query(logsQuery);

        const diaQuery = `SELECT Id, Periodo__r.ContratoPessoa__r.Hora__c FROM DiaPeriodo__c WHERE Data__c = ${date} AND Periodo__r.ContratoPessoa__r.Pessoa__c = '${userId}' LIMIT 1`;
        const diaRes = await conn.query(diaQuery);
        
        const canEdit = !logsRes.records.some(l => !['Rascunho', 'Reprovado'].includes(l.Status__c));

        const soqlAlloc = `SELECT Id, Servico__r.Name, Servico__c, Percentual__c FROM Alocacao__c WHERE Pessoa__c = '${userId}' AND DataInicio__c <= ${date} AND (DataFim__c >= ${date} OR DataFim__c = NULL)`;
        const resAlloc = await conn.query(soqlAlloc);
        const allocations = resAlloc.records.map(r => ({ id: r.Servico__c, alocacaoId: r.Id, name: r.Servico__r.Name }));
        
        let activities = [];
        if(allocations.length > 0) {
            const servIds = allocations.map(a => `'${a.id}'`).join(',');
            const resAct = await conn.query(`SELECT Id, Name, Servico__c FROM Atividade__c WHERE Servico__c IN (${servIds}) ORDER BY Name ASC`);
            activities = resAct.records.map(r => ({ id: r.Id, name: r.Name, projectId: r.Servico__c }));
        }

        const entries = logsRes.records.map(l => ({
            id: l.Id, projectId: l.Servico__c, project: l.Servico__r ? l.Servico__r.Name : 'N/A',
            activityId: l.Atividade__c, activity: l.Atividade__r ? l.Atividade__r.Name : 'N/A',
            hours: (l.Horas__c||0), hoursExtra: (l.HorasExtras__c||0), hoursBank: (l.HorasBanco__c||0),
            hoursAbsence: (l.HorasAusenciaRemunerada__c||0) + (l.HorasAusenciaNaoRemunerada__c||0) + (l.HorasBanco__c < 0 ? Math.abs(l.HorasBanco__c) : 0),
            status: l.Status__c, reason: l.MotivoReprovacao__c, justification: l.Justificativa__c
        }));

        res.json({ date, allocations, activities, entries, isLocked: !canEdit, diaPeriodoId: diaRes.records[0]?.Id });
    } catch (e) { res.status(500).json({ error: e.message }); }
};

exports.saveEntry = async (req, res) => {
    try {
        const { entryId, diaPeriodoId, projectId, alocacaoId, activityId, activityName, hoursNormal, hoursExtra, hoursAbsence, reason, extraType, absenceType, date } = req.body;
        const userId = req.session.user.id;
        const conn = await getSfConnection();
        const dateStr = date.split('T')[0];

        // 1. Verifica Bloqueio do Dia (Novamente, para segurança)
        const checkQuery = `SELECT Id FROM LancamentoHora__c WHERE Pessoa__c='${userId}' AND DiaPeriodo__r.Data__c=${dateStr} AND Status__c NOT IN ('Rascunho','Reprovado') LIMIT 1`;
        const checkRes = await conn.query(checkQuery);
        if(checkRes.totalSize > 0) return res.status(400).json({ success: false, message: 'Dia fechado.' });

        // 2. Calcula Limites
        const stats = await calculateDailyStats(conn, userId, dateStr);
        if(!stats.exists) return res.status(400).json({ success: false, message: 'Dia não encontrado no contrato.' });

        // Recupera valores antigos se update
        let oldVal = {n:0, e:0};
        if(entryId) {
            const old = await conn.sobject('LancamentoHora__c').retrieve(entryId);
            oldVal.n = old.Horas__c || 0;
            const oldBanco = old.HorasBanco__c > 0 ? old.HorasBanco__c : 0;
            oldVal.e = (old.HorasExtras__c || 0) + oldBanco;
        }

        const inNorm = parseFloat(hoursNormal)||0;
        const inExtraVal = parseFloat(hoursExtra)||0;
        const inAbs = parseFloat(hoursAbsence)||0;

        let finalNorm=inNorm, finalExtra=0, finalBanco=0, finalAusRem=0, finalAusNaoRem=0, finalJust=reason||'';

        if(inExtraVal > 0) {
            if(extraType === 'Banco') { finalBanco += inExtraVal; if(!finalJust.includes('[Banco]')) finalJust = '[Banco] ' + finalJust; } 
            else { finalExtra = inExtraVal; if(!finalJust.includes('[Extra]')) finalJust = '[Extra] ' + finalJust; }
        }
        if(inAbs > 0) {
            if(absenceType === 'Banco') { finalBanco -= inAbs; if(!finalJust.includes('[Aus.Banco]')) finalJust = '[Aus.Banco] ' + finalJust; }
            else if(absenceType === 'Abonada') finalAusRem = inAbs;
            else finalAusNaoRem = inAbs;
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
        if(!['Rascunho','Reprovado'].includes(log.Status__c)) return res.status(400).json({ success: false, message: 'Item bloqueado.' });

        const checkQ = `SELECT Id FROM LancamentoHora__c WHERE Pessoa__c='${userId}' AND DiaPeriodo__c='${log.DiaPeriodo__c}' AND Status__c NOT IN ('Rascunho','Reprovado') LIMIT 1`;
        if((await conn.query(checkQ)).totalSize > 0) return res.status(400).json({ success: false, message: 'Dia fechado.' });

        await conn.sobject('LancamentoHora__c').destroy(id);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

exports.submitDay = async (req, res) => {
    try {
        const { date } = req.body;
        const userId = req.session.user.id;
        const conn = await getSfConnection();

        if (!date) return res.status(400).json({ success: false, message: 'Data inválida.' });

        // PADRONIZAÇÃO: Atualiza para 'Lançado'
        const query = `
            SELECT Id 
            FROM LancamentoHora__c 
            WHERE DiaPeriodo__r.Data__c = ${date} 
            AND Pessoa__c = '${userId}' 
            AND Status__c IN ('Rascunho', 'Reprovado')
        `;
        const result = await conn.query(query);

        if (result.totalSize === 0) return res.json({ success: true, message: 'Nada para enviar.' });

        const updates = result.records.map(r => ({ Id: r.Id, Status__c: 'Lançado' }));
        await conn.sobject('LancamentoHora__c').update(updates);

        res.json({ success: true, count: updates.length, message: 'Dia enviado para aprovação!' });
    } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

exports.submitPeriod = async (req, res) => {
    try {
        const { periodId } = req.body;
        const userId = req.session.user.id;
        const conn = await getSfConnection();

        // PADRONIZAÇÃO: Atualiza para 'Lançado'
        const query = `
            SELECT Id 
            FROM LancamentoHora__c 
            WHERE DiaPeriodo__r.Periodo__c = '${periodId}' 
            AND Pessoa__c = '${userId}' 
            AND Status__c IN ('Rascunho', 'Reprovado')
        `;
        const result = await conn.query(query);

        if (result.totalSize === 0) return res.json({ success: true, message: 'Período já enviado.' });

        const updates = result.records.map(r => ({ Id: r.Id, Status__c: 'Lançado' }));
        await conn.sobject('LancamentoHora__c').update(updates);

        res.json({ success: true, message: 'Folha enviada com sucesso!' });
    } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};