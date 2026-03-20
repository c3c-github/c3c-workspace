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

const getServicesScope = async (conn, user, dates) => {
    // Se for Diretoria, traz todos os serviços de suporte sem filtrar por líder
    let filter = `Tipo__c = 'Suporte' AND DataInicio__c <= ${dates.end} AND (DataFim__c >= ${dates.start} OR DataFim__c = NULL)`;
    
    const isDirector = user.grupos && user.grupos.includes('DIRETOR');
    
    if (!isDirector) {
        filter += ` AND (Lider__c = '${user.id}' OR LiderTecnico__c = '${user.id}' OR Coordenador__c = '${user.id}')`;
    }

    const soql = `
        SELECT Id, Name, Conta__c, Conta__r.Name, 
               Contrato__c, Contrato__r.StartDate, Contrato__r.EndDate, Contrato__r.HorasContratadas__c 
        FROM Servico__c 
        WHERE ${filter}
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
    const isDirector = req.session.user.grupos && req.session.user.grupos.includes('DIRETOR');

    try {
        const services = await getServicesScope(conn, req.session.user, dates);
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

        // D. Vencimentos (Próximos 90 dias)
        const ninetyDaysFromNow = moment().add(90, 'days').format('YYYY-MM-DD');
        const todayStr = moment().format('YYYY-MM-DD');
        let expiringFilter = `Tipo__c = 'Suporte' AND DataFim__c >= ${todayStr} AND DataFim__c <= ${ninetyDaysFromNow}`;
        
        if (!isDirector) {
            expiringFilter += ` AND (Lider__c = '${req.session.user.id}' OR LiderTecnico__c = '${req.session.user.id}' OR Coordenador__c = '${req.session.user.id}')`;
        }
        const expiringRes = await conn.query(`SELECT Count() FROM Servico__c WHERE ${expiringFilter}`);

        res.json({
            saudeContratos: saude.toFixed(1),
            slaEstourado: slaCount,
            estagnados: estagnadosCount,
            csat: csatAvg.toFixed(1),
            expiringSoon: expiringRes.totalSize
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
    const isDirector = req.session.user.grupos && req.session.user.grupos.includes('DIRETOR');

    try {
        const services = await getServicesScope(conn, req.session.user, dates);
        const result = [];

        for (const s of services) {
            let franquia = 0;
            if (s.Contrato__c && s.Contrato__r) {
                const c = s.Contrato__r;
                const startedBeforeEnd = c.StartDate <= dates.end;
                const endedAfterStart = !c.EndDate || c.EndDate >= dates.start;
                if (startedBeforeEnd && endedAfterStart) franquia = c.HorasContratadas__c || 0;
            }

            // Buscar DataFim__c do serviço para o indicador de vencimento na tabela
            const servInfo = await conn.query(`SELECT DataFim__c FROM Servico__c WHERE Id = '${s.Id}' LIMIT 1`);
            const expirationDate = servInfo.records[0]?.DataFim__c || null;

            const hRes = await conn.query(`SELECT SUM(Horas__c) tot, SUM(HorasExtras__c) ext FROM LancamentoHora__c WHERE Servico__c = '${s.Id}' AND DiaPeriodo__r.Data__c >= ${dates.start} AND DiaPeriodo__r.Data__c <= ${dates.end} AND (Horas__c > 0 OR HorasExtras__c > 0)`);
            const used = (hRes.records[0].tot || 0) + (hRes.records[0].ext || 0);

            // Tickets
            let tickets = { open: 0, inProg: 0, pause: 0, waiting: 0, closed: 0, sla: 0, csat: 0, estagnados: 0 };
            let accountId = s.Conta__c;
            if (accountId) {
                const cases = await conn.query(`
                    SELECT Status, CreatedDate, IsClosed, CSAT__c, LastModifiedDate 
                    FROM Case WHERE AccountId = '${accountId}' 
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
                accountId: accountId,
                name: s.Name,
                client: s.Conta__r ? s.Conta__r.Name : 'N/A',
                expirationDate: expirationDate,
                total: franquia,
                used: used,
                ...tickets,
                teamCount: teamQ.totalSize
            });
        }
        res.json(result);
    } catch (e) {
        console.error(e);
        res.status(500).json([]);
    }
};

