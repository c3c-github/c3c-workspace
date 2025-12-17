const { getSfConnection } = require('../config/salesforce');

// --- FUNÇÃO 1: BUSCAR DADOS (TABELA PRINCIPAL VIA PERÍODO) ---
exports.getHrEmployees = async (req, res) => {
    try {
        const conn = await getSfConnection();
        const { inicio, fim } = req.query;

        // 1. Busca dos Períodos, Pessoas e Variáveis de Meta
        // [MUDANÇA]: Adicionados campos QuantidadeDiasUteis__c e ContratoPessoa__r.Hora__c
        const soqlPeriodos = `
            SELECT Id, ContratoPessoa__r.Pessoa__c, ContratoPessoa__r.Pessoa__r.Name, 
                   ContratoPessoa__r.Cargo__c, TotalHoras__c,
                   QuantidadeDiasUteis__c, ContratoPessoa__r.Hora__c,
                   DataInicio__c, DataFim__c
            FROM Periodo__c
            WHERE DataInicio__c >= ${inicio}
            AND DataFim__c <= ${fim}
        `;

        // 2. Busca dos Status (Agrupado por Período)
        const soqlStatus = `
            SELECT Periodo__c, Status__c, COUNT(Id) total
            FROM LancamentoHora__c 
            WHERE DiaPeriodo__r.Data__c >= ${inicio}
            AND DiaPeriodo__r.Data__c <= ${fim}
            AND (Horas__c > 0 OR HorasExtras__c > 0)
            GROUP BY Periodo__c, Status__c
        `;

        // 3. Busca de Lista de Projetos (Agrupado por Período)
        const soqlProjetos = `
            SELECT Periodo__c, Servico__r.Name
            FROM LancamentoHora__c 
            WHERE DiaPeriodo__r.Data__c >= ${inicio}
            AND DiaPeriodo__r.Data__c <= ${fim}
            AND (Horas__c > 0 OR HorasExtras__c > 0)
            GROUP BY Periodo__c, Servico__r.Name
        `;

        const [resPeriodos, resStatus, resProjetos] = await Promise.all([
            conn.query(soqlPeriodos),
            conn.query(soqlStatus),
            conn.query(soqlProjetos)
        ]);

        // --- PROCESSAMENTO ---

        const statusMap = {};
        resStatus.records.forEach(r => {
            const pId = r.Periodo__c;
            const st = r.Status__c;
            const count = r.total || r.expr0 || 0;

            if (!statusMap[pId]) statusMap[pId] = { approved: 0, closed: 0, billed: 0, pending: 0 };
            
            if (st === 'Aprovado') statusMap[pId].approved += count;
            else if (st === 'Fechado') statusMap[pId].closed += count;
            else if (st === 'Faturado') statusMap[pId].billed += count;
            else statusMap[pId].pending += count; 
        });

        const projectMap = {};
        resProjetos.records.forEach(r => {
            const pId = r.Periodo__c;
            const pName = r.Name || (r.Servico__r ? r.Servico__r.Name : null);
            if (!projectMap[pId]) projectMap[pId] = new Set();
            if (pName) projectMap[pId].add(pName);
        });

        let kpiBurnout = 0, kpiOciosos = 0;
        
        const tableData = resPeriodos.records.map(per => {
            const pId = per.Id;
            const pessoaId = per.ContratoPessoa__r?.Pessoa__c;
            const nome = per.ContratoPessoa__r?.Pessoa__r?.Name || 'Sem Nome';
            const cargo = per.ContratoPessoa__r?.Cargo__c || 'Consultor';
            const totalHoras = per.TotalHoras__c || 0;
            
            // [MUDANÇA]: Cálculo exato da Meta (Dias Úteis * Horas Diárias)
            const diasUteis = per.QuantidadeDiasUteis__c || 0;
            const horasDiarias = per.ContratoPessoa__r?.Hora__c || 8; // Default 8h se nulo
            const contractHours = diasUteis * horasDiarias;

            const s = statusMap[pId] || { approved: 0, closed: 0, billed: 0, pending: 0 };
            const projects = projectMap[pId] ? Array.from(projectMap[pId]) : [];

            // Lógica de Status UI e Ação (Mesma logica anterior corrigida)
            const hasActivity = (s.approved + s.closed + s.billed) > 0;
            let statusUI = 'Pendente';
            let canAction = false;

            if (s.pending > 0) {
                statusUI = 'Aguardando Aprovação';
            } else if (s.approved > 0 && s.closed === 0 && s.billed === 0) {
                statusUI = 'Pronto para Fechamento';
                canAction = true;
            } else if (s.closed > 0 && s.approved === 0) {
                statusUI = 'Aguardando Faturamento';
            } else if (s.billed > 0) {
                statusUI = 'Faturado';
            } else if (!hasActivity) {
                statusUI = 'Sem Lançamentos';
            } else {
                statusUI = 'Status Misto';
            }

            // KPIs
            let statusKPI = 'healthy';
            if (totalHoras > (contractHours + 20)) { statusKPI = 'danger'; kpiBurnout++; }
            else if (totalHoras > contractHours) { statusKPI = 'risk'; }
            else if (totalHoras < (contractHours * 0.5)) { statusKPI = 'under'; kpiOciosos++; }

            return {
                id: pessoaId,
                name: nome,
                role: cargo,
                total: totalHoras,
                contract: contractHours, // Meta Calculada
                projects: projects,
                statusUI: statusUI,
                status: statusKPI,
                canAction: canAction,
                periodId: pId 
            };
        });

        tableData.sort((a, b) => {
            if (a.canAction === b.canAction) return b.total - a.total;
            return a.canAction ? -1 : 1;
        });

        res.json({
            kpis: { total: tableData.length, burnout: kpiBurnout, ociosos: kpiOciosos },
            data: tableData
        });

    } catch (e) {
        console.error("Erro HR Employees:", e);
        res.status(500).json({ error: e.message });
    }
};

