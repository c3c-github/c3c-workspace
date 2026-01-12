const { getSfConnection } = require('../config/salesforce');
const moment = require('moment');

// --- HELPERS ---

const getDateRange = (month, year) => {
    const start = moment(`${year}-${month}-01`, 'YYYY-MM-DD').startOf('month');
    const end = moment(start).endOf('month');
    return { 
        start: start.format('YYYY-MM-DD'), 
        end: end.format('YYYY-MM-DD'),
        today: moment().format('YYYY-MM-DD'),
        momentStart: start,
        momentEnd: end
    };
};

const getServicesScope = async (conn, userId) => {
    // Retorna os serviços de SUPORTE onde o usuário tem papel de liderança
    const soql = `
        SELECT Id, Name, Conta__c, Conta__r.Name, 
               Contrato__c, Contrato__r.StartDate, Contrato__r.EndDate, Contrato__r.HorasContratadas__c 
        FROM Servico__c 
        WHERE (Lider__c = '${userId}' 
           OR LiderTecnico__c = '${userId}' 
           OR Coordenador__c = '${userId}')
        AND Tipo__c = 'Suporte'
    `;
    const res = await conn.query(soql);
    return res.records;
};

// --- RENDER ---
exports.renderPage = async (req, res) => {
    try {
        moment.locale('pt-br'); // Define locale para português
        const periods = [];
        const date = moment();
        for (let i = 0; i < 24; i++) {
            // Capitaliza a primeira letra (ex: "janeiro" -> "Janeiro")
            const label = date.format('MMMM YYYY');
            const labelCapitalized = label.charAt(0).toUpperCase() + label.slice(1);
            
            periods.push({
                label: labelCapitalized, 
                value: { month: date.month() + 1, year: date.year() }
            });
            date.subtract(1, 'month');
        }

        res.render('supportManagement', { 
            user: req.session.user, 
            page: 'support_management',
            periods: periods
        });
    } catch (e) {
        console.error(e);
        res.render('dashboard', { user: req.session.user, page: 'dashboard', error: e.message });
    }
};

// --- API ENDPOINTS ---

// 1. KPIs GLOBAIS
exports.getGlobalMetrics = async (req, res) => {
    const { month, year } = req.query;
    const dates = getDateRange(month, year);
    const conn = await getSfConnection();

    try {
        const services = await getServicesScope(conn, req.session.user.id);
        if (services.length === 0) return res.json({ saudeContratos: 0, slaEstourado: 0, estagnados: 0, csat: 0 });

        const serviceIds = services.map(s => `'${s.Id}'`).join(',');
        const accountIds = services.map(s => s.Conta__c ? `'${s.Conta__c}'` : null).filter(Boolean).join(',');

        // A. Saúde
        let totalFranquia = 0;
        services.forEach(s => {
            if (s.Contrato__c && s.Contrato__r) {
                const c = s.Contrato__r;
                // Verifica vigência: Iniciou antes do fim do período E (não terminou ou terminou após o início do período)
                const startedBeforeEnd = c.StartDate <= dates.end;
                const endedAfterStart = !c.EndDate || c.EndDate >= dates.start;
                
                if (startedBeforeEnd && endedAfterStart) {
                    totalFranquia += (c.HorasContratadas__c || 0);
                }
            }
        });

        const soqlHours = `SELECT Horas__c, HorasExtras__c FROM LancamentoHora__c WHERE Servico__c IN (${serviceIds}) AND DiaPeriodo__r.Data__c >= ${dates.start} AND DiaPeriodo__r.Data__c <= ${dates.end} AND (Horas__c > 0 OR HorasExtras__c > 0)`;
        const hoursRes = await conn.query(soqlHours);
        let totalRealizado = 0;
        hoursRes.records.forEach(r => totalRealizado += (r.Horas__c || 0) + (r.HorasExtras__c || 0));
        const saude = totalFranquia > 0 ? (totalRealizado / totalFranquia) * 100 : 0;

        // B. KPIs de Chamados
        let slaCount = 0;
        let estagnadosCount = 0;
        let csatAvg = 0;

        if (accountIds.length > 0) {
            // SLA
            const soqlSla = `SELECT Count() FROM Case WHERE IsClosed = false AND CreatedDate < N_DAYS_AGO:7 AND AccountId IN (${accountIds})`;
            const slaRes = await conn.query(soqlSla);
            slaCount = slaRes.totalSize;

            // CSAT
            const soqlCsat = `SELECT CSAT__c FROM Case WHERE ClosedDate >= ${dates.start}T00:00:00Z AND ClosedDate <= ${dates.end}T23:59:59Z AND AccountId IN (${accountIds}) AND CSAT__c != null`;
            const csatRes = await conn.query(soqlCsat);
            let csatSum = 0;
            csatRes.records.forEach(r => csatSum += r.CSAT__c);
            csatAvg = csatRes.totalSize > 0 ? (csatSum / csatRes.totalSize) : 0;

            // Estagnados (Logica simplificada para evitar erro de relacionamento LogCaso__c se não existir)
            // Tenta buscar LastModifiedDate se Log não rolar
            try {
                const soqlStagnant = `SELECT Id, LastModifiedDate FROM Case WHERE IsClosed = false AND AccountId IN (${accountIds})`;
                const stagnantRes = await conn.query(soqlStagnant);
                const threeDaysAgo = moment().subtract(3, 'days');
                stagnantRes.records.forEach(c => {
                    // Se não foi modificado em 3 dias, considera estagnado (fallback)
                    if (moment(c.LastModifiedDate).isBefore(threeDaysAgo)) estagnadosCount++;
                });
            } catch (ignore) {}
        }

        res.json({
            saudeContratos: saude.toFixed(1),
            slaEstourado: slaCount,
            estagnados: estagnadosCount,
            csat: csatAvg.toFixed(1)
        });

    } catch (e) {
        console.error("Metrics Error:", e);
        res.status(500).json({ error: e.message });
    }
};

