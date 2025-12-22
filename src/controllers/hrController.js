const { getSfConnection } = require('../config/salesforce');

// --- HELPER: GARANTIR QUE EXISTE O BANCO DE HORAS PAI ---
async function getOrCreateBancoHoras(conn, pessoaId) {
    const query = `SELECT Id FROM BancoHoras__c WHERE Pessoa__c = '${pessoaId}' LIMIT 1`;
    const result = await conn.query(query);

    if (result.totalSize > 0) {
        return result.records[0].Id;
    }

    // Se não existe, cria
    const novoBanco = await conn.sobject('BancoHoras__c').create({
        Pessoa__c: pessoaId
    });

    if (novoBanco.success) return novoBanco.id;
    throw new Error("Falha ao criar Banco de Horas para o colaborador.");
}

// --- 1. PAINEL PRINCIPAL ---
exports.getHrEmployees = async (req, res) => {
    try {
        const conn = await getSfConnection();
        const { inicio, fim } = req.query;

        const soqlPeriodos = `
            SELECT Id, ContratoPessoa__r.Pessoa__c, ContratoPessoa__r.Pessoa__r.Name, 
                   ContratoPessoa__r.Cargo__c, QuantidadeDiasUteis__c, ContratoPessoa__r.Hora__c
            FROM Periodo__c
            WHERE DataInicio__c >= ${inicio} AND DataFim__c <= ${fim}
        `;

        const filtroHoras = `(
            Horas__c > 0 
            OR HorasExtras__c > 0 
            OR HorasBanco__c > 0 OR HorasBanco__c < 0 
            OR HorasAusenciaRemunerada__c > 0 
            OR HorasAusenciaNaoRemunerada__c > 0
        )`;

        const soqlAgregado = `
            SELECT DiaPeriodo__r.Periodo__c, Status__c,
                   SUM(Horas__c) normal, 
                   SUM(HorasExtras__c) extra, 
                   SUM(HorasBanco__c) banco,
                   SUM(HorasAusenciaRemunerada__c) ausRem,
                   SUM(HorasAusenciaNaoRemunerada__c) ausNaoRem
            FROM LancamentoHora__c 
            WHERE DiaPeriodo__r.Data__c >= ${inicio} AND DiaPeriodo__r.Data__c <= ${fim}
            AND ${filtroHoras}
            GROUP BY DiaPeriodo__r.Periodo__c, Status__c
        `;

        const soqlProjetos = `
            SELECT DiaPeriodo__r.Periodo__c, Servico__r.Name
            FROM LancamentoHora__c 
            WHERE DiaPeriodo__r.Data__c >= ${inicio} AND DiaPeriodo__r.Data__c <= ${fim}
            AND ${filtroHoras}
            GROUP BY DiaPeriodo__r.Periodo__c, Servico__r.Name
        `;

        const [resPeriodos, resAgregado, resProjetos] = await Promise.all([
            conn.query(soqlPeriodos), conn.query(soqlAgregado), conn.query(soqlProjetos)
        ]);

        const periodDataMap = {};
        resPeriodos.records.forEach(p => {
            periodDataMap[p.Id] = { approved: 0, closed: 0, billed: 0, pending: 0, totalRealizado: 0, projects: new Set() };
        });

        resProjetos.records.forEach(r => {
            if (periodDataMap[r.Periodo__c] && r.Name) periodDataMap[r.Periodo__c].projects.add(r.Name);
        });

        resAgregado.records.forEach(r => {
            const pId = r.Periodo__c;
            if (!periodDataMap[pId]) return;
            const st = r.Status__c;
            
            if (st === 'Aprovado') periodDataMap[pId].approved++;
            else if (st === 'Fechado') periodDataMap[pId].closed++;
            else if (st === 'Faturado') periodDataMap[pId].billed++;
            else periodDataMap[pId].pending++;

            const vol = (r.normal||0) + (r.extra||0) + Math.abs(r.banco||0) + (r.ausRem||0) + (r.ausNaoRem||0);
            periodDataMap[pId].totalRealizado += vol;
        });

        let kpiBurnout = 0, kpiOciosos = 0;
        const tableData = resPeriodos.records.map(per => {
            const pId = per.Id;
            const data = periodDataMap[pId];
            const diasUteis = per.QuantidadeDiasUteis__c || 0;
            const carga = per.ContratoPessoa__r?.Hora__c || 8;
            const contractHours = diasUteis * carga;
            const totalHoras = data ? data.totalRealizado : 0;

            let statusUI = 'Pendente', canAction = false;
            
            if (!data || (data.approved + data.closed + data.billed + data.pending === 0)) statusUI = 'Sem Lançamentos';
            else if (data.pending > 0) statusUI = 'Aguardando Aprovação';
            else if (data.approved > 0 && data.closed === 0) { statusUI = 'Pronto para Fechamento'; canAction = true; }
            else if (data.closed > 0) statusUI = 'Fechado';
            else if (data.billed > 0) statusUI = 'Faturado';

            let statusKPI = 'healthy';
            if (totalHoras > (contractHours * 1.2)) { statusKPI = 'danger'; kpiBurnout++; }
            else if (totalHoras > contractHours) { statusKPI = 'risk'; }
            else if (totalHoras < (contractHours * 0.7)) { statusKPI = 'under'; kpiOciosos++; }

            return {
                id: per.ContratoPessoa__r?.Pessoa__c,
                name: per.ContratoPessoa__r?.Pessoa__r?.Name || 'Desconhecido',
                role: per.ContratoPessoa__r?.Cargo__c || 'Consultor',
                total: totalHoras, contract: contractHours,
                projects: data ? Array.from(data.projects) : [],
                statusUI, statusKPI, canAction, periodId: pId
            };
        });

        tableData.sort((a, b) => {
            if (a.canAction !== b.canAction) return a.canAction ? -1 : 1;
            return b.total - a.total;
        });

        res.json({ kpis: { total: tableData.length, burnout: kpiBurnout, ociosos: kpiOciosos }, data: tableData });
    } catch (e) { res.status(500).json({ error: e.message }); }
};