// --- FUNÇÃO 2: DETALHES (MODAL VIA DIAS DO PERÍODO) ---
exports.getEmployeeDetails = async (req, res) => {
    try {
        const conn = await getSfConnection();
        const { personId } = req.params;
        const { inicio, fim } = req.query;

        // 1. Encontrar Período
        const soqlPeriodo = `
            SELECT Id FROM Periodo__c 
            WHERE ContratoPessoa__r.Pessoa__c = '${personId}' 
            AND DataInicio__c >= ${inicio} 
            AND DataFim__c <= ${fim}
            LIMIT 1
        `;
        const resPeriodo = await conn.query(soqlPeriodo);
        
        if (resPeriodo.totalSize === 0) return res.json([]);
        const periodoId = resPeriodo.records[0].Id;

        // 2. Buscar Dias (Incluindo Name e Tipo__c)
        const soqlDias = `
            SELECT Id, Name, Tipo__c, Data__c
            FROM DiaPeriodo__c 
            WHERE Periodo__c = '${periodoId}'
            ORDER BY Data__c ASC
        `;
        const resDias = await conn.query(soqlDias);

        if (resDias.totalSize === 0) return res.json([]);

        const diasMap = {};
        const diaIds = [];
        resDias.records.forEach(d => {
            diasMap[d.Id] = d;
            diaIds.push(`'${d.Id}'`);
        });

        // 3. Buscar Lançamentos
        const soqlLancamentos = `
            SELECT Id, DiaPeriodo__c, Servico__r.Name, Atividade__r.Name, 
                   Horas__c, HorasExtras__c, JustificativaExtra__c
            FROM LancamentoHora__c 
            WHERE DiaPeriodo__c IN (${diaIds.join(',')})
            AND (Horas__c > 0 OR HorasExtras__c > 0)
        `;
        const resLancamentos = await conn.query(soqlLancamentos);

        // 4. Montar JSON
        const logs = resLancamentos.records.map(lanc => {
            const dia = diasMap[lanc.DiaPeriodo__c];
            
            let desc = '';
            const hExtra = lanc.HorasExtras__c || 0;
            const hNormal = lanc.Horas__c || 0;
            
            if (hExtra > 0) {
                desc = `${lanc.JustificativaExtra__c || 'Hora Extra'} (${lanc.Atividade__r?.Name || ''})`;
            } else {
                desc = lanc.Atividade__r?.Name || 'Apontamento normal';
            }

            // O campo Name do DiaPeriodo__c geralmente traz "DD/MM - DiaDaSemana"
            // Vamos passar ele direto para o front exibir
            const dateDisplay = dia.Name || dia.Data__c; 

            return {
                date: dateDisplay, 
                tipoDia: dia.Tipo__c, // Novo campo para o Front
                project: lanc.Servico__r?.Name || 'N/A',
                hours: hNormal + hExtra,
                isExtra: hExtra > 0,
                description: desc
            };
        });

        res.json(logs);

    } catch (e) {
        console.error("Erro Detail:", e);
        res.status(500).json({ error: e.message });
    }
};