// 2. CONTRATOS
exports.getContractsPerformance = async (req, res) => {
    const { month, year } = req.query;
    const dates = getDateRange(month, year);
    const conn = await getSfConnection();

    try {
        const services = await getServicesScope(conn, req.session.user.id);
        const result = [];

        for (const s of services) {
            let franquia = 0;
            if (s.Contrato__c && s.Contrato__r) {
                const c = s.Contrato__r;
                const startedBeforeEnd = c.StartDate <= dates.end;
                const endedAfterStart = !c.EndDate || c.EndDate >= dates.start;
                if (startedBeforeEnd && endedAfterStart) franquia = c.HorasContratadas__c || 0;
            }

            const hRes = await conn.query(`SELECT SUM(Horas__c) tot, SUM(HorasExtras__c) ext FROM LancamentoHora__c WHERE Servico__c = '${s.Id}' AND DiaPeriodo__r.Data__c >= ${dates.start} AND DiaPeriodo__r.Data__c <= ${dates.end} AND (Horas__c > 0 OR HorasExtras__c > 0)`);
            const used = (hRes.records[0].tot || 0) + (hRes.records[0].ext || 0);

            // Tickets
            let tickets = { open: 0, inProg: 0, pause: 0, waiting: 0, closed: 0, sla: 0, csat: 0, estagnados: 0 };
            if (s.Conta__c) {
                const cases = await conn.query(`
                    SELECT Status, CreatedDate, IsClosed, CSAT__c, LastModifiedDate 
                    FROM Case WHERE AccountId = '${s.Conta__c}' 
                    AND ((IsClosed = false) OR (ClosedDate >= ${dates.start}T00:00:00Z AND ClosedDate <= ${dates.end}T23:59:59Z))
                `);
                
                let csatSum = 0, csatCount = 0;
                const threeDaysAgo = moment().subtract(3, 'days');

                cases.records.forEach(c => {
                    if (!c.IsClosed) {
                        if (['New', 'Open'].includes(c.Status)) tickets.open++;
                        else if (c.Status === 'In Progress') tickets.inProg++;
                        else if (c.Status === 'On Hold') tickets.pause++;
                        else tickets.waiting++;
                        
                        if (moment().diff(moment(c.CreatedDate), 'days') > 7) tickets.sla++;
                        
                        // Estagnados (Lógica simplificada LastModified)
                        if (moment(c.LastModifiedDate).isBefore(threeDaysAgo)) tickets.estagnados++;

                    } else {
                        tickets.closed++;
                        if (c.CSAT__c) { csatSum += c.CSAT__c; csatCount++; }
                    }
                });
                if (csatCount) tickets.csat = (csatSum / csatCount).toFixed(1);
            }

            const teamQ = await conn.query(`
                SELECT Count() FROM Alocacao__c 
                WHERE Servico__c = '${s.Id}' 
                AND DataInicio__c <= ${dates.end} 
                AND (DataFim__c >= ${dates.start} OR DataFim__c = null)
            `);

            result.push({
                id: s.Id,
                name: s.Name,
                client: s.Conta__r ? s.Conta__r.Name : 'N/A',
                total: franquia,
                used: used,
                ...tickets, // Inclui estagnados
                teamCount: teamQ.totalSize
            });
        }
        res.json(result);
    } catch (e) {
        console.error(e);
        res.status(500).json([]);
    }
};

