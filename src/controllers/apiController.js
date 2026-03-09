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
            const query = `SELECT Id, Name, DataInicio__c, DataFim__c, Status__c FROM Periodo__c WHERE ContratoPessoa__r.Pessoa__c = '${userId}' ORDER BY DataInicio__c DESC LIMIT 24`;
            const result = await conn.query(query);
            records = result.records;
        } else {
            const emailLider = req.session.user.email;
            
            // Busca ciclos únicos agrupando por data, cobrindo todo o histórico
            const query = `
                SELECT DataInicio__c, DataFim__c 
                FROM Periodo__c 
                GROUP BY DataInicio__c, DataFim__c 
                ORDER BY DataInicio__c DESC 
                LIMIT 1000
            `;
            
            // Busca o ciclo padrão sugerido (o mais antigo que NÃO esteja Finalizado/Pago nos serviços do gestor)
            const qDefault = `
                SELECT DiaPeriodo__r.Periodo__r.DataInicio__c, DiaPeriodo__r.Periodo__r.DataFim__c 
                FROM LancamentoHora__c 
                WHERE DiaPeriodo__r.Periodo__r.Status__c != 'Finalizado/Pago'
                AND Servico__r.Lider__r.Email__c = '${emailLider}'
                ORDER BY DiaPeriodo__r.Periodo__r.DataInicio__c ASC 
                LIMIT 1
            `;
            
            const [result, resDefault] = await Promise.all([
                conn.query(query),
                conn.query(qDefault)
            ]);
            
            const suggestedDefault = resDefault.records[0] ? `${resDefault.records[0].DiaPeriodo__r.Periodo__r.DataInicio__c}_${resDefault.records[0].DiaPeriodo__r.Periodo__r.DataFim__c}` : null;

            records = result.records.map(p => {
                const start = new Date(p.DataInicio__c + 'T12:00:00');
                const monthName = start.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
                const name = monthName.charAt(0).toUpperCase() + monthName.slice(1);
                const id = `${p.DataInicio__c}_${p.DataFim__c}`;
                
                return {
                    Id: id,
                    Name: name,
                    DataInicio__c: p.DataInicio__c,
                    DataFim__c: p.DataFim__c,
                    isSuggestedDefault: (id === suggestedDefault)
                };
            });
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
        const qAlloc = `
            SELECT Servico__c, Servico__r.Name, Servico__r.Conta__r.Name, Servico__r.Tipo__c, 
                   Servico__r.Contrato__r.HorasContratadas__c, Percentual__c, Pessoa__c 
            FROM Alocacao__c 
            WHERE Servico__r.Lider__r.Email__c = '${emailLider}' 
            AND DataInicio__c <= ${fim} 
            AND (DataFim__c >= ${inicio} OR DataFim__c = NULL)
        `;
        const qLanc = `
            SELECT Servico__c, Servico__r.Name, Servico__r.Conta__r.Name, Servico__r.Tipo__c, 
                   Servico__r.Contrato__r.HorasContratadas__c, Status__c, Horas__c, HorasExtras__c 
            FROM LancamentoHora__c 
            WHERE Servico__r.Lider__r.Email__c = '${emailLider}' 
            AND DiaPeriodo__r.Data__c >= ${inicio} AND DiaPeriodo__r.Data__c <= ${fim} 
            AND ${FILTRO_HORAS}
        `;

        const [resAlloc, resLanc] = await Promise.all([conn.query(qAlloc), conn.query(qLanc)]);

        const projectsMap = {};
        const diasUteisPeriodo = getBusinessDays(inicio, fim);

        // Função auxiliar para inicializar ou recuperar projeto no map com a lógica Suporte
        const getOrInitProject = (row) => {
            const sId = safeId(row.Servico__c);
            if (!projectsMap[sId]) {
                const sObj = row.Servico__r || {};
                const isSupport = sObj.Tipo__c === 'Suporte';
                const plannedHours = isSupport ? (sObj.Contrato__r?.HorasContratadas__c || 0) : 0;

                projectsMap[sId] = { 
                    serviceId: row.Servico__c, 
                    serviceName: sObj.Name || 'Serviço', 
                    client: sObj.Conta__r?.Name || 'Cliente', 
                    metrics: { alocado: plannedHours, normal: 0, extra: 0, ponderado: 0 }, 
                    teamSize: 0, 
                    idsAlocados: new Set(), 
                    statusUI: 'Ok',
                    isSupport: isSupport
                };
            }
            return projectsMap[sId];
        };

        resAlloc.records.forEach(row => {
            const p = getOrInitProject(row);
            
            // Se NÃO for suporte, somamos o planejado baseado no percentual das alocações
            if (!p.isSupport) {
                const cargaDiaria = 8; 
                const percent = (row.Percentual__c || 0) / 100;
                p.metrics.alocado += (diasUteisPeriodo * cargaDiaria * percent);
            }
            
            p.idsAlocados.add(row.Pessoa__c);
        });

        resLanc.records.forEach(row => {
            const p = getOrInitProject(row);
            
            const norm = row.Horas__c || 0;
            const ext = row.HorasExtras__c || 0;
            p.metrics.normal += norm;
            p.metrics.extra += ext;
            p.metrics.ponderado += (norm + (ext * 2));
            
            if (['Em aprovação do serviço', 'Rascunho', 'Reprovado serviço', 'Reprovado RH'].includes(row.Status__c)) {
                p.statusUI = 'Aberto';
            }
        });

        const result = Object.values(projectsMap).map(p => {
            p.teamSize = p.idsAlocados.size;
            let percent = p.metrics.alocado > 0 ? Math.round((p.metrics.ponderado/p.metrics.alocado)*100) : (p.metrics.ponderado > 0 ? 100 : 0);
            return { ...p, percentual: percent };
        });
        
        // Ordenação por Nome (serviceName) ASC
        result.sort((a, b) => a.serviceName.localeCompare(b.serviceName));

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
        const qPeriodos = `SELECT ContratoPessoa__r.Pessoa__c, ContratoPessoa__r.Hora__c, Status__c FROM Periodo__c WHERE DataInicio__c <= ${fim} AND DataFim__c >= ${inicio}`;
        const qLanc = `SELECT Pessoa__c, Pessoa__r.Name, Status__c, Horas__c, HorasExtras__c, HorasBanco__c, HorasAusenciaRemunerada__c, HorasAusenciaNaoRemunerada__c FROM LancamentoHora__c WHERE Servico__c = '${serviceId}' AND DiaPeriodo__r.Data__c >= ${inicio} AND DiaPeriodo__r.Data__c <= ${fim} AND ${FILTRO_HORAS}`;

        const [resAlloc, resPeriodos, resLanc] = await Promise.all([conn.query(qAlloc), conn.query(qPeriodos), conn.query(qLanc)]);

        const mapPeriodoInfo = {};
        resPeriodos.records.forEach(p => {
            const pId = p.ContratoPessoa__r ? p.ContratoPessoa__r.Pessoa__c : null;
            if(pId) {
                mapPeriodoInfo[safeId(pId)] = {
                    carga: p.ContratoPessoa__r ? p.ContratoPessoa__r.Hora__c : 8,
                    status: p.Status__c || 'Aberto'
                };
            }
        });

        const diasUteis = getBusinessDays(inicio, fim);
        const resourcesMap = {};

        resAlloc.records.forEach(row => {
            const pId = safeId(row.Pessoa__c);
            const info = mapPeriodoInfo[pId] || { carga: 8, status: 'Aberto' };
            const percent = (row.Percentual__c || 0) / 100;
            resourcesMap[pId] = {
                id: row.Pessoa__c, name: row.Name || row.Pessoa__r.Name, alocado: (diasUteis * info.carga * percent),
                periodStatus: info.status,
                totalRealizado: 0, horasNormais: 0, horasExtrasPgto: 0, horasExtrasBanco: 0, horasAusenciaBanco: 0, horasAusenciaOutras: 0,
                countPending: 0, countApproved: 0, countRejected: 0
            };
        });

        resLanc.records.forEach(row => {
            const pId = safeId(row.Pessoa__c);
            if (!resourcesMap[pId] && row.Pessoa__c) {
                const info = mapPeriodoInfo[pId] || { carga: 8, status: 'Aberto' };
                resourcesMap[pId] = {
                    id: row.Pessoa__c, name: row.Pessoa__r ? row.Pessoa__r.Name : 'Colaborador', alocado: 0,
                    periodStatus: info.status,
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
                
                // CÁLCULO TOTAL: Normal + (Extra Pago * 2)
                r.totalRealizado += (hNorm + (hExt * 2)); 

                const st = row.Status__c;
                // PENDÊNCIA REAL DE SERVIÇO: Itens que o gestor precisa agir AGORA
                if (st === 'Em aprovação do serviço') r.countPending++;
                
                if (['Em aprovação do RH', 'Aprovado', 'Faturado', 'Fechado'].includes(st)) r.countApproved++;
                else if (['Reprovado serviço', 'Reprovado RH'].includes(st)) r.countRejected++;
            }
        });

        const result = Object.values(resourcesMap).map(r => {
            let percent = 0;
            if (r.alocado > 0) percent = Math.round((r.totalRealizado / r.alocado) * 100);
            else if (r.totalRealizado > 0) percent = 100;
            if (r.alocado === 0 && r.totalRealizado > 0) r.noContract = true;
            return { ...r, percentual: percent };
        });

        // Ordenação por Nome (name) ASC
        result.sort((a, b) => a.name.localeCompare(b.name));

        res.json(result);
    } catch (e) { res.status(500).json({ error: e.message }); }
};