// --- FUNÇÃO 3: AÇÃO DE FECHAR/REPROVAR (QUERY 3 DO PROMPT) ---
exports.handleHrAction = async (req, res) => {
    const { personId, action, inicio, fim } = req.body;
    
    let novoStatus = '';
    if (action === 'close') novoStatus = 'Fechado';
    else if (action === 'reject') novoStatus = 'Reprovado';
    else return res.status(400).json({ success: false, message: 'Ação inválida.' });

    try {
        const conn = await getSfConnection();
        
        // 1. Encontrar o Período primeiro (Segurança)
        const soqlPeriodo = `
            SELECT Id FROM Periodo__c 
            WHERE ContratoPessoa__r.Pessoa__c = '${personId}' 
            AND DataInicio__c >= ${inicio} 
            AND DataFim__c <= ${fim}
            LIMIT 1
        `;
        const resultPeriodo = await conn.query(soqlPeriodo);
        
        if (resultPeriodo.totalSize === 0) {
            return res.status(404).json({ success: false, message: 'Período não encontrado.' });
        }
        const periodoId = resultPeriodo.records[0].Id;

        // 2. Buscar Lançamentos "Aprovados" dentro desse Período
        // (Continua a mesma lógica: fecha o lançamento)
        const soqlBusca = `
            SELECT Id FROM LancamentoHora__c 
            WHERE DiaPeriodo__r.Periodo__c = '${periodoId}'
            AND Status__c = 'Aprovado'
            AND (Horas__c > 0 OR HorasExtras__c > 0) 
        `;
        
        const resultBusca = await conn.query(soqlBusca);

        if (resultBusca.totalSize === 0) {
            return res.json({ success: false, message: 'Nenhum lançamento elegível (Aprovado) encontrado neste período.' });
        }

        // 3. Update
        const allUpdates = resultBusca.records.map(rec => ({ Id: rec.Id, Status__c: novoStatus }));
        
        // Batching
        const BATCH_SIZE = 200;
        const batches = [];
        for (let i = 0; i < allUpdates.length; i += BATCH_SIZE) {
            batches.push(allUpdates.slice(i, i + BATCH_SIZE));
        }

        const results = await Promise.all(
            batches.map(batch => conn.update('LancamentoHora__c', batch))
        );

        const flatResults = results.flat();
        const erros = flatResults.filter(r => !r.success);
        
        if (erros.length > 0) {
            return res.status(400).json({ success: false, message: 'Erro parcial ao atualizar Salesforce.' });
        }

        const msg = action === 'close' ? 'Folha fechada com sucesso.' : 'Folha reprovada.';
        res.json({ success: true, message: msg });

    } catch (e) {
        console.error("Erro HR Action:", e);
        res.status(500).json({ success: false, error: e.message });
    }
};

exports.renderHrDashboard = (req, res) => {
    res.render('hr_dashboard', { user: req.session.user, page: 'hr' });
};