// 3. EQUIPE
exports.getTeamPerformance = async (req, res) => {
    const { month, year } = req.query;
    const dates = getDateRange(month, year);
    const conn = await getSfConnection();

    try {
        const services = await getServicesScope(conn, req.session.user.id);
        const myServiceIds = services.map(s => s.Id);
        const myServiceIdsQuery = services.map(s => `'${s.Id}'`).join(',');
        
        if (!myServiceIdsQuery) return res.json([]);

        // PASSO 1: Descobrir QUEM são as pessoas que eu gerencio (estão alocadas em meus serviços neste período)
        const peopleInScopeRes = await conn.query(`
            SELECT Pessoa__c 
            FROM Alocacao__c 
            WHERE Servico__c IN (${myServiceIdsQuery}) 
            AND DataInicio__c <= ${dates.end} 
            AND (DataFim__c >= ${dates.start} OR DataFim__c = null)
            GROUP BY Pessoa__c
        `);

        if (peopleInScopeRes.records.length === 0) return res.json([]);

        const peopleIds = peopleInScopeRes.records.map(r => `'${r.Pessoa__c}'`).join(',');

        // PASSO 2: Buscar TODAS as alocações dessas pessoas (Independentemente do serviço)
        const allocs = await conn.query(`
            SELECT Id, Pessoa__c, Pessoa__r.Name, Pessoa__r.HorasContrato__c, 
                   Percentual__c, Servico__c, Servico__r.Name, DataInicio__c, DataFim__c, DataFimOriginal__c
            FROM Alocacao__c 
            WHERE Pessoa__c IN (${peopleIds}) 
            AND DataInicio__c <= ${dates.end} 
            AND (DataFim__c >= ${dates.start} OR DataFim__c = null)
        `);

        const people = {};

        allocs.records.forEach(a => {
            if (!a.Pessoa__r) return;
            const pid = a.Pessoa__c;
            
            if (!people[pid]) {
                people[pid] = {
                    id: pid,
                    name: a.Pessoa__r.Name,
                    role: 'Colaborador', 
                    contractHours: a.Pessoa__r.HorasContrato__c || 168,
                    totalAlloc: 0,
                    allocations: []
                };
            }
            
            people[pid].totalAlloc += (a.Percentual__c || 0);
            
            // Flag para o Frontend saber se pode editar
            const isManaged = myServiceIds.includes(a.Servico__c);

            people[pid].allocations.push({
                ...a,
                isManaged: isManaged
            });
        });

        const pIdsStr = peopleIds; // Reuso
        if (!pIdsStr) return res.json([]);

        const daysRes = await conn.query(`SELECT Pessoa__c, Data__c FROM DiaPeriodo__c WHERE Pessoa__c IN (${pIdsStr}) AND Data__c >= ${dates.start} AND Data__c <= ${dates.end} AND Tipo__c = 'Útil'`);
        const wdMap = {};
        
        // Cálculo Algorítmico de Dias Úteis do Mês (Fallback/Projeção)
        let projectedWorkingDays = 0;
        let iterDate = moment(dates.momentStart);
        while (iterDate.isSameOrBefore(dates.momentEnd)) {
            if (iterDate.isoWeekday() <= 5) projectedWorkingDays++; // Seg-Sex
            iterDate.add(1, 'day');
        }

        daysRes.records.forEach(d => {
            const pid = d.Pessoa__c;
            if (!wdMap[pid]) wdMap[pid] = { total: 0, past: 0 };
            wdMap[pid].total++;
            if (moment(d.Data__c).isSameOrBefore(moment())) wdMap[pid].past++;
        });

        // Buscar Horas Realizadas (LancamentoHora__c) para popular realMap
        const hoursRes = await conn.query(`
            SELECT Pessoa__c, DiaPeriodo__r.Data__c, Horas__c, HorasExtras__c 
            FROM LancamentoHora__c 
            WHERE Pessoa__c IN (${pIdsStr}) 
            AND DiaPeriodo__r.Data__c >= ${dates.start} 
            AND DiaPeriodo__r.Data__c <= ${dates.end}
            AND (Horas__c > 0 OR HorasExtras__c > 0)
        `);

        const realMap = {};
        hoursRes.records.forEach(h => {
            const pid = h.Pessoa__c;
            if (!realMap[pid]) realMap[pid] = { month: 0, today: 0 };
            
            const val = (h.Horas__c || 0) + (h.HorasExtras__c || 0);
            realMap[pid].month += val;
            
            if (h.DiaPeriodo__r && h.DiaPeriodo__r.Data__c === dates.today) {
                realMap[pid].today += val;
            }
        });

        const result = Object.values(people).map(p => {
            const wd = wdMap[p.id] || { total: 0, past: 0 };
            
            // Híbrido: Usa o maior valor entre Banco e Projeção para o Total
            const totalDays = Math.max(wd.total, projectedWorkingDays);
            
            const real = realMap[p.id] || { month: 0, today: 0 };
            const allocationFactor = p.totalAlloc / 100;

            // Total Mês = HorasDiarias * DiasUteisTotal(Híbrido) * Alocação
            const expectedMonthTotal = p.contractHours * totalDays * allocationFactor;
            
            // Meta Hoje = HorasDiarias * DiasUteisPassados(Banco) * Alocação
            const meta = p.contractHours * wd.past * allocationFactor;

            return {
                id: p.id,
                name: p.name,
                role: p.role,
                allocations: p.allocations,
                hoursToday: real.today,
                hoursMonth: real.month,
                contractMonth: expectedMonthTotal,
                expectedMonthTotal: Math.round(expectedMonthTotal),
                expectedToDate: Math.round(meta),
                status: real.month >= (meta - (p.contractHours * allocationFactor)) ? 'Em Dia' : 'Atrasado'
            };
        });

        res.json(result);

    } catch (e) {
        console.error(e);
        res.status(500).json([]);
    }
};