// --- 2. DETALHES ---
exports.getEmployeeDetails = async (req, res) => {
    try {
        const conn = await getSfConnection();
        const { personId } = req.params;
        const { inicio, fim } = req.query;

        const filtroHoras = `(
            Horas__c > 0 
            OR HorasExtras__c > 0 
            OR HorasBanco__c > 0 OR HorasBanco__c < 0 
            OR HorasAusenciaRemunerada__c > 0 
            OR HorasAusenciaNaoRemunerada__c > 0
        )`;

        const result = await conn.query(`
            SELECT DiaPeriodo__r.Data__c, Servico__r.Name, Atividade__r.Name, Justificativa__c, Status__c,
                   Horas__c, HorasExtras__c, HorasBanco__c, 
                   HorasAusenciaRemunerada__c, HorasAusenciaNaoRemunerada__c
            FROM LancamentoHora__c 
            WHERE Pessoa__c = '${personId}'
            AND DiaPeriodo__r.Data__c >= ${inicio} AND DiaPeriodo__r.Data__c <= ${fim}
            AND ${filtroHoras}
            ORDER BY DiaPeriodo__r.Data__c ASC, Atividade__r.Name ASC
        `);

        let sumNormal=0, sumExtra=0, sumBanco=0, sumAusencia=0;
        const logs = result.records.map(r => {
            const hN = r.Horas__c||0;
            const hE = r.HorasExtras__c||0;
            const hB = r.HorasBanco__c||0;
            const hA = (r.HorasAusenciaRemunerada__c||0)+(r.HorasAusenciaNaoRemunerada__c||0);
            
            sumNormal += hN; sumExtra += hE; sumBanco += hB; sumAusencia += hA;

            return {
                date: r.DiaPeriodo__r ? r.DiaPeriodo__r.Data__c : '-',
                project: r.Servico__r ? r.Servico__r.Name : '-',
                activity: r.Atividade__r ? r.Atividade__r.Name : 'Geral',
                justification: r.Justificativa__c || '',
                status: r.Status__c,
                normal: hN, extraPgto: hE, banco: hB, ausencia: hA
            };
        });

        const resMeta = await conn.query(`SELECT QuantidadeDiasUteis__c, ContratoPessoa__r.Hora__c FROM Periodo__c WHERE ContratoPessoa__r.Pessoa__c = '${personId}' AND DataInicio__c >= ${inicio} AND DataFim__c <= ${fim} LIMIT 1`);
        let contractHours = 0;
        if(resMeta.totalSize > 0) {
            contractHours = (resMeta.records[0].QuantidadeDiasUteis__c || 0) * (resMeta.records[0].ContratoPessoa__r?.Hora__c || 8);
        }

        res.json({ 
            logs, 
            summary: {
                normal: sumNormal, extra: sumExtra, banco: sumBanco,
                ausencia: sumAusencia, 
                totalRealizado: sumNormal + sumExtra + Math.abs(sumBanco) + sumAusencia,
                contract: contractHours
            } 
        });
    } catch (e) { res.status(500).json({ error: e.message }); }
};

