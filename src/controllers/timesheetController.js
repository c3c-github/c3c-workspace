const { getSfConnection } = require('../config/salesforce');

// 1. RENDERIZA A PÁGINA
exports.renderTimesheetPage = async (req, res) => {
    try {
        res.render('timesheet', { user: req.session.user, page: 'timesheet' });
    } catch (error) {
        console.error(error);
        res.render('negado', { mensagem: 'Erro ao carregar folha de ponto.' });
    }
};

// 2. API: BUSCAR PERÍODOS
exports.getUserPeriods = async (req, res) => {
    try {
        const conn = await getSfConnection();
        const userId = req.session.user.id;
        // Buscamos apenas os períodos para navegação
        const soql = `SELECT Id, Name, DataInicio__c, DataFim__c FROM Periodo__c WHERE ContratoPessoa__r.Pessoa__c = '${userId}' ORDER BY DataInicio__c DESC`;
        const result = await conn.query(soql);
        res.json(result.records);
    } catch (error) {
        res.status(500).json({ error: "Erro ao buscar períodos." });
    }
};

// 3. API: CALENDÁRIO (Resumo do Mês)
exports.getCalendarData = async (req, res) => {
    try {
        const conn = await getSfConnection();
        const userId = req.session.user.id;
        const { periodId } = req.query;

        if (!periodId) return res.status(400).json({ error: "PeriodId obrigatório." });

        // A. Dias
        const soqlDias = `SELECT Id, Name, Data__c, Tipo__c FROM DiaPeriodo__c WHERE Periodo__c = '${periodId}' ORDER BY Data__c ASC`;
        
        // B. Lançamentos (Para calcular o status visual de cada dia)
        const soqlLancamentos = `
            SELECT DiaPeriodo__r.Data__c, Status__c, Horas__c, HorasExtras__c, HorasAusenciaRemunerada__c, HorasAusenciaNaoRemunerada__c
            FROM LancamentoHora__c
            WHERE DiaPeriodo__r.Periodo__c = '${periodId}' AND Pessoa__c = '${userId}'
            AND (Horas__c > 0 OR HorasExtras__c > 0 OR HorasAusenciaRemunerada__c > 0 OR HorasAusenciaNaoRemunerada__c > 0)
        `;

        const [resDias, resLancamentos] = await Promise.all([
            conn.query(soqlDias),
            conn.query(soqlLancamentos)
        ]);

        const lancamentosMap = {};
        resLancamentos.records.forEach(l => {
            const date = l.DiaPeriodo__r.Data__c;
            if (!lancamentosMap[date]) lancamentosMap[date] = [];
            const total = (l.Horas__c||0) + (l.HorasExtras__c||0) + (l.HorasAusenciaRemunerada__c||0) + (l.HorasAusenciaNaoRemunerada__c||0);
            lancamentosMap[date].push({ status: l.Status__c, hours: total });
        });

        const calendarGrid = {};
        let totalHoursPeriod = 0;

        resDias.records.forEach(dia => {
            const date = dia.Data__c;
            const entries = lancamentosMap[date] || [];
            const totalDia = entries.reduce((acc, curr) => acc + curr.hours, 0);
            totalHoursPeriod += totalDia;

            // Lógica de Status do Dia (Baseado nos Lançamentos)
            let statusApproval = 'draft';
            const statuses = entries.map(e => e.status);

            if (statuses.includes('Reprovado')) statusApproval = 'rejected';
            else if (statuses.includes('Rascunho')) statusApproval = 'draft';
            else if (entries.length > 0) {
                if (statuses.every(s => s === 'Faturado')) statusApproval = 'billed';
                else if (statuses.every(s => s === 'Fechado')) statusApproval = 'closed';
                else if (statuses.every(s => ['Aprovado', 'Fechado', 'Faturado'].includes(s))) statusApproval = 'approved';
                else if (statuses.includes('Lançado')) statusApproval = 'submitted';
                else statusApproval = 'approved';
            } else {
                statusApproval = 'empty';
            }

            // Tipo de Dia
            let statusDay = 'normal';
            let label = '';
            if (dia.Tipo__c === 'Feriado') { statusDay = 'holiday'; label = 'Feriado'; }
            else if (dia.Tipo__c === 'Férias') { statusDay = 'vacation'; label = 'Férias'; }
            else if (dia.Tipo__c === 'Não Útil') { statusDay = 'weekend'; }

            calendarGrid[date] = {
                id: dia.Id,
                date: date,
                weekday: dia.Name,
                total: totalDia,
                status_day: statusDay,
                label: label,
                status_approval: statusApproval,
                entries: entries
            };
        });

        res.json({ periodId, grid: calendarGrid, summary: { totalRealizado: totalHoursPeriod } });

    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Erro interno." });
    }
};

