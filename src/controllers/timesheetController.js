const { getSfConnection } = require('../config/salesforce');

// --- HELPER: Vínculo de Responsável (Atividade x Alocação) ---
async function getOrCreateResponsavel(conn, atividadeId, alocacaoId) {
    if (!atividadeId || !alocacaoId) return null;

    const query = `SELECT Id FROM Responsavel__c WHERE Atividade__c = '${atividadeId}' AND Alocacao__c = '${alocacaoId}' LIMIT 1`;
    const result = await conn.query(query);

    if (result.totalSize > 0) return result.records[0].Id;

    try {
        const novo = await conn.sobject('Responsavel__c').create({
            Atividade__c: atividadeId,
            Alocacao__c: alocacaoId
        });
        if (novo.success) return novo.id;
        throw new Error(JSON.stringify(novo.errors));
    } catch (e) {
        console.error("Erro ao criar Responsável:", e);
        return null;
    }
}

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
        const soql = `SELECT Id, Name, DataInicio__c, DataFim__c FROM Periodo__c WHERE ContratoPessoa__r.Pessoa__c = '${userId}' ORDER BY DataInicio__c DESC`;
        const result = await conn.query(soql);
        res.json(result.records);
    } catch (error) {
        res.status(500).json({ error: "Erro ao buscar períodos." });
    }
};