exports.getAllocations = exports.getTeamPerformance;

exports.getContractExtract = async (req, res) => {
    const { serviceName, month, year, personId } = req.query;
    const dates = getDateRange(month, year);
    const conn = await getSfConnection();
        try {
            let whereClause = '';
            
            if (personId) {
                // Se for busca por Pessoa, precisamos garantir que só traga horas dos serviços que o usuário lidera
                const services = await getServicesScope(conn, req.session.user.id);
                if (services.length === 0) return res.json([]);
                
                const serviceIds = services.map(s => `'${s.Id}'`).join(',');
                whereClause = `Pessoa__c = '${personId}' AND Servico__c IN (${serviceIds})`;
            } else {
                // Busca padrão por Nome do Serviço
                whereClause = `Servico__r.Name = '${serviceName}'`;
            }

            const soql = `
                SELECT DiaPeriodo__r.Data__c, Pessoa__r.Name, 
                       Atividade__r.Name, Servico__r.Name, Servico__r.Conta__r.Name,
                       Horas__c, HorasExtras__c
                FROM LancamentoHora__c
                WHERE ${whereClause}
                AND DiaPeriodo__r.Data__c >= ${dates.start}
                AND DiaPeriodo__r.Data__c <= ${dates.end}
                AND (Horas__c > 0 OR HorasExtras__c > 0)
                ORDER BY DiaPeriodo__r.Data__c DESC
            `;
            const resQ = await conn.query(soql);
            
            const mapped = resQ.records.map(r => ({
                data: r.DiaPeriodo__r.Data__c,
                cliente: (r.Servico__r && r.Servico__r.Conta__r) ? r.Servico__r.Conta__r.Name : (personId ? (r.Servico__r ? r.Servico__r.Name : serviceName) : serviceName), 
                servico: r.Servico__r ? r.Servico__r.Name : serviceName,
                atividade: r.Atividade__r ? r.Atividade__r.Name : 'Atividade sem nome',
                horasNormais: r.Horas__c || 0,
                horasExtras: r.HorasExtras__c || 0
            }));
            res.json(mapped);
        } catch (e) { console.error(e); res.status(500).json([]); }
};

exports.searchPeople = async (req, res) => {
    const { term } = req.query;
    const conn = await getSfConnection();
    try {
        let q = '';
        if (term) {
            q = `SELECT Id, Name FROM Pessoa__c WHERE Name LIKE '%${term}%' AND Ativo__c = true ORDER BY Name LIMIT 50`;
        } else {
            q = `SELECT Id, Name FROM Pessoa__c WHERE Ativo__c = true ORDER BY Name LIMIT 50`;
        }
        const r = await conn.query(q);
        res.json(r.records);
    } catch (e) { res.status(500).json([]); }
};

exports.getMyServices = async (req, res) => {
    const conn = await getSfConnection();
    try {
        const services = await getServicesScope(conn, req.session.user.id);
        const simplified = services.map(s => ({ id: s.Id, name: s.Name }));
        res.json(simplified);
    } catch (e) { res.status(500).json([]); }
};

exports.deleteAllocation = async (req, res) => {
    const { id } = req.params;
    const conn = await getSfConnection();

    try {
        // Validação: Verificar se existem lançamentos de horas vinculados a esta alocação via Responsavel__c
        const hoursCheck = await conn.query(`
            SELECT Count() 
            FROM LancamentoHora__c 
            WHERE Responsavel__r.Alocacao__c = '${id}' 
            LIMIT 1
        `);

        if (hoursCheck.totalSize > 0) {
            return res.status(400).json({ 
                success: false, 
                error: 'Não é possível excluir esta alocação pois existem lançamentos de horas associados.' 
            });
        }

        // Se não houver impedimentos, exclui
        await conn.sobject('Alocacao__c').destroy(id);
        res.json({ success: true });

    } catch (e) {
        console.error("[DeleteAllocation] Error:", e);
        res.status(500).json({ success: false, error: e.message });
    }
};

exports.saveAllocation = async (req, res) => { 
    const { personId, allocations } = req.body;
    console.log(`[SaveAllocation] Iniciando para Pessoa: ${personId}`);
    console.log(`[SaveAllocation] Payload recebido:`, JSON.stringify(allocations, null, 2));

    const conn = await getSfConnection();
    
    try {
        const toUpdate = [];
        const toInsert = [];
        const today = moment().format('YYYY-MM-DD');

        for (const a of allocations) {
            // Só atualiza se tiver ID válido (não vazio)
            if (a.allocationId && a.allocationId.trim() !== '') {
                // UPDATE
                const payloadUpdate = {
                    Id: a.allocationId,
                    Percentual__c: a.percent,
                    DataInicio__c: a.startDate || today,
                    DataFim__c: a.endDate || null,
                    DataFimOriginal__c: a.originalEndDate || null
                };
                toUpdate.push(payloadUpdate);
            } else {
                // INSERT
                const payloadInsert = {
                    Pessoa__c: personId,
                    Servico__c: a.serviceId,
                    Percentual__c: a.percent,
                    DataInicio__c: a.startDate || today,
                    DataFim__c: a.endDate || null,
                    DataFimOriginal__c: a.originalEndDate || null
                };
                toInsert.push(payloadInsert);
            }
        }

        console.log(`[SaveAllocation] Qtd Update: ${toUpdate.length}, Qtd Insert: ${toInsert.length}`);

        if (toUpdate.length > 0) {
            const resUpd = await conn.sobject('Alocacao__c').update(toUpdate);
            const errors = resUpd.filter(r => !r.success);
            if (errors.length > 0) throw new Error(`Erro no Update: ${JSON.stringify(errors)}`);
        }

        if (toInsert.length > 0) {
            const resIns = await conn.sobject('Alocacao__c').create(toInsert);
            const errors = resIns.filter(r => !r.success);
            if (errors.length > 0) throw new Error(`Erro no Insert: ${JSON.stringify(errors)}`);
        }

        res.json({ success: true });
    } catch (e) {
        console.error("[SaveAllocation] Erro Crítico:", e);
        res.status(500).json({ error: e.message });
    }
};