// 4. API: DETALHES DO DIA
exports.getDayDetails = async (req, res) => {
    const { date } = req.query;
    const userId = req.session.user.id;

    if (!date) return res.status(400).json({ error: "Data obrigatória." });

    try {
        const conn = await getSfConnection();

        // A. Alocações
        const soqlAlloc = `
            SELECT Id, Servico__r.Name, Servico__c, Percentual__c
            FROM Alocacao__c
            WHERE Pessoa__c = '${userId}' 
            AND DataInicio__c <= ${date} 
            AND (DataFim__c >= ${date} OR DataFim__c = NULL)
        `;

        // B. Atividades Disponíveis
        const soqlActivities = `
            SELECT Id, Name, Servico__c, Servico__r.Name
            FROM Atividade__c
            WHERE Servico__c IN (
                SELECT Servico__c FROM Alocacao__c 
                WHERE Pessoa__c = '${userId}' AND DataInicio__c <= ${date} AND (DataFim__c >= ${date} OR DataFim__c = NULL)
            )
            AND DataInicio__c <= ${date} 
            AND (DataFim__c >= ${date} OR DataFim__c = NULL)
            ORDER BY Name ASC
        `;

        // C. Lançamentos Existentes
        const soqlEntries = `
            SELECT Id, Horas__c, HorasExtras__c, HorasAusenciaRemunerada__c, HorasAusenciaNaoRemunerada__c,
                   Status__c, Servico__r.Name, Atividade__r.Name, 
                   Justificativa__c, MotivoReprovacao__c
            FROM LancamentoHora__c
            WHERE Pessoa__c = '${userId}' AND DiaPeriodo__r.Data__c = ${date}
            AND (Horas__c > 0 OR HorasExtras__c > 0 OR HorasAusenciaRemunerada__c > 0 OR HorasAusenciaNaoRemunerada__c > 0)
        `;

        const [resAlloc, resAct, resEntries] = await Promise.all([
            conn.query(soqlAlloc),
            conn.query(soqlActivities),
            conn.query(soqlEntries)
        ]);

        const allocations = resAlloc.records.map(r => ({
            id: r.Servico__c, name: r.Servico__r.Name, percent: r.Percentual__c
        }));

        const activities = resAct.records.map(r => ({
            id: r.Id, name: r.Name, projectId: r.Servico__c
        }));

        const entries = resEntries.records.map(l => ({
            id: l.Id,
            project: l.Servico__r ? l.Servico__r.Name : 'N/A',
            activity: l.Atividade__r ? l.Atividade__r.Name : 'N/A',
            hours: (l.Horas__c||0) + (l.HorasExtras__c||0) + (l.HorasAusenciaRemunerada__c||0) + (l.HorasAusenciaNaoRemunerada__c||0),
            status: l.Status__c,
            reason: l.MotivoReprovacao__c
        }));

        res.json({ date, allocations, activities, entries });

    } catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message });
    }
};

// 5. API: SALVAR LANÇAMENTO
exports.saveEntry = async (req, res) => {
    const { 
        diaPeriodoId, projectId, activityId, activityName, 
        hoursNormal, hoursExtra, hoursAbsence, 
        reason, extraType, absenceType 
    } = req.body;
    
    const userId = req.session.user.id;

    if (!diaPeriodoId || !projectId || (!activityId && !activityName)) {
        return res.status(400).json({ success: false, message: 'Dados incompletos.' });
    }

    try {
        const conn = await getSfConnection();

        // 1. [ALTERADO] Não verificamos mais o Status do Período.
        // Apenas verificamos se o diaPeriodoId é válido.
        const checkRes = await conn.query(`SELECT Id FROM DiaPeriodo__c WHERE Id = '${diaPeriodoId}' LIMIT 1`);
        if (checkRes.totalSize === 0) return res.status(404).json({ success: false, message: 'Dia inválido.' });

        // 2. Resolve Atividade
        let finalActivityId = activityId;
        if (!finalActivityId) {
            const resAct = await conn.query(`SELECT Id FROM Atividade__c WHERE Name = '${activityName}' AND Servico__c = '${projectId}' LIMIT 1`);
            if (resAct.totalSize > 0) finalActivityId = resAct.records[0].Id;
            else {
                const newAct = await conn.sobject('Atividade__c').create({ Name: activityName, Servico__c: projectId });
                finalActivityId = newAct.id;
            }
        }

        // 3. Mapeia Ausências/Extras
        let valRemunerada = 0;
        let valNaoRemunerada = 0;
        let finalReason = reason || '';

        if (parseFloat(hoursAbsence) > 0) {
            if (absenceType === 'Abonada') valRemunerada = parseFloat(hoursAbsence);
            else valNaoRemunerada = parseFloat(hoursAbsence); // Desconto/Banco
            finalReason = `[AUSÊNCIA: ${absenceType}] ` + finalReason;
        }

        if (parseFloat(hoursExtra) > 0) {
            finalReason = `[EXTRA: ${extraType}] ` + finalReason;
        }

        // 4. Salva (Status Inicial = Rascunho)
        await conn.sobject('LancamentoHora__c').create({
            Pessoa__c: userId,
            DiaPeriodo__c: diaPeriodoId,
            Servico__c: projectId,
            Atividade__c: finalActivityId,
            Horas__c: parseFloat(hoursNormal)||0,
            HorasExtras__c: parseFloat(hoursExtra)||0,
            HorasAusenciaRemunerada__c: valRemunerada,
            HorasAusenciaNaoRemunerada__c: valNaoRemunerada,
            Justificativa__c: finalReason,
            Status__c: 'Rascunho'
        });

        res.json({ success: true });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// 6. API: EXCLUIR LANÇAMENTO
exports.deleteEntry = async (req, res) => {
    const { id } = req.params;
    try {
        const conn = await getSfConnection();
        // Verifica APENAS o status do Lançamento
        const check = await conn.query(`SELECT Id, Status__c FROM LancamentoHora__c WHERE Id = '${id}' LIMIT 1`);
        
        if (check.totalSize === 0) return res.status(404).json({ success: false, message: 'Não encontrado.' });
        
        // Bloqueia se já foi consolidado
        if (['Aprovado', 'Fechado', 'Faturado', 'Lançado'].includes(check.records[0].Status__c)) {
            return res.status(403).json({ success: false, message: 'Item bloqueado para exclusão.' });
        }

        await conn.sobject('LancamentoHora__c').destroy(id);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};