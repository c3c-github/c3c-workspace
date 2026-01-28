const { getSfConnection } = require('../config/salesforce');

// --- HELPER: CÁLCULO DE DIAS ÚTEIS ---
function getBusinessDays(startDate, endDate) {
    let count = 0;
    const curDate = new Date(startDate);
    const end = new Date(endDate);
    
    // Ajuste de timezone
    curDate.setHours(12,0,0,0); 
    end.setHours(12,0,0,0);

    while (curDate <= end) {
        const dayOfWeek = curDate.getDay();
        if (dayOfWeek !== 0 && dayOfWeek !== 6) { count++; }
        curDate.setDate(curDate.getDate() + 1);
    }
    return count;
}

const safeId = (id) => id ? id.substring(0, 15) : '';

// FILTRO CORRIGIDO COM (HorasBanco__c != 0 AND HorasBanco__c != null)
const FILTRO_HORAS = `(Horas__c > 0 OR HorasExtras__c > 0 OR (HorasBanco__c != 0 AND HorasBanco__c != null) OR HorasAusenciaRemunerada__c > 0 OR HorasAusenciaNaoRemunerada__c > 0)`;

exports.getMyAllocations = async (req, res) => {
    try {
        const userId = req.session.user.id;
        const { inicio, fim } = req.query;
        const conn = await getSfConnection();

        // Data de referência: Hoje ou o fim do período (o que for menor, para garantir vigência)
        const refDate = fim || new Date().toISOString().split('T')[0];

        const query = `
            SELECT Servico__r.Name, Servico__r.Conta__r.Name, Percentual__c, DataInicio__c, DataFim__c
            FROM Alocacao__c 
            WHERE Pessoa__c = '${userId}' 
            AND DataInicio__c <= ${refDate} 
            AND (DataFim__c >= ${inicio || refDate} OR DataFim__c = NULL)
            ORDER BY Servico__r.Name ASC
        `;

        const result = await conn.query(query);
        
        const data = result.records.map(r => ({
            serviceName: r.Servico__r ? r.Servico__r.Name : 'Serviço sem nome',
            accountName: (r.Servico__r && r.Servico__r.Conta__r) ? r.Servico__r.Conta__r.Name : '-',
            percent: r.Percentual__c || 0
        }));

        res.json(data);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
};

exports.getPeriods = async (req, res) => {
    try {
        const { type } = req.query;
        const userId = req.session.user.id;
        const conn = await getSfConnection();
        let records = [];

        if (type === 'user') {
            const query = `SELECT Id, Name, DataInicio__c, DataFim__c FROM Periodo__c WHERE ContratoPessoa__r.Pessoa__c = '${userId}' ORDER BY DataInicio__c DESC LIMIT 24`;
            const result = await conn.query(query);
            records = result.records;
        } else {
            const query = `SELECT Id, Name, DataInicio__c, DataFim__c FROM Periodo__c ORDER BY DataInicio__c DESC LIMIT 200`;
            const result = await conn.query(query);
            const seen = new Set();
            for (const p of result.records) {
                const key = `${p.DataInicio__c}_${p.DataFim__c}`;
                if (!seen.has(key)) {
                    seen.add(key);
                    let cleanName = p.Name.includes(' - ') ? p.Name.split(' - ')[0] : p.Name;
                    records.push({ Id: p.Id, Name: cleanName, DataInicio__c: p.DataInicio__c, DataFim__c: p.DataFim__c });
                }
            }
            records = records.slice(0, 24);
        }
        res.json(records); 
    } catch (e) { res.status(500).json({ error: e.message }); }
};

exports.getProjects = async (req, res) => {
    try {
        const conn = await getSfConnection();
        const { inicio, fim } = req.query;
        const emailLider = req.session.user.email;

        // Query corrigida sem o campo Contrato__r inválido
        const qAlloc = `SELECT Servico__c, Servico__r.Name, Servico__r.Conta__r.Name, Percentual__c, Pessoa__c FROM Alocacao__c WHERE Servico__r.Lider__r.Email__c = '${emailLider}' AND DataInicio__c <= ${fim} AND (DataFim__c >= ${inicio} OR DataFim__c = NULL)`;
        const qLanc = `SELECT Servico__c, Servico__r.Name, Servico__r.Conta__r.Name, Status__c, Horas__c, HorasExtras__c FROM LancamentoHora__c WHERE Servico__r.Lider__r.Email__c = '${emailLider}' AND DiaPeriodo__r.Data__c >= ${inicio} AND DiaPeriodo__r.Data__c <= ${fim} AND ${FILTRO_HORAS}`;

        const [resAlloc, resLanc] = await Promise.all([conn.query(qAlloc), conn.query(qLanc)]);

        const projectsMap = {};
        const diasUteisPeriodo = getBusinessDays(inicio, fim);

        resAlloc.records.forEach(row => {
            const sId = safeId(row.Servico__c);
            if (!projectsMap[sId]) {
                projectsMap[sId] = { serviceId: row.Servico__c, serviceName: row.Servico__r.Name, client: row.Servico__r.Conta__r.Name, metrics: { alocado: 0, normal: 0, extra: 0, ponderado: 0 }, teamSize: 0, idsAlocados: new Set(), statusUI: 'Ok' };
            }
            const cargaDiaria = 8; 
            const percent = (row.Percentual__c || 0) / 100;
            projectsMap[sId].metrics.alocado += (diasUteisPeriodo * cargaDiaria * percent);
            projectsMap[sId].idsAlocados.add(row.Pessoa__c);
        });

        resLanc.records.forEach(row => {
            const sId = safeId(row.Servico__c);
            if (!projectsMap[sId] && row.Servico__c) {
                projectsMap[sId] = { serviceId: row.Servico__c, serviceName: row.Servico__r ? row.Servico__r.Name : 'Serviço', client: row.Servico__r && row.Servico__r.Conta__r ? row.Servico__r.Conta__r.Name : 'Cliente', metrics: { alocado: 0, normal: 0, extra: 0, ponderado: 0 }, teamSize: 0, idsAlocados: new Set(), statusUI: 'Ok' };
            }
            if (projectsMap[sId]) {
                const norm = row.Horas__c || 0;
                const ext = row.HorasExtras__c || 0;
                projectsMap[sId].metrics.normal += norm;
                projectsMap[sId].metrics.extra += ext;
                projectsMap[sId].metrics.ponderado += (norm + ext);
                if (['Lançado', 'Pendente', 'Rascunho', 'Submetido'].includes(row.Status__c)) projectsMap[sId].statusUI = 'Aberto';
            }
        });

        const result = Object.values(projectsMap).map(p => {
            p.teamSize = p.idsAlocados.size;
            let percent = p.metrics.alocado > 0 ? Math.round((p.metrics.ponderado/p.metrics.alocado)*100) : (p.metrics.ponderado > 0 ? 100 : 0);
            return { ...p, percentual: percent };
        });
        res.json(result);
    } catch (e) { res.status(500).json({ error: e.message }); }
};

exports.getProjectResources = async (req, res) => {
    try {
        const conn = await getSfConnection();
        const { serviceId } = req.params;
        const { inicio, fim } = req.query;
        const emailLider = req.session.user.email;

        const qAlloc = `SELECT Pessoa__c, Pessoa__r.Name, Percentual__c FROM Alocacao__c WHERE Servico__c = '${serviceId}' AND Servico__r.Lider__r.Email__c = '${emailLider}' AND DataInicio__c <= ${fim} AND (DataFim__c >= ${inicio} OR DataFim__c = NULL)`;
        const qPeriodos = `SELECT ContratoPessoa__r.Pessoa__c, ContratoPessoa__r.Hora__c FROM Periodo__c WHERE DataInicio__c <= ${fim} AND DataFim__c >= ${inicio}`;
        const qLanc = `SELECT Pessoa__c, Pessoa__r.Name, Status__c, Horas__c, HorasExtras__c, HorasBanco__c, HorasAusenciaRemunerada__c, HorasAusenciaNaoRemunerada__c FROM LancamentoHora__c WHERE Servico__c = '${serviceId}' AND DiaPeriodo__r.Data__c >= ${inicio} AND DiaPeriodo__r.Data__c <= ${fim} AND ${FILTRO_HORAS}`;

        const [resAlloc, resPeriodos, resLanc] = await Promise.all([conn.query(qAlloc), conn.query(qPeriodos), conn.query(qLanc)]);

        const mapCargaHoraria = {};
        resPeriodos.records.forEach(p => {
            const pId = p.ContratoPessoa__r ? p.ContratoPessoa__r.Pessoa__c : null;
            if(pId) mapCargaHoraria[safeId(pId)] = p.ContratoPessoa__r ? p.ContratoPessoa__r.Hora__c : 8;
        });

        const diasUteis = getBusinessDays(inicio, fim);
        const resourcesMap = {};

        resAlloc.records.forEach(row => {
            const pId = safeId(row.Pessoa__c);
            const cargaDiaria = mapCargaHoraria[pId] || 8;
            const percent = (row.Percentual__c || 0) / 100;
            resourcesMap[pId] = {
                id: row.Pessoa__c, name: row.Name || row.Pessoa__r.Name, alocado: (diasUteis * cargaDiaria * percent),
                totalRealizado: 0, horasNormais: 0, horasExtrasPgto: 0, horasExtrasBanco: 0, horasAusenciaBanco: 0, horasAusenciaOutras: 0,
                countPending: 0, countApproved: 0, countRejected: 0
            };
        });

        resLanc.records.forEach(row => {
            const pId = safeId(row.Pessoa__c);
            if (!resourcesMap[pId] && row.Pessoa__c) {
                resourcesMap[pId] = {
                    id: row.Pessoa__c, name: row.Pessoa__r ? row.Pessoa__r.Name : 'Colaborador', alocado: 0,
                    totalRealizado: 0, horasNormais: 0, horasExtrasPgto: 0, horasExtrasBanco: 0, horasAusenciaBanco: 0, horasAusenciaOutras: 0,
                    countPending: 0, countApproved: 0, countRejected: 0
                };
            }
            if (resourcesMap[pId]) {
                const r = resourcesMap[pId];
                const hNorm = parseFloat(row.Horas__c) || 0;
                const hExt = parseFloat(row.HorasExtras__c) || 0;
                const hBanco = parseFloat(row.HorasBanco__c) || 0;
                const hAusRem = parseFloat(row.HorasAusenciaRemunerada__c) || 0;
                const hAusNao = parseFloat(row.HorasAusenciaNaoRemunerada__c) || 0;

                r.horasNormais += hNorm;
                r.horasExtrasPgto += hExt;
                if (hBanco > 0) r.horasExtrasBanco += hBanco; else r.horasAusenciaBanco += Math.abs(hBanco);
                r.horasAusenciaOutras += (hAusRem + hAusNao);
                r.totalRealizado += (hNorm + hExt); 

                const st = row.Status__c;
                if (['Lançado', 'Pendente', 'Rascunho', 'Submetido'].includes(st)) r.countPending++;
                else if (['Aprovado', 'Faturado'].includes(st)) r.countApproved++;
                else if (['Reprovado'].includes(st)) r.countRejected++;
            }
        });

        const result = Object.values(resourcesMap).map(r => {
            let percent = 0;
            if (r.alocado > 0) percent = Math.round((r.totalRealizado / r.alocado) * 100);
            else if (r.totalRealizado > 0) percent = 100;
            if (r.alocado === 0 && r.totalRealizado > 0) r.noContract = true;
            return { ...r, percentual: percent };
        });
        result.sort((a, b) => b.countPending - a.countPending);
        res.json(result);
    } catch (e) { res.status(500).json({ error: e.message }); }
};

exports.getResourceActivities = async (req, res) => {
    try {
        const conn = await getSfConnection();
        const { serviceId, personId } = req.params;
        const { inicio, fim } = req.query;

        // FILTRO APLICADO CONFORME SOLICITADO
        const soql = `
            SELECT DiaPeriodo__r.Data__c, Atividade__r.Name, Status__c, Justificativa__c,
                   Horas__c, HorasExtras__c, HorasBanco__c, 
                   HorasAusenciaRemunerada__c, HorasAusenciaNaoRemunerada__c
            FROM LancamentoHora__c 
            WHERE DiaPeriodo__r.Data__c >= ${inicio} AND DiaPeriodo__r.Data__c <= ${fim}
            AND Servico__c = '${serviceId}' AND Pessoa__c = '${personId}'
            AND ${FILTRO_HORAS}
            ORDER BY DiaPeriodo__r.Data__c ASC
            LIMIT 2000
        `;

        const result = await conn.query(soql);
        const activities = result.records.map(r => ({
            data: r.DiaPeriodo__r ? r.DiaPeriodo__r.Data__c : '-',
            atividade: r.Atividade__r ? r.Atividade__r.Name : 'Geral',
            status: r.Status__c,
            justificativa: r.Justificativa__c,
            normal: r.Horas__c || 0,
            extraPgto: r.HorasExtras__c || 0,
            extraBanco: (r.HorasBanco__c > 0 ? r.HorasBanco__c : 0),
            ausenciaBanco: (r.HorasBanco__c < 0 ? Math.abs(r.HorasBanco__c) : 0),
            ausenciaOutras: (r.HorasAusenciaRemunerada__c || 0) + (r.HorasAusenciaNaoRemunerada__c || 0)
        }));
        res.json(activities);
    } catch (e) { res.status(500).json({ error: e.message }); }
};

exports.handleApprovalAction = async (req, res) => {
    const { serviceId, personId, action, inicio, fim, motivo } = req.body;
    const novoStatus = (action === 'approve') ? 'Aprovado' : 'Reprovado';
    try {
        const conn = await getSfConnection();
        const soqlBusca = `
            SELECT Id FROM LancamentoHora__c 
            WHERE Servico__c = '${serviceId}' AND Pessoa__c = '${personId}' 
            AND DiaPeriodo__r.Data__c >= ${inicio} AND DiaPeriodo__r.Data__c <= ${fim} 
            AND Status__c IN ('Lançado', 'Pendente', 'Reprovado', 'Rascunho', 'Submetido')
            AND ${FILTRO_HORAS}
        `;
        const resultBusca = await conn.query(soqlBusca);
        if (resultBusca.totalSize === 0) return res.json({ success: false, message: 'Nada para processar.' });

        const allUpdates = resultBusca.records.map(rec => {
            const upd = { Id: rec.Id, Status__c: novoStatus };
            if (action === 'reject' && motivo) upd.MotivoReprovacao__c = motivo;
            if (action === 'approve') upd.MotivoReprovacao__c = null;
            return upd;
        });
        await conn.update('LancamentoHora__c', allUpdates);
        res.json({ success: true, message: 'Sucesso.' });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
};

exports.getDashboardMetrics = async (req, res) => {
    try {
        const conn = await getSfConnection();
        const userId = req.session.user.id;
        const emailLider = req.session.user.email;
        const { inicio, fim, scope } = req.query; 
        if (!inicio || !fim) return res.status(400).json({ error: 'Período obrigatório.' });

        // --- MODO PESSOAL (PERFIL DE EFICIÊNCIA) ---
        if (scope === 'personal') {
            // 1. Busca Dados do Período (Carga Horária e ID)
            const qPeriodo = `
                SELECT Id, ContratoPessoa__r.Hora__c 
                FROM Periodo__c 
                WHERE ContratoPessoa__r.Pessoa__c = '${userId}' 
                AND DataInicio__c <= ${fim} AND DataFim__c >= ${inicio} 
                LIMIT 1
            `;
            const resPeriodo = await conn.query(qPeriodo);
            const periodoRecord = resPeriodo.records[0];
            
            const cargaDiaria = (periodoRecord && periodoRecord.ContratoPessoa__r) ? periodoRecord.ContratoPessoa__r.Hora__c : 8;
            
            // 2. Conta Dias Úteis Reais (Query separada para evitar erro de relacionamento)
            let diasUteis = 0;
            if (periodoRecord) {
                const qDias = `SELECT COUNT(Id) total FROM DiaPeriodo__c WHERE Periodo__c = '${periodoRecord.Id}' AND Tipo__c = 'Útil'`;
                const resDias = await conn.query(qDias);
                diasUteis = (resDias.records[0] && resDias.records[0].total) ? resDias.records[0].total : 0;
            }

            // 3. Busca Alocações (Para calcular o previsto)
            const qAlloc = `SELECT Percentual__c FROM Alocacao__c WHERE Pessoa__c = '${userId}' AND DataInicio__c <= ${fim} AND (DataFim__c >= ${inicio} OR DataFim__c = NULL)`;
            const resAlloc = await conn.query(qAlloc);
            
            let totalAlocado = 0;
            resAlloc.records.forEach(r => {
                const perc = (r.Percentual__c || 0) / 100;
                totalAlocado += (diasUteis * cargaDiaria * perc);
            });

            // 3. Busca Lançamentos (Realizado e Status)
            const qLanc = `SELECT Status__c, Horas__c, HorasExtras__c, HorasBanco__c FROM LancamentoHora__c WHERE Pessoa__c = '${userId}' AND DiaPeriodo__r.Data__c >= ${inicio} AND DiaPeriodo__r.Data__c <= ${fim} AND ${FILTRO_HORAS}`;
            const resLanc = await conn.query(qLanc);

            let totalLanc = 0, totalPend = 0, totalBancoPeriodo = 0;
            const distProj = {};

            resLanc.records.forEach(r => {
                const h = (r.Horas__c || 0) + (r.HorasExtras__c || 0);
                totalLanc += h;
                totalBancoPeriodo += (r.HorasBanco__c || 0);

                if (['Rascunho', 'Reprovado'].includes(r.Status__c)) totalPend += h;
            });

            // 4. Saldo Banco Geral (Total)
            const qBanco = `SELECT SUM(HorasBanco__c) total FROM LancamentoHora__c WHERE Pessoa__c = '${userId}' AND HorasBanco__c != 0`;
            const resBanco = await conn.query(qBanco);
            const saldoBanco = (resBanco.records[0] && resBanco.records[0].total) ? resBanco.records[0].total : 0;

            let efic = totalAlocado > 0 ? Math.round((totalLanc / totalAlocado) * 100) : (totalLanc > 0 ? 100 : 0);

            return res.json({ 
                totalAlocadas: totalAlocado, 
                totalLancadas: totalLanc, 
                eficiencia: efic, 
                totalPendentes: totalPend,
                saldoBanco: saldoBanco
            });
        }

        // --- MODO GESTOR (LEGADO) ---
        const [resLanc, resAloc] = await Promise.all([
            conn.query(`SELECT Status__c, SUM(Horas__c) total FROM LancamentoHora__c WHERE Servico__r.Lider__r.Email__c = '${emailLider}' AND DiaPeriodo__r.Data__c >= ${inicio} AND DiaPeriodo__r.Data__c <= ${fim} AND ${FILTRO_HORAS} GROUP BY Status__c`),
            conn.query(`SELECT SUM(HorasAlocadas__c) totalHorasDia FROM Alocacao__c WHERE Servico__r.Lider__r.Email__c = '${emailLider}' AND DataInicio__c <= ${fim} AND (DataFim__c >= ${inicio} OR DataFim__c = NULL)`)
        ]);

        let totalAlocado = 0;
        resAloc.records.forEach(r => totalAlocado += (r.totalHorasDia || r.expr0 || 0) * 21);
        let totalLanc = 0, totalPend = 0;
        resLanc.records.forEach(r => {
            const h = r.total || r.expr0 || 0;
            totalLanc += h;
            if (['Lançado', 'Pendente', 'Rascunho', 'Submetido'].includes(r.Status__c)) totalPend += h;
        });
        let efic = totalAlocado > 0 ? Math.round(((totalLanc - totalPend) / totalAlocado) * 100) : 0;
        res.json({ totalAlocadas: totalAlocado, totalLancadas: totalLanc, eficiencia: efic, totalPendentes: totalPend });
    } catch (e) { res.status(500).json({ error: e.message }); }
};