// 3. API: CALENDÁRIO (RESUMO MENSAL)
exports.getCalendarData = async (req, res) => {
    try {
        const conn = await getSfConnection();
        const userId = req.session.user.id;
        const { periodId } = req.query;

        if (!periodId) return res.status(400).json({ error: "PeriodId obrigatório." });

        // Queries em paralelo
        const soqlDias = `SELECT Id, Name, Data__c, Tipo__c FROM DiaPeriodo__c WHERE Periodo__c = '${periodId}' ORDER BY Data__c ASC`;
        const soqlPeriodo = `SELECT ContratoPessoa__r.Hora__c FROM Periodo__c WHERE Id = '${periodId}'`;
        
        const soqlLancamentos = `
            SELECT DiaPeriodo__r.Data__c, Status__c, Horas__c, HorasExtras__c, 
                   HorasAusenciaRemunerada__c, HorasAusenciaNaoRemunerada__c, HorasBanco__c
            FROM LancamentoHora__c
            WHERE DiaPeriodo__r.Periodo__c = '${periodId}' 
            AND Pessoa__c = '${userId}'
            AND (
                Horas__c > 0 
                OR HorasExtras__c > 0 
                OR HorasAusenciaRemunerada__c > 0 
                OR HorasAusenciaNaoRemunerada__c > 0 
                OR (HorasBanco__c != null AND HorasBanco__c != 0)
            )
        `;

        const soqlSaldo = `SELECT SUM(HorasBanco__c) total FROM LancamentoHora__c WHERE Pessoa__c = '${userId}' AND HorasBanco__c != null AND HorasBanco__c != 0`;

        const [resDias, resLancamentos, resSaldo, resPeriodo] = await Promise.all([
            conn.query(soqlDias),
            conn.query(soqlLancamentos),
            conn.query(soqlSaldo),
            conn.query(soqlPeriodo)
        ]);

        // === LÓGICA DE CONTRATO (CORRIGIDA) ===
        // 1. Obtém Carga Horária Diária
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
            if (!lancamentosMap[date]) lancamentosMap[date] = [];
            
            const hNormais = l.Horas__c || 0;
            const hExtras = l.HorasExtras__c || 0;
            const hBanco = l.HorasBanco__c || 0;
            const hAusencias = (l.HorasAusenciaRemunerada__c || 0) + (l.HorasAusenciaNaoRemunerada__c || 0);

            const totalItem = hNormais + hExtras + hAusencias + Math.abs(hBanco);
            
            totalLancadoNoPeriodo += (hNormais + hExtras + hAusencias);
            totalBancoPeriodo += hBanco;

            lancamentosMap[date].push({ status: l.Status__c, hours: totalItem });
        });

        const calendarGrid = {};
        let diasUteisCount = 0;

        // 2. Conta Dias Úteis no Período
        resDias.records.forEach(dia => {
            const date = dia.Data__c;
            const entries = lancamentosMap[date] || [];
            const totalDia = entries.reduce((acc, curr) => acc + curr.hours, 0);

            let isDiaUtil = (dia.Tipo__c !== 'Feriado' && dia.Tipo__c !== 'Férias' && dia.Tipo__c !== 'Não Útil' && !dia.Name.toLowerCase().includes('sábado') && !dia.Name.toLowerCase().includes('domingo'));
            if (isDiaUtil) { 
                diasUteisCount++; 
            }

            let statusApproval = 'draft';
            const statuses = entries.map(e => e.status);

            if (statuses.includes('Reprovado')) statusApproval = 'rejected';
            else if (entries.length > 0) {
                if (statuses.every(s => s === 'Faturado')) statusApproval = 'billed';
                else if (statuses.every(s => s === 'Fechado')) statusApproval = 'closed';
                else if (statuses.every(s => ['Aprovado', 'Fechado', 'Faturado'].includes(s))) statusApproval = 'approved';
                else if (statuses.includes('Lançado')) statusApproval = 'submitted';
                else statusApproval = 'draft';
            } else statusApproval = 'empty';

            let statusDay = 'normal';
            let label = '';
            if (dia.Tipo__c === 'Feriado') { statusDay = 'holiday'; label = 'Feriado'; }
            else if (dia.Tipo__c === 'Férias') { statusDay = 'vacation'; label = 'Férias'; }
            else if (dia.Tipo__c === 'Não Útil') { statusDay = 'weekend'; }

            calendarGrid[date] = {
                id: dia.Id, date: date, weekday: dia.Name, total: totalDia,
                status_day: statusDay, label: label, status_approval: statusApproval, entries: entries
            };
        });

        // 3. Calcula Total Contratado (Diária * Dias Úteis)
        const totalContratado = horasDiarias * diasUteisCount;

        let statusGeral = 'Em Aberto';
        if (!hasEntries) statusGeral = 'Novo';
        else {
            if (allStatuses.has('Rascunho') || allStatuses.has('Reprovado') || allStatuses.has('Em Aberto')) statusGeral = 'Em Aberto';
            else if (allStatuses.has('Lançado')) statusGeral = 'Aguardando Aprovação';
            else {
                const todosFaturados = [...allStatuses].every(s => s === 'Faturado');
                const todosFechadosOuFaturados = [...allStatuses].every(s => ['Fechado', 'Faturado'].includes(s));
                if (todosFaturados) statusGeral = 'Faturado';
                else if (todosFechadosOuFaturados) statusGeral = 'Fechado';
                else statusGeral = 'Aprovado';
            }
        }

        const saldoBancoTotal = (resSaldo.length > 0 && resSaldo[0].total) ? resSaldo[0].total : 0;

        const summary = {
            totalContratado,
            totalRealizado: totalLancadoNoPeriodo, 
            saldoBancoTotal: saldoBancoTotal, 
            variacaoPeriodo: totalBancoPeriodo,
            diasUteis: diasUteisCount,
            statusGeral: statusGeral
        };

        res.json({ periodId, grid: calendarGrid, summary });

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

        const soqlAlloc = `SELECT Id, Servico__r.Name, Servico__c, Percentual__c FROM Alocacao__c WHERE Pessoa__c = '${userId}' AND DataInicio__c <= ${date} AND (DataFim__c >= ${date} OR DataFim__c = NULL)`;
        const soqlActivities = `SELECT Id, Name, Servico__c, Servico__r.Name FROM Atividade__c WHERE Servico__c IN (SELECT Servico__c FROM Alocacao__c WHERE Pessoa__c = '${userId}' AND DataInicio__c <= ${date} AND (DataFim__c >= ${date} OR DataFim__c = NULL)) AND DataInicio__c <= ${date} AND (DataFim__c >= ${date} OR DataFim__c = NULL) ORDER BY Name ASC`;

        const soqlEntries = `
            SELECT Id, Horas__c, HorasExtras__c, HorasAusenciaRemunerada__c, HorasAusenciaNaoRemunerada__c, HorasBanco__c, 
                   Status__c, Servico__r.Name, Servico__c, Atividade__r.Name, Atividade__c, Justificativa__c, MotivoReprovacao__c, Responsavel__c 
            FROM LancamentoHora__c 
            WHERE Pessoa__c = '${userId}' 
            AND DiaPeriodo__r.Data__c = ${date}
            AND (
                Horas__c > 0 
                OR HorasExtras__c > 0 
                OR HorasAusenciaRemunerada__c > 0 
                OR HorasAusenciaNaoRemunerada__c > 0 
                OR (HorasBanco__c != null AND HorasBanco__c != 0)
            )
        `;

        const [resAlloc, resAct, resEntries] = await Promise.all([
            conn.query(soqlAlloc),
            conn.query(soqlActivities),
            conn.query(soqlEntries)
        ]);

        const allocations = resAlloc.records.map(r => ({ id: r.Servico__c, alocacaoId: r.Id, name: r.Servico__r.Name, percent: r.Percentual__c }));
        const activities = resAct.records.map(r => ({ id: r.Id, name: r.Name, projectId: r.Servico__c }));
        
        const entries = resEntries.records.map(l => ({
            id: l.Id,
            projectId: l.Servico__c,
            project: l.Servico__r ? l.Servico__r.Name : 'N/A',
            activityId: l.Atividade__c,
            activity: l.Atividade__r ? l.Atividade__r.Name : 'N/A',
            hours: (l.Horas__c||0),
            hoursExtra: (l.HorasExtras__c||0),
            hoursBank: (l.HorasBanco__c||0),
            hoursAbsence: (l.HorasAusenciaRemunerada__c||0) + (l.HorasAusenciaNaoRemunerada__c||0) + (l.HorasBanco__c < 0 ? Math.abs(l.HorasBanco__c) : 0),
            status: l.Status__c,
            reason: l.MotivoReprovacao__c,
            justification: l.Justificativa__c
        }));

        res.json({ date, allocations, activities, entries });

    } catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message });
    }
};