// --- 3. AÇÃO RH (CORRIGIDA: 1 LANÇAMENTO -> 1 REGISTRO BANCO) ---
exports.handleHrAction = async (req, res) => {
    const { personId, action, inicio, fim, motivo } = req.body;
    let novoStatus = action === 'close' ? 'Fechado' : 'Reprovado';

    try {
        const conn = await getSfConnection();
        const statusFilter = action === 'close' ? "Status__c = 'Aprovado'" : "Status__c IN ('Lançado', 'Aprovado')";
        
        // ADICIONADO: DiaPeriodo__r.Data__c para usar a data correta no extrato
        const soql = `
            SELECT Id, HorasBanco__c, DiaPeriodo__r.Data__c 
            FROM LancamentoHora__c 
            WHERE Pessoa__c = '${personId}'
            AND DiaPeriodo__r.Data__c >= ${inicio} AND DiaPeriodo__r.Data__c <= ${fim}
            AND ${statusFilter}
        `;
        
        const result = await conn.query(soql);
        
        if (result.totalSize === 0) {
            return res.json({ success: false, message: 'Nenhum lançamento elegível para esta ação.' });
        }

        // --- LÓGICA DE FECHAMENTO COM BANCO ITEM A ITEM ---
        if (action === 'close') {
            try {
                // 1. Garante que existe a "Conta" Pai
                const bancoHorasId = await getOrCreateBancoHoras(conn, personId);
                
                const bankRecords = [];

                // 2. Itera sobre cada lançamento para criar o espelho no banco
                result.records.forEach(r => {
                    // Verifica se tem horas de banco (Positivas ou Negativas)
                    if (r.HorasBanco__c && r.HorasBanco__c !== 0) {
                        bankRecords.push({
                            BancoHoras__c: bancoHorasId,
                            LancamentoHora__c: r.Id, // Vínculo 1 para 1
                            Quantidade__c: r.HorasBanco__c,
                            Data__c: r.DiaPeriodo__r ? r.DiaPeriodo__r.Data__c : fim, // Data do dia trabalhado
                            Tipo__c: r.HorasBanco__c > 0 ? 'Crédito (Extra)' : 'Débito (Ausência)', // Ajuste conforme sua picklist
                            Observacao__c: 'Fechamento Automático RH'
                        });
                    }
                });

                // 3. Bulk Insert dos registros de banco
                if (bankRecords.length > 0) {
                    const insertRes = await conn.sobject('RegistroBancoHoras__c').create(bankRecords);
                    // Opcional: verificar erros no insertRes
                    const failures = insertRes.filter(res => !res.success);
                    if (failures.length > 0) {
                        console.error("Erros ao criar registros de banco:", JSON.stringify(failures));
                        // Dependendo da regra, pode dar throw aqui para não fechar os lançamentos
                        throw new Error("Falha parcial ao gerar registros de banco. Operação abortada.");
                    }
                }

            } catch (bancoError) {
                console.error("Erro crítico banco de horas:", bancoError);
                return res.status(500).json({ success: false, message: "Erro no Banco de Horas: " + bancoError.message });
            }
        }

        // --- ATUALIZAÇÃO DOS STATUS (SE PASSOU PELO BANCO) ---
        const updates = result.records.map(r => {
            const obj = { Id: r.Id, Status__c: novoStatus };
            if (action === 'reject' && motivo) obj.MotivoReprovacao__c = motivo;
            if (action === 'close') obj.MotivoReprovacao__c = null;
            return obj;
        });
        
        await conn.update('LancamentoHora__c', updates);

        res.json({ success: true, message: action === 'close' ? 'Período fechado e banco atualizado.' : 'Período reprovado.' });

    } catch (e) {
        console.error(e);
        res.status(500).json({ success: false, error: e.message });
    }
};

exports.renderHrDashboard = (req, res) => {
    res.render('hr_dashboard', { user: req.session.user, page: 'hr' });
};