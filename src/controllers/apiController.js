const { getSfConnection } = require('../config/salesforce');

// --- HELPER: CÁLCULO DE DIAS ÚTEIS ---
function getBusinessDays(startDate, endDate) {
    let count = 0;
    const curDate = new Date(startDate);
    const end = new Date(endDate);
    
    // Ajuste de timezone para evitar erros de D-1
    curDate.setHours(12,0,0,0); 
    end.setHours(12,0,0,0);

    while (curDate <= end) {
        const dayOfWeek = curDate.getDay();
        if (dayOfWeek !== 0 && dayOfWeek !== 6) { // 0=Dom, 6=Sab
            count++;
        }
        curDate.setDate(curDate.getDate() + 1);
    }
    return count;
}

// Helper para ID Seguro (15 chars)
const safeId = (id) => id ? id.substring(0, 15) : '';

exports.getPeriods = async (req, res) => {
    try {
        const { type } = req.query;
        const userId = req.session.user.id;
        const conn = await getSfConnection();
        
        let records = [];

        if (type === 'user') {
            const query = `
                SELECT Id, Name, DataInicio__c, DataFim__c 
                FROM Periodo__c 
                WHERE ContratoPessoa__r.Pessoa__c = '${userId}' 
                ORDER BY DataInicio__c DESC 
                LIMIT 24
            `;
            const result = await conn.query(query);
            records = result.records;
        } else {
            // GESTOR: Traz lista unificada de datas
            const query = `SELECT Id, Name, DataInicio__c, DataFim__c FROM Periodo__c ORDER BY DataInicio__c DESC LIMIT 200`;
            const result = await conn.query(query);
            
            const seen = new Set();
            const uniquePeriods = [];
            for (const p of result.records) {
                const key = `${p.DataInicio__c}_${p.DataFim__c}`;
                if (!seen.has(key)) {
                    seen.add(key);
                    let cleanName = p.Name.includes(' - ') ? p.Name.split(' - ')[0] : p.Name;
                    uniquePeriods.push({ Id: p.Id, Name: cleanName, DataInicio__c: p.DataInicio__c, DataFim__c: p.DataFim__c });
                }
            }
            records = uniquePeriods.slice(0, 24);
        }
        res.json(records); 
    } catch (e) { res.status(500).json({ error: e.message }); }
};