// 5. API: SALVAR LANÇAMENTO (COM VALIDAÇÃO DE CONTRATO DINÂMICA)
exports.saveEntry = async (req, res) => {
    const { 
        entryId, diaPeriodoId, projectId, alocacaoId, 
        activityId, activityName, 
        hoursNormal, hoursExtra, hoursAbsence, 
        reason, extraType, absenceType 
    } = req.body;
    
    const userId = req.session.user.id;

    if (!diaPeriodoId || !projectId) return res.status(400).json({ success: false, message: 'Dados incompletos.' });

    try {
        const conn = await getSfConnection();

        // 1. Obter Período e Carga Horária Diária
        const diaQuery = `
            SELECT Id, Periodo__c, Periodo__r.ContratoPessoa__r.Hora__c 
            FROM DiaPeriodo__c 
            WHERE Id = '${diaPeriodoId}' 
            LIMIT 1
        `;
        const diaRes = await conn.query(diaQuery);
        if (diaRes.totalSize === 0) return res.status(404).json({ success: false, message: 'Dia inválido.' });
        
        const periodoId = diaRes.records[0].Periodo__c;
        const horasDiarias = (diaRes.records[0].Periodo__r && 
                              diaRes.records[0].Periodo__r.ContratoPessoa__r && 
                              diaRes.records[0].Periodo__r.ContratoPessoa__r.Hora__c) 
                              ? diaRes.records[0].Periodo__r.ContratoPessoa__r.Hora__c 
                              : 8;

        // 2. Calcular Dias Úteis do Período para Limite Mensal
        const diasQuery = `SELECT Name, Tipo__c FROM DiaPeriodo__c WHERE Periodo__c = '${periodoId}'`;
        const diasRes = await conn.query(diasQuery);

        let diasUteis = 0;
        diasRes.records.forEach(dia => {
            const isWeekend = dia.Name.toLowerCase().includes('sábado') || dia.Name.toLowerCase().includes('domingo');
            const isOff = ['Feriado', 'Férias', 'Não Útil'].includes(dia.Tipo__c);
            
            if (!isWeekend && !isOff) {
                diasUteis++;
            }
        });

        const limiteHorasContrato = horasDiarias * diasUteis;

        // 3. Calcular Horas Normais já lançadas (exceto atual se update)
        let sumQuery = `
            SELECT SUM(Horas__c) totalNormal 
            FROM LancamentoHora__c 
            WHERE Periodo__c = '${periodoId}' 
            AND Pessoa__c = '${userId}'
        `;
        if (entryId) {
            sumQuery += ` AND Id != '${entryId}'`;
        }
        
        const sumRes = await conn.query(sumQuery);
        const totalJaLancado = sumRes.records[0].totalNormal || 0;

        // 4. Preparar Input
        let valNormais = parseFloat(hoursNormal) || 0;
        let valExtras = 0;
        let valBanco = 0;
        let valAusenciaRem = 0;
        let valAusenciaNaoRem = 0;
        const hExtraInput = parseFloat(hoursExtra) || 0;
        const hAusenciaInput = parseFloat(hoursAbsence) || 0;
        let finalJustificativa = reason || '';

        // 5. Validar Regras de Negócio
        if (hExtraInput > 0) {
            if (totalJaLancado < limiteHorasContrato) {
                const faltam = limiteHorasContrato - totalJaLancado;
                return res.status(400).json({ 
                    success: false, 
                    message: `Não permitido lançar Extra/Banco. Saldo de horas normais pendente: ${faltam}h.` 
                });
            }
        }

        if (valNormais > 0) {
            if ((totalJaLancado + valNormais) > limiteHorasContrato) {
                const saldo = limiteHorasContrato - totalJaLancado;
                return res.status(400).json({ 
                    success: false, 
                    message: `Excede o contrato (${limiteHorasContrato}h). Saldo restante: ${saldo}h. O excedente deve ser lançado como Extra/Banco.` 
                });
            }
        }

        // 6. Lógica de Tipos
        if (hExtraInput > 0) {
            if (extraType && extraType.trim() === 'Banco') {
                valBanco += hExtraInput;
                if (!finalJustificativa.includes('[EXTRA: Banco]')) finalJustificativa = `[EXTRA: Banco] ` + finalJustificativa;
            } else {
                valExtras = hExtraInput;
                if (!finalJustificativa.includes('[EXTRA: Pagto]')) finalJustificativa = `[EXTRA: Pagto] ` + finalJustificativa;
            }
        }

        if (hAusenciaInput > 0) {
            if (absenceType === 'Banco') {
                valBanco -= hAusenciaInput; 
                if (!finalJustificativa.includes('[AUSÊNCIA: Banco]')) finalJustificativa = `[AUSÊNCIA: Banco] ` + finalJustificativa;
            } else if (absenceType === 'Abonada') {
                valAusenciaRem = hAusenciaInput;
            } else {
                valAusenciaNaoRem = hAusenciaInput;
            }
        }

        let finalActivityId = activityId;
        if (!finalActivityId || finalActivityId === 'NEW') {
            const resAct = await conn.query(`SELECT Id FROM Atividade__c WHERE Name = '${activityName}' AND Servico__c = '${projectId}' LIMIT 1`);
            if (resAct.totalSize > 0) finalActivityId = resAct.records[0].Id;
            else {
                const newAct = await conn.sobject('Atividade__c').create({ Name: activityName, Servico__c: projectId });
                finalActivityId = newAct.id;
            }
        }

        const payload = {
            Horas__c: valNormais,
            HorasExtras__c: valExtras,
            HorasAusenciaRemunerada__c: valAusenciaRem,
            HorasAusenciaNaoRemunerada__c: valAusenciaNaoRem,
            HorasBanco__c: valBanco, 
            Justificativa__c: finalJustificativa,
            Status__c: 'Rascunho',
            Servico__c: projectId,
            Atividade__c: finalActivityId
        };

        if (entryId) {
            payload.Id = entryId;
            payload.MotivoReprovacao__c = null; 
            await conn.sobject('LancamentoHora__c').update(payload);
        } else {
            payload.Pessoa__c = userId;
            payload.DiaPeriodo__c = diaPeriodoId;
            payload.Periodo__c = periodoId;

            let responsavelId = null;
            if (alocacaoId) responsavelId = await getOrCreateResponsavel(conn, finalActivityId, alocacaoId);
            if (responsavelId) payload.Responsavel__c = responsavelId;

            await conn.sobject('LancamentoHora__c').create(payload);
        }

        res.json({ success: true });
    } catch (error) {
        console.error('Save Entry Error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// 6. API: SUBMETER DIA
exports.submitDay = async (req, res) => {
    const { diaPeriodoId } = req.body;
    const userId = req.session.user.id;
    if (!diaPeriodoId) return res.status(400).json({ success: false, message: 'Dia inválido.' });

    try {
        const conn = await getSfConnection();
        const q = `SELECT Id FROM LancamentoHora__c WHERE DiaPeriodo__c = '${diaPeriodoId}' AND Pessoa__c = '${userId}' AND Status__c IN ('Rascunho', 'Reprovado', 'Em Aberto')`;
        const records = await conn.query(q);

        if (records.totalSize === 0) return res.json({ success: true, message: 'Nada pendente.' });

        const updates = records.records.map(rec => ({ Id: rec.Id, Status__c: 'Lançado' }));
        await conn.sobject('LancamentoHora__c').update(updates);
        res.json({ success: true, message: 'Dia enviado para aprovação!' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// 7. API: SUBMETER PERÍODO
exports.submitPeriod = async (req, res) => {
    const { periodId } = req.body;
    const userId = req.session.user.id;
    if (!periodId) return res.status(400).json({ success: false, message: 'Período inválido.' });

    try {
        const conn = await getSfConnection();
        const q = `SELECT Id FROM LancamentoHora__c WHERE DiaPeriodo__r.Periodo__c = '${periodId}' AND Pessoa__c = '${userId}' AND Status__c IN ('Rascunho', 'Reprovado', 'Em Aberto')`;
        const records = await conn.query(q);

        if (records.totalSize === 0) return res.json({ success: true, message: 'Todos os lançamentos deste período já foram enviados.' });

        const updates = records.records.map(rec => ({ Id: rec.Id, Status__c: 'Lançado' }));
        await conn.sobject('LancamentoHora__c').update(updates);
        res.json({ success: true, message: `${updates.length} itens enviados para aprovação.` });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// 8. API: EXCLUIR
exports.deleteEntry = async (req, res) => {
    const { id } = req.params;
    try {
        const conn = await getSfConnection();
        const check = await conn.query(`SELECT Id, Status__c FROM LancamentoHora__c WHERE Id = '${id}' LIMIT 1`);
        if (check.totalSize === 0) return res.status(404).json({ success: false, message: 'Não encontrado.' });
        if (['Aprovado', 'Fechado', 'Faturado', 'Lançado'].includes(check.records[0].Status__c)) {
            return res.status(403).json({ success: false, message: 'Bloqueado para exclusão.' });
        }
        await conn.sobject('LancamentoHora__c').destroy(id);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};