exports.getResourceActivities = async (req, res) => {
    try {
        const conn = await getSfConnection();
        const { serviceId, personId } = req.params;
        const { inicio, fim } = req.query;

        if (!serviceId || serviceId === 'null' || !personId || personId === 'null') {
            return res.status(400).json({ error: 'Identificadores de serviço ou pessoa inválidos.' });
        }

        // FILTRO APLICADO CONFORME SOLICITADO
        const soql = `
            SELECT Id, DiaPeriodo__r.Data__c, Atividade__r.Name, Status__c, Justificativa__c,
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
            id: r.Id,
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
    const { serviceId, personId, action, inicio, fim, motivo, entryIds } = req.body;
    const novoStatus = (action === 'approve') ? 'Em aprovação do RH' : 'Reprovado serviço';
    
    try {
        const conn = await getSfConnection();
        let soqlBusca = '';

        if (entryIds && Array.isArray(entryIds) && entryIds.length > 0) {
            // Modo individual ou massa por IDs específicos
            const idsList = entryIds.map(id => `'${id}'`).join(',');
            soqlBusca = `SELECT Id FROM LancamentoHora__c WHERE Id IN (${idsList}) AND Status__c = 'Em aprovação do serviço'`;
        } else {
            // Modo legado: Por colaborador e serviço no período
            soqlBusca = `
                SELECT Id FROM LancamentoHora__c 
                WHERE Servico__c = '${serviceId}' AND Pessoa__c = '${personId}' 
                AND DiaPeriodo__r.Data__c >= ${inicio} AND DiaPeriodo__r.Data__c <= ${fim} 
                AND Status__c = 'Em aprovação do serviço'
                AND ${FILTRO_HORAS}
            `;
        }

        const resultBusca = await conn.query(soqlBusca);
        if (resultBusca.totalSize === 0) return res.json({ success: false, message: 'Nenhum lançamento pendente encontrado.' });

        const allUpdates = resultBusca.records.map(rec => {
            const upd = { Id: rec.Id, Status__c: novoStatus };
            if (action === 'reject' && motivo) upd.MotivoReprovacao__c = motivo;
            if (action === 'approve') upd.MotivoReprovacao__c = null;
            return upd;
        });
        
        await conn.update('LancamentoHora__c', allUpdates);

        // --- LÓGICA DE TRANSIÇÃO DO STATUS DO PERÍODO ---
        
        // 1. Coleta os IDs dos Períodos afetados pelos lançamentos que acabamos de atualizar
        const updatesIds = allUpdates.map(u => `'${u.Id}'`).join(',');
        const logsQuery = `SELECT Periodo__c FROM LancamentoHora__c WHERE Id IN (${updatesIds}) GROUP BY Periodo__c`;
        const logsRes = await conn.query(logsQuery);
        const periodIds = [...new Set(logsRes.records.map(r => r.Periodo__c))];

        if (periodIds.length > 0) {
            if (action === 'reject') {
                // REPROVAÇÃO: Sempre volta o período para 'Aberto'
                const periodUpdates = periodIds.map(id => ({ Id: id, Status__c: 'Aberto' }));
                await conn.sobject('Periodo__c').update(periodUpdates);
            } else {
                // APROVAÇÃO: Verifica se o período PODE avançar para 'Aguardando Aprovação RH'
                for (const pId of periodIds) {
                    const pendingQuery = `
                        SELECT COUNT(Id) total 
                        FROM LancamentoHora__c 
                        WHERE Periodo__c = '${pId}' 
                        AND Status__c IN ('Rascunho', 'Reprovado serviço', 'Reprovado RH', 'Em aprovação do serviço')
                    `;
                    const pendingRes = await conn.query(pendingQuery);
                    const totalPending = parseInt(pendingRes.records[0].total || pendingRes.records[0].expr0 || 0);

                    // Se não há mais NADA pendente no período, ele avança
                    if (totalPending === 0) {
                        await conn.sobject('Periodo__c').update({ Id: pId, Status__c: 'Aguardando Aprovação RH' });
                    }
                }
            }
        }

        res.json({ success: true, message: `Lançamentos processados com sucesso.` });
    } catch (e) { 
        console.error("Erro handleApprovalAction:", e);
        res.status(500).json({ success: false, message: e.message }); 
    }
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
            // 1. Busca Dados do Período (Carga Horária, Status e ID) + Nota Fiscal
            const qPeriodo = `
                SELECT Id, Status__c, ContratoPessoa__r.Hora__c,
                       (SELECT Id, Status__c, MotivoReprovacao__c FROM NotasFiscais__r WHERE Tipo__c = 'Entrada' LIMIT 1)
                FROM Periodo__c 
                WHERE ContratoPessoa__r.Pessoa__c = '${userId}' 
                AND DataInicio__c <= ${fim} AND DataFim__c >= ${inicio} 
                LIMIT 1
            `;
            const resPeriodo = await conn.query(qPeriodo);
            const periodoRecord = resPeriodo.records[0];
            
            const cargaDiaria = (periodoRecord && periodoRecord.ContratoPessoa__r) ? periodoRecord.ContratoPessoa__r.Hora__c : 8;
            const statusPeriodo = periodoRecord ? periodoRecord.Status__c : 'Aberto';
            
            const nfRecord = (periodoRecord && periodoRecord.NotasFiscais__r && periodoRecord.NotasFiscais__r.records) ? periodoRecord.NotasFiscais__r.records[0] : null;

            // 2. Conta Dias Úteis Totais e Dias Completos
            let diasUteis = 0;
            let diasCompletos = 0;
            if (periodoRecord) {
                const qCompliance = `
                    SELECT COUNT(Id) total, DiaCompleto__c 
                    FROM DiaPeriodo__c 
                    WHERE Periodo__c = '${periodoRecord.Id}' AND Tipo__c = 'Útil'
                    GROUP BY DiaCompleto__c
                `;
                const resComp = await conn.query(qCompliance);
                resComp.records.forEach(r => {
                    const count = parseInt(r.total || r.expr0 || 0);
                    diasUteis += count;
                    if (r.DiaCompleto__c === true || r.DiaCompleto__c === 'true') diasCompletos += count;
                });
            }

            // 3. Busca Alocações (Para calcular o previsto)
            const qAlloc = `SELECT Percentual__c FROM Alocacao__c WHERE Pessoa__c = '${userId}' AND DataInicio__c <= ${fim} AND (DataFim__c >= ${inicio} OR DataFim__c = NULL)`;
            const resAlloc = await conn.query(qAlloc);
            
            let percentualTotalAlocacao = 0;
            resAlloc.records.forEach(r => {
                percentualTotalAlocacao += (r.Percentual__c || 0);
            });

            const percentualEfetivo = Math.min(percentualTotalAlocacao, 100) / 100;
            const totalAlocado = (diasUteis * cargaDiaria * percentualEfetivo);

            // 3. Busca Lançamentos (Realizado e Status)
            const qLanc = `SELECT Status__c, Horas__c, HorasExtras__c, HorasBanco__c FROM LancamentoHora__c WHERE Pessoa__c = '${userId}' AND DiaPeriodo__r.Data__c >= ${inicio} AND DiaPeriodo__r.Data__c <= ${fim} AND ${FILTRO_HORAS}`;
            const resLanc = await conn.query(qLanc);

            let totalLanc = 0, totalPend = 0, totalReprovadas = 0;

            resLanc.records.forEach(r => {
                const h = (r.Horas__c || 0) + (r.HorasExtras__c || 0);
                totalLanc += h;
                if (r.Status__c === 'Rascunho') totalPend += h;
                if (['Reprovado serviço', 'Reprovado RH'].includes(r.Status__c)) totalReprovadas += h;
            });

            // 4. Saldo Banco Geral (Total)
            const qBanco = `SELECT SUM(HorasBanco__c) total FROM LancamentoHora__c WHERE Pessoa__c = '${userId}' AND HorasBanco__c != 0`;
            const resBanco = await conn.query(qBanco);
            const saldoBanco = (resBanco.records[0] && resBanco.records[0].total) ? resBanco.records[0].total : 0;

            let efic = totalAlocado > 0 ? Math.round((totalLanc / totalAlocado) * 100) : (totalLanc > 0 ? 100 : 0);
            if (efic > 100) efic = 100;

            return res.json({ 
                totalAlocadas: totalAlocado, 
                totalLancadas: totalLanc, 
                eficiencia: efic, 
                totalPendentes: totalPend + totalReprovadas,
                totalReprovadas: totalReprovadas,
                saldoBanco: saldoBanco,
                statusPeriodo: statusPeriodo,
                compliance: {
                    total: diasUteis,
                    completed: diasCompletos
                },
                nf: nfRecord ? {
                    id: nfRecord.Id,
                    status: nfRecord.Status__c,
                    motivo: nfRecord.MotivoReprovacao__c
                } : null
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
            if (['Em aprovação do serviço', 'Em aprovação do RH', 'Rascunho', 'Reprovado serviço', 'Reprovado RH'].includes(r.Status__c)) totalPend += h;
        });
        let efic = totalAlocado > 0 ? Math.round(((totalLanc - totalPend) / totalAlocado) * 100) : 0;
        res.json({ totalAlocadas: totalAlocado, totalLancadas: totalLanc, eficiencia: efic, totalPendentes: totalPend });
    } catch (e) { res.status(500).json({ error: e.message }); }
};