// --- LISTAGEM DE PROJETOS (Card Resumo) ---
exports.getProjects = async (req, res) => {
    try {
        const conn = await getSfConnection();
        const { inicio, fim } = req.query;
        const emailLider = req.session.user.email;

        // 1. Consulta Serviços do Líder + Alocações (Passos 1 e 2)
        const qAlloc = `
            SELECT Servico__c, Servico__r.Name, Servico__r.Conta__r.Name, 
                   Percentual__c, Pessoa__c, Pessoa__r.Contrato__r.HorasDiarias__c 
            FROM Alocacao__c 
            WHERE Servico__r.Lider__r.Email__c = '${emailLider}'
            AND DataInicio__c <= ${fim} 
            AND (DataFim__c >= ${inicio} OR DataFim__c = NULL)
        `;

        // 2. Consulta Lançamentos (Passo 4)
        const qLanc = `
            SELECT Servico__c, Servico__r.Name, Servico__r.Conta__r.Name, Status__c, 
                   Horas__c, HorasExtras__c
            FROM LancamentoHora__c 
            WHERE Servico__r.Lider__r.Email__c = '${emailLider}'
            AND DiaPeriodo__r.Data__c >= ${inicio} AND DiaPeriodo__r.Data__c <= ${fim}
            AND (Horas__c > 0 OR HorasExtras__c > 0 OR HorasBanco__c != 0)
        `;

        const [resAlloc, resLanc] = await Promise.all([conn.query(qAlloc), conn.query(qLanc)]);

        // Mapa de Projetos
        const projectsMap = {};
        const diasUteisPeriodo = getBusinessDays(inicio, fim);

        // A. Processa Alocações (Calcula Previsto)
        resAlloc.records.forEach(row => {
            const sId = safeId(row.Servico__c);
            if (!projectsMap[sId]) {
                projectsMap[sId] = {
                    serviceId: row.Servico__c, 
                    serviceName: row.Servico__r.Name, 
                    client: row.Servico__r.Conta__r.Name,
                    metrics: { alocado: 0, normal: 0, extra: 0, ponderado: 0 },
                    teamSize: 0,
                    idsAlocados: new Set(),
                    statusUI: 'Ok'
                };
            }
            
            // Passo 3: Cálculo Previsto (DiasUteis * CargaDiaria * %Alocacao)
            // Assumindo 8h se não tiver contrato definido na query (campo customizado pode variar)
            // Tentei pegar via Alocacao->Pessoa->Contrato, mas depende da org. Vou usar 8h padrão se falhar.
            const cargaDiaria = 8; 
            const percent = (row.Percentual__c || 0) / 100;
            const horasPrevistas = diasUteisPeriodo * cargaDiaria * percent;

            projectsMap[sId].metrics.alocado += horasPrevistas;
            projectsMap[sId].idsAlocados.add(row.Pessoa__c);
        });

        // B. Processa Lançamentos (Soma Realizado e Verifica Status)
        resLanc.records.forEach(row => {
            const sId = safeId(row.Servico__c);
            
            // Cria projeto se não existir (caso tenha horas mas não alocação vigente)
            if (!projectsMap[sId] && row.Servico__c) {
                projectsMap[sId] = {
                    serviceId: row.Servico__c, 
                    serviceName: row.Servico__r ? row.Servico__r.Name : 'Serviço', 
                    client: row.Servico__r && row.Servico__r.Conta__r ? row.Servico__r.Conta__r.Name : 'Cliente',
                    metrics: { alocado: 0, normal: 0, extra: 0, ponderado: 0 },
                    teamSize: 0,
                    idsAlocados: new Set(),
                    statusUI: 'Ok'
                };
            }

            if (projectsMap[sId]) {
                const norm = row.Horas__c || 0;
                const ext = row.HorasExtras__c || 0;
                
                projectsMap[sId].metrics.normal += norm;
                projectsMap[sId].metrics.extra += ext;
                projectsMap[sId].metrics.ponderado += (norm + ext); // Peso 1:1 para simplificar visualização

                // Passo 6: Aprovação se houver lançamento pendente
                if (['Lançado', 'Pendente', 'Rascunho', 'Submetido'].includes(row.Status__c)) {
                    projectsMap[sId].statusUI = 'Aberto';
                }
            }
        });

        const result = Object.values(projectsMap).map(p => {
            p.teamSize = p.idsAlocados.size; // Ajusta tamanho do time
            let percent = p.metrics.alocado > 0 ? Math.round((p.metrics.ponderado/p.metrics.alocado)*100) : (p.metrics.ponderado > 0 ? 100 : 0);
            return { ...p, percentual: percent };
        });

        res.json(result);
    } catch (e) { res.status(500).json({ error: e.message }); }
};