exports.getContractCases = async (req, res) => {
    const { accountId, statusType } = req.query;
    const conn = await getSfConnection();

    try {
        let statusFilter = '';
        if (statusType === 'NOV') statusFilter = "AND Status IN ('New', 'Open')";
        else if (statusType === 'AND') statusFilter = "AND Status = 'In Progress'";
        else if (statusType === 'PAU') statusFilter = "AND Status = 'On Hold'";
        else if (statusType === 'AGU') statusFilter = "AND IsClosed = false AND Status NOT IN ('New', 'Open', 'In Progress', 'On Hold')";
        else if (statusType === 'FEC') statusFilter = "AND IsClosed = true";
        else if (statusType === 'SLA') statusFilter = "AND IsClosed = false AND CreatedDate < N_DAYS_AGO:7";

        const soql = `
            SELECT Id, CaseNumber, Subject, Status, Priority, CreatedDate, LastModifiedDate, Pessoa__r.Name, CSAT__c 
            FROM Case 
            WHERE AccountId = '${accountId}' ${statusFilter}
            ORDER BY CreatedDate DESC LIMIT 100
        `;
        const result = await conn.query(soql);
        
        const threeDaysAgo = moment().subtract(3, 'days');
        const mapped = result.records.map(c => ({
            id: c.Id,
            number: c.CaseNumber,
            subject: c.Subject,
            status: c.Status,
            priority: c.Priority,
            owner: (c.Pessoa__r && c.Pessoa__r.Name) ? c.Pessoa__r.Name : 'Ninguém assumiu',
            created: c.CreatedDate,
            csat: c.CSAT__c || null,
            isSlaCritical: moment().diff(moment(c.CreatedDate), 'days') > 7,
            isStagnant: moment(c.LastModifiedDate).isBefore(threeDaysAgo) && c.Status !== 'Closed'
        }));

        res.json(mapped);
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
        const services = await getServicesScope(conn, req.session.user, dates);
        const myServiceIdsQuery = services.map(s => `'${s.Id}'`).join(',');
        
        if (!myServiceIdsQuery) return res.json([]);

        // PASSO 1: Descobrir QUEM são as pessoas que eu gerencio
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

        // PASSO 2: Buscar informações das pessoas e suas alocações
        const allocs = await conn.query(`
            SELECT Id, Pessoa__c, Pessoa__r.Name, Pessoa__r.URL_Foto__c, 
                   Percentual__c, Servico__c, Servico__r.Name
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
                    photo: a.Pessoa__r.URL_Foto__c,
                    totalAlloc: 0
                };
            }
            people[pid].totalAlloc += (a.Percentual__c || 0);
        });

        // PASSO 3: Buscar Dias do Período para Target e 100%
        const daysRes = await conn.query(`
            SELECT Pessoa__c, Data__c, Hora__c, 
                   Periodo__r.ContratoPessoa__r.Hora__c 
            FROM DiaPeriodo__c 
            WHERE Pessoa__c IN (${peopleIds}) 
            AND Data__c >= ${dates.start} 
            AND Data__c <= ${dates.end} 
            AND Tipo__c = 'Útil'
        `);

        const targetMap = {};
        daysRes.records.forEach(d => {
            const pid = d.Pessoa__c;
            if (!targetMap[pid]) targetMap[pid] = { totalMonth: 0, targetToDate: 0 };
            
            // Lógica de fallback: se Hora__c do Dia estiver zerada, usa a do contrato
            const hDia = d.Hora__c || 0;
            const hContrato = (d.Periodo__r && d.Periodo__r.ContratoPessoa__r) ? d.Periodo__r.ContratoPessoa__r.Hora__c : 0;
            const hours = hDia > 0 ? hDia : hContrato;

            targetMap[pid].totalMonth += hours;
            
            if (moment(d.Data__c).isSameOrBefore(moment(), 'day')) {
                targetMap[pid].targetToDate += hours;
            }
        });

        // PASSO 4: Buscar Horas Realizadas (Consumo = Horas + 2 * HorasExtras)
        const hoursRes = await conn.query(`
            SELECT Pessoa__c, DiaPeriodo__r.Data__c, Horas__c, HorasExtras__c 
            FROM LancamentoHora__c 
            WHERE Pessoa__c IN (${peopleIds}) 
            AND DiaPeriodo__r.Data__c >= ${dates.start} 
            AND DiaPeriodo__r.Data__c <= ${dates.end}
            AND (Horas__c > 0 OR HorasExtras__c > 0)
        `);

        const realMap = {};
        hoursRes.records.forEach(h => {
            const pid = h.Pessoa__c;
            if (!realMap[pid]) realMap[pid] = { month: 0, today: 0 };
            
            const normal = h.Horas__c || 0;
            const extra = h.HorasExtras__c || 0;
            const val = normal + (2 * extra);
            
            realMap[pid].month += val;
            if (h.DiaPeriodo__r && h.DiaPeriodo__r.Data__c === dates.today) {
                realMap[pid].today += val;
            }
        });

        const result = Object.values(people).map(p => {
            const target = targetMap[p.id] || { totalMonth: 0, targetToDate: 0 };
            const real = realMap[p.id] || { month: 0, today: 0 };
            
            return {
                id: p.id,
                name: p.name,
                photo: p.photo,
                hoursToday: real.today,
                hoursMonth: real.month,
                expectedMonthTotal: Math.round(target.totalMonth),
                expectedToDate: Math.round(target.targetToDate),
                status: real.month >= (target.targetToDate - 4) ? 'Em Dia' : 'Atrasado'
            };
        });

        res.json(result);

    } catch (e) {
        console.error(e);
        res.status(500).json([]);
    }
};

exports.getContractExtract = async (req, res) => {
    const { serviceName, month, year, personId } = req.query;
    const dates = getDateRange(month, year);
    const conn = await getSfConnection();
        try {
            let whereClause = '';
            
            if (personId) {
                // Se for busca por Pessoa, precisamos garantir que só traga horas dos serviços que o usuário lidera
                const services = await getServicesScope(conn, req.session.user, dates);
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
                profissional: r.Pessoa__r ? r.Pessoa__r.Name : 'N/A',
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