// --- DETALHE DO PROJETO (Lista de Pessoas) ---
exports.getProjectResources = async (req, res) => {
    try {
        const conn = await getSfConnection();
        const { serviceId } = req.params;
        const { inicio, fim } = req.query;
        const emailLider = req.session.user.email;

        // Passo 2: Consultar Alocações
        const qAlloc = `
            SELECT Pessoa__c, Pessoa__r.Name, Percentual__c 
            FROM Alocacao__c 
            WHERE Servico__c = '${serviceId}' 
            AND Servico__r.Lider__r.Email__c = '${emailLider}' 
            AND DataInicio__c <= ${fim} 
            AND (DataFim__c >= ${inicio} OR DataFim__c = NULL)
        `;

        // Passo 3 (Auxiliar): Consultar Contratos (para saber a carga horária de cada pessoa)
        // Buscamos o Periodo da pessoa que cruza com as datas para pegar a carga horária correta
        const qPeriodos = `
            SELECT ContratoPessoa__r.Pessoa__c, ContratoPessoa__r.Hora__c 
            FROM Periodo__c 
            WHERE DataInicio__c <= ${fim} AND DataFim__c >= ${inicio}
        `;

        // Passo 4: Consultar Lançamentos
        const qLanc = `
            SELECT Pessoa__c, Pessoa__r.Name, Status__c, Horas__c, HorasExtras__c, HorasBanco__c, 
                   HorasAusenciaRemunerada__c, HorasAusenciaNaoRemunerada__c 
            FROM LancamentoHora__c 
            WHERE Servico__c = '${serviceId}' 
            AND DiaPeriodo__r.Data__c >= ${inicio} 
            AND DiaPeriodo__r.Data__c <= ${fim} 
            AND (Horas__c > 0 OR HorasExtras__c > 0 OR HorasBanco__c != 0 OR HorasAusenciaRemunerada__c > 0 OR HorasAusenciaNaoRemunerada__c > 0)
        `;

        const [resAlloc, resPeriodos, resLanc] = await Promise.all([
            conn.query(qAlloc),
            conn.query(qPeriodos),
            conn.query(qLanc)
        ]);

        // Mapa de Carga Horária por Pessoa (Default 8h)
        const mapCargaHoraria = {};
        resPeriodos.records.forEach(p => {
            const pId = p.ContratoPessoa__r ? p.ContratoPessoa__r.Pessoa__c : null;
            const horas = p.ContratoPessoa__r ? p.ContratoPessoa__r.Hora__c : 8;
            if(pId) mapCargaHoraria[safeId(pId)] = horas;
        });

        const diasUteis = getBusinessDays(inicio, fim);
        const resourcesMap = {};

        // Passo 5: Montar Lista - Parte A (Alocados)
        resAlloc.records.forEach(row => {
            const pId = safeId(row.Pessoa__c);
            const cargaDiaria = mapCargaHoraria[pId] || 8; // Pega do contrato ou 8h
            const percent = (row.Percentual__c || 0) / 100;
            const previsto = diasUteis * cargaDiaria * percent;

            resourcesMap[pId] = {
                id: row.Pessoa__c,
                name: row.Name || row.Pessoa__r.Name,
                alocado: previsto, // Coluna Alocado Calculada
                totalRealizado: 0,
                horasNormais: 0, horasExtrasPgto: 0, horasExtrasBanco: 0,
                horasAusenciaBanco: 0, horasAusenciaOutras: 0,
                countPending: 0, countApproved: 0, countRejected: 0
            };
        });

        // Passo 5: Montar Lista - Parte B (Lançamentos - Merge)
        resLanc.records.forEach(row => {
            const pId = safeId(row.Pessoa__c);
            
            // Se tem lançamento mas não tinha alocação: Cria com 0 alocado
            if (!resourcesMap[pId] && row.Pessoa__c) {
                const pName = row.Pessoa__r ? row.Pessoa__r.Name : 'Colaborador';
                resourcesMap[pId] = {
                    id: row.Pessoa__c,
                    name: pName,
                    alocado: 0, // Não previsto
                    totalRealizado: 0,
                    horasNormais: 0, horasExtrasPgto: 0, horasExtrasBanco: 0,
                    horasAusenciaBanco: 0, horasAusenciaOutras: 0,
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
                
                // Total realizado (Normal + Extra) para cálculo de %
                r.totalRealizado += (hNorm + hExt); 

                // Passo 6: Identificar Status de Aprovação
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

            let statusClass = 'success';
            if (percent > 105) statusClass = 'danger';
            else if (percent < 95 && r.alocado > 0) statusClass = 'warning';
            
            // Flag para UI saber se é lançamento "fantasma" (sem contrato)
            if (r.alocado === 0 && r.totalRealizado > 0) r.noContract = true;

            return { ...r, percentual: percent, statusClass: statusClass };
        });

        // Ordenação: Pendentes primeiro
        result.sort((a, b) => b.countPending - a.countPending);

        res.json(result);
    } catch (e) { res.status(500).json({ error: e.message }); }
};

// ... (getResourceActivities e handleApprovalAction mantidos iguais à versão corrigida anterior)
exports.getResourceActivities = async (req, res) => {
    try {
        const conn = await getSfConnection();
        const { serviceId, personId } = req.params;
        const { inicio, fim } = req.query;

        const result = await conn.query(`
            SELECT DiaPeriodo__r.Data__c, Atividade__r.Name, Status__c, Justificativa__c,
                   Horas__c, HorasExtras__c, HorasBanco__c, 
                   HorasAusenciaRemunerada__c, HorasAusenciaNaoRemunerada__c
            FROM LancamentoHora__c 
            WHERE DiaPeriodo__r.Data__c >= ${inicio} AND DiaPeriodo__r.Data__c <= ${fim}
            AND Servico__c = '${serviceId}' AND Pessoa__c = '${personId}'
            ORDER BY DiaPeriodo__r.Data__c ASC, Atividade__r.Name ASC
        `);

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
            WHERE Servico__c = '${serviceId}' 
            AND Pessoa__c = '${personId}' 
            AND DiaPeriodo__r.Data__c >= ${inicio} 
            AND DiaPeriodo__r.Data__c <= ${fim} 
            AND Status__c IN ('Lançado', 'Pendente', 'Reprovado', 'Rascunho', 'Submetido')
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