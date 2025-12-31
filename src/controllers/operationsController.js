const { getSfConnection } = require('../config/salesforce');

// ==============================================================================
// HELPER FUNCTIONS
// ==============================================================================

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

async function calculateDailyStats(conn, userId, targetDate) {
    const dateStr = targetDate.includes('T') ? targetDate.split('T')[0] : targetDate;
    const diaRes = await conn.sobject('DiaPeriodo__c')
        .find({ Data__c: dateStr, 'Periodo__r.ContratoPessoa__r.Pessoa__c': userId }, 'Id, Periodo__c, Periodo__r.ContratoPessoa__r.Hora__c')
        .limit(1)
        .execute();
    
    if (diaRes.length === 0) return { exists: false, diaPeriodoId: null, limiteDia: 8, usedNormal: 0, usedExtra: 0, saldoNormalDia: 8 };
    
    const diaRecord = diaRes[0];
    const limiteDia = (diaRecord.Periodo__r && diaRecord.Periodo__r.ContratoPessoa__r && diaRecord.Periodo__r.ContratoPessoa__r.Hora__c) ? diaRecord.Periodo__r.ContratoPessoa__r.Hora__c : 8;

    const somaQuery = `
        SELECT SUM(Horas__c) totalNormal, SUM(HorasExtras__c) totalExtra
        FROM LancamentoHora__c 
        WHERE DiaPeriodo__c = '${diaRecord.Id}' 
        AND Pessoa__c = '${userId}'
        AND (Horas__c > 0 OR HorasExtras__c > 0)
    `;
    
    let usedNormal = 0, usedExtra = 0;
    try {
        const somaRes = await conn.query(somaQuery);
        if (somaRes.totalSize > 0) {
            usedNormal = somaRes.records[0].totalNormal || 0;
            usedExtra = somaRes.records[0].totalExtra || 0;
        }
    } catch (e) {}

    return { exists: true, diaPeriodoId: diaRecord.Id, periodoId: diaRecord.Periodo__c, limiteDia, usedNormal, usedExtra, saldoNormalDia: limiteDia - usedNormal };
}

exports.renderOperations = (req, res) => {
    const user = req.session.user || { nome: 'Usuário', grupos: [] };
    res.render('operations', { user: user, page: 'operations' });
};

// ==============================================================================
// LEITURA
// ==============================================================================

exports.getLimits = async (req, res) => {
    try {
        const { date } = req.query;
        const userId = req.session.user.id;
        if (!date) return res.status(400).json({ error: 'Data obrigatória.' });
        const conn = await getSfConnection();
        const stats = await calculateDailyStats(conn, userId, date);
        res.json({ success: true, exists: stats.exists, limit: stats.limiteDia, usedNormal: stats.usedNormal, usedExtra: stats.usedExtra, remainingNormal: stats.saldoNormalDia });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
};

exports.getTickets = async (req, res) => {
    try {
        const { filter } = req.query; 
        const userId = req.session.user.id;
        const conn = await getSfConnection();

        let soql = `SELECT Id, CaseNumber, Subject, Status, Priority, Description, CreatedDate, Account.Name, Pessoa__c, Pessoa__r.Name, Type, Origin FROM Case WHERE IsClosed = false`;

        if (filter === 'my') {
            soql += ` AND Pessoa__c = '${userId}'`;
        } else {
            const today = new Date().toISOString().split('T')[0];
            const soqlAloc = `SELECT Servico__r.Conta__c FROM Alocacao__c WHERE Pessoa__c = '${userId}' AND DataInicio__c <= ${today} AND (DataFim__c >= ${today} OR DataFim__c = NULL)`;
            const alocacoes = await conn.query(soqlAloc);
            const accountIds = [...new Set(alocacoes.records.map(a => a.Servico__r ? a.Servico__r.Conta__c : null).filter(id => id !== null))];
            if (accountIds.length === 0) return res.json([]); 
            const idsFormatados = accountIds.map(id => `'${id}'`).join(',');
            soql += ` AND AccountId IN (${idsFormatados})`;
            if (filter === 'queue') soql += ` AND Pessoa__c = null`;
            else if (filter === 'team') soql += ` AND Pessoa__c != null AND Pessoa__c != '${userId}'`;
        }

        soql += ` ORDER BY CreatedDate DESC LIMIT 100`; 
        const result = await conn.query(soql);
        let records = result.records;

        // Ordenação JS
        const typeScore = { 'Bug': 0, 'Erro': 0, 'Melhoria': 1, 'Dúvida': 2 };
        const priorityScore = { 'Critical': 0, 'High': 1, 'Medium': 2, 'Low': 3 };
        
        records.sort((a, b) => {
            const sA = typeScore[a.Type] !== undefined ? typeScore[a.Type] : 99;
            const sB = typeScore[b.Type] !== undefined ? typeScore[b.Type] : 99;
            if (sA !== sB) return sA - sB;
            const pA = priorityScore[a.Priority] !== undefined ? priorityScore[a.Priority] : 99;
            const pB = priorityScore[b.Priority] !== undefined ? priorityScore[b.Priority] : 99;
            if (pA !== pB) return pA - pB;
            return new Date(a.CreatedDate) - new Date(b.CreatedDate);
        });

        res.json(records.map(c => ({
            id: c.Id,
            caseNumber: c.CaseNumber,
            title: c.Subject || 'Sem Assunto',
            client: c.Account ? c.Account.Name : 'N/A',
            status: c.Status,
            priority: c.Priority,
            type: c.Type,
            desc: c.Description,
            ownerName: c.Pessoa__r ? c.Pessoa__r.Name : 'Fila',
            date: new Date(c.CreatedDate).toLocaleDateString('pt-BR'),
            rawDate: c.CreatedDate
        })));
    } catch (err) { res.status(500).json({ error: 'Erro ao buscar chamados.' }); }
};

exports.getTicketDetails = async (req, res) => {
    const { id } = req.params;
    try {
        const conn = await getSfConnection();
        // Busca campos customizados de data e LastModifiedDate
        const t = await conn.sobject('Case').retrieve(id);
        const comments = await conn.sobject('CaseComment').find({ ParentId: id }, 'CommentBody, CreatedDate, CreatedBy.Name, IsPublished').sort({ CreatedDate: -1 }).execute();
        const logsQuery = `SELECT Id, DiaPeriodo__r.Data__c, Horas__c, HorasExtras__c, Justificativa__c, Atividade__r.Name FROM LancamentoHora__c WHERE Atividade__r.Caso__c = '${id}' AND (Horas__c > 0 OR HorasExtras__c > 0) ORDER BY DiaPeriodo__r.Data__c DESC`;
        const logsRes = await conn.query(logsQuery);

        res.json({
            ticket: {
                Subject: t.Subject,
                Description: t.Description,
                Status: t.Status,
                Type: t.Type,
                Priority: t.Priority,
                Origin: t.Origin,
                CreatedDate: t.CreatedDate,
                LastModifiedDate: t.LastModifiedDate,
                // MAPEAR API NAMES CORRETOS DA SUA ORG:
                DataExpectativaCliente__c: t.DataExpectativaCliente__c || null,
                DataEstimativaEntrega__c: t.DataEstimativaEntrega__c || null
            },
            comments: comments.map(c => ({ text: c.CommentBody, user: c.CreatedBy ? c.CreatedBy.Name : 'Sistema', time: new Date(c.CreatedDate).toLocaleString('pt-BR'), public: c.IsPublished })),
            logs: logsRes.records.map(l => {
                let dateStr = '-';
                if (l.DiaPeriodo__r && l.DiaPeriodo__r.Data__c) {
                    const parts = l.DiaPeriodo__r.Data__c.split('-');
                    dateStr = `${parts[2]}/${parts[1]}/${parts[0]}`;
                }
                return { date: dateStr, activity: l.Atividade__r ? l.Atividade__r.Name : 'Geral', desc: l.Justificativa__c || '-', hoursNormal: l.Horas__c || 0, hoursExtra: l.HorasExtras__c || 0 };
            })
        });
    } catch (err) { res.status(500).json({ error: 'Erro ao buscar detalhes.' }); }
};

exports.getTicketActivities = async (req, res) => { try { const { id } = req.params; const conn = await getSfConnection(); const activities = await conn.sobject('Atividade__c').find({ Caso__c: id }, 'Id, Name, Servico__c').sort({ CreatedDate: -1 }).execute(); res.json(activities); } catch (err) { res.status(500).json({ error: 'Erro ao buscar atividades.' }); } };
exports.getCreateOptions = async (req, res) => { try { const userId = req.session.user.id; const conn = await getSfConnection(); const today = new Date().toISOString().split('T')[0]; const soql = `SELECT Servico__c, Servico__r.Name, Servico__r.Conta__c, Servico__r.Conta__r.Name FROM Alocacao__c WHERE Pessoa__c = '${userId}' AND DataInicio__c <= ${today} AND (DataFim__c >= ${today} OR DataFim__c = NULL) ORDER BY Servico__r.Name ASC`; const result = await conn.query(soql); const options = result.records.map(r => ({ serviceId: r.Servico__c, serviceName: r.Servico__r ? r.Servico__r.Name : 'Serviço', accountId: r.Servico__r ? r.Servico__r.Conta__c : null, accountName: (r.Servico__r && r.Servico__r.Conta__r) ? r.Servico__r.Conta__r.Name : 'Conta' })); res.json(options); } catch (err) { res.status(500).json({ error: 'Erro ao buscar serviços.' }); } };
exports.getAccountContacts = async (req, res) => { try { const { id } = req.params; const conn = await getSfConnection(); const soql = `SELECT Id, Name, Email FROM Contact WHERE AccountId = '${id}' ORDER BY Name ASC`; const result = await conn.query(soql); res.json(result.records); } catch (err) { res.status(500).json({ error: 'Erro ao buscar contatos.' }); } };

// ==============================================================================
// ESCRITA
// ==============================================================================

exports.createContact = async (req, res) => {
    try {
        const { accountId, name, email, mobile } = req.body;
        if (!accountId || !name) return res.status(400).json({ error: 'Conta e Nome obrigatórios.' });

        const parts = name.trim().split(' ');
        let firstName = '';
        let lastName = name;
        if (parts.length > 1) {
            lastName = parts.pop();
            firstName = parts.join(' ');
        }

        const conn = await getSfConnection();
        const payload = {
            AccountId: accountId,
            LastName: lastName,
            FirstName: firstName,
            Email: email,
            MobilePhone: mobile || null // Envia null se vazio para evitar erro
        };

        const ret = await conn.sobject('Contact').create(payload);
        if (ret.success) res.json({ success: true, id: ret.id, name: name });
        else res.status(400).json({ success: false, errors: ret.errors });

    } catch (err) { res.status(500).json({ error: 'Erro ao criar contato: ' + err.message }); }
};

exports.createTicket = async (req, res) => {
    try {
        const { serviceId, accountId, contactId, type, priority, origin, expectationDate, assignToMe, subject, desc } = req.body;
        const conn = await getSfConnection();
        
        const caseData = {
            Subject: subject,
            Description: desc,
            AccountId: accountId,
            ContactId: contactId || null,
            Type: type,
            Priority: priority,
            Origin: origin,
            Status: 'New',
            DataExpectativaCliente__c: expectationDate || null
        };

        if (assignToMe === true || assignToMe === 'true') {
            caseData.Pessoa__c = req.session.user.id;
            caseData.Status = 'In Progress';
        }

        const ret = await conn.sobject('Case').create(caseData);
        if (ret.success) res.json({ success: true, id: ret.id });
        else res.status(400).json({ success: false, errors: ret.errors });
    } catch (err) { res.status(500).json({ error: 'Erro ao criar chamado.' }); }
};

exports.updateTicket = async (req, res) => {
    try {
        const { id, status, estimationDate, type, priority } = req.body;
        const conn = await getSfConnection();
        // Mapeia DataEstimativaEntrega__c
        const updateData = {
            Id: id,
            Status: status,
            Type: type,
            Priority: priority,
            DataEstimativaEntrega__c: estimationDate || null
        };
        const ret = await conn.sobject('Case').update(updateData);
        if (ret.success) res.json({ success: true });
        else res.status(400).json({ success: false, errors: ret.errors });
    } catch (err) { res.status(500).json({ error: 'Erro ao atualizar.' }); }
};

exports.assignTicket = async (req, res) => { 
    try { 
        const { id } = req.body; 
        const conn = await getSfConnection(); 
        const ret = await conn.sobject('Case').update({ Id: id, Pessoa__c: req.session.user.id, Status: 'In Progress' }); 
        if (ret.success) res.json({ success: true }); else res.status(400).json({ success: false }); 
    } catch (err) { res.status(500).json({ error: 'Erro ao atribuir.' }); } 
};

// NOVA FUNÇÃO: DEVOLVER PARA FILA
exports.returnToQueue = async (req, res) => {
    try {
        const { id } = req.body;
        const conn = await getSfConnection();
        // Limpar Pessoa__c coloca o caso de volta na fila (visível para quem não tem filtro 'my')
        const ret = await conn.sobject('Case').update({ Id: id, Pessoa__c: null, Status: 'New' });
        if (ret.success) res.json({ success: true }); 
        else res.status(400).json({ success: false });
    } catch (err) { res.status(500).json({ error: 'Erro ao devolver.' }); }
};

exports.transferTicket = async (req, res) => {
    try {
        const { id, target } = req.body; // target: 'queue' ou 'userId' (futuro)
        const conn = await getSfConnection();
        
        let updateData = { Id: id };
        
        if (target === 'queue') {
            // Devolver para fila = Remover Pessoa__c
            // Salesforce exige enviar como nulo ou campos vazios
            updateData.Pessoa__c = null;
            updateData.Status = 'New'; // Volta para novo ou status de triagem
        } else {
            // Transferir para outro usuário (se implementado select de usuários)
            updateData.Pessoa__c = target;
        }

        const ret = await conn.sobject('Case').update(updateData);
        if (ret.success) res.json({ success: true });
        else res.status(400).json({ success: false, errors: ret.errors });

    } catch (err) {
        console.error("Erro transferTicket:", err);
        res.status(500).json({ error: 'Erro ao transferir.' });
    }
};

exports.saveLog = async (req, res) => {
    try {
        const { caseId, activityId, newActivityName, hoursNormal, hoursExtra, desc, date } = req.body;
        const userId = req.session.user.id;
        const conn = await getSfConnection();
        const targetDate = date ? date.split('T')[0] : new Date().toISOString().split('T')[0];
        
        let hNorm = hoursNormal ? parseFloat(hoursNormal.toString().replace(',', '.')) : 0;
        let hExtra = hoursExtra ? parseFloat(hoursExtra.toString().replace(',', '.')) : 0;
        hNorm = Math.round(hNorm * 2) / 2; hExtra = Math.round(hExtra * 2) / 2;

        if (hNorm === 0 && hExtra === 0) return res.status(400).json({ error: 'Informe ao menos 0.5h.' });

        const stats = await calculateDailyStats(conn, userId, targetDate);
        if (!stats.exists) return res.status(400).json({ error: `Sem dia de ponto gerado.` });

        const { diaPeriodoId, periodoId, limiteDia, usedNormal, usedExtra } = stats;

        if ((usedNormal + usedExtra + hNorm + hExtra) > 24) return res.status(400).json({ error: `Total diário excede 24h.` });
        if ((usedNormal + hNorm) > (limiteDia + 0.01)) {
             const saldo = Math.max(0, limiteDia - usedNormal);
             return res.status(400).json({ error: `Limite contratual excedido. Saldo: ${saldo.toFixed(1)}h.` });
        }
        if (hExtra > 0) {
            const totalNormalPrevisto = usedNormal + hNorm;
            if (totalNormalPrevisto < (limiteDia - 0.01)) {
                return res.status(400).json({ error: `Complete as horas normais antes de lançar extras.` });
            }
        }

        let finalActivityId = activityId;
        let serviceId = null;
        let alocacaoId = null;

        if (activityId === 'new') {
            if (!newActivityName) return res.status(400).json({ error: 'Nome obrigatório.' });
            const caseRes = await conn.sobject('Case').retrieve(caseId);
            const alocRes = await conn.sobject('Alocacao__c').find({ Pessoa__c: userId, 'Servico__r.Conta__c': caseRes.AccountId, DataInicio__c: { $lte: targetDate }, $or: [{ DataFim__c: { $gte: targetDate } }, { DataFim__c: null }] }).limit(1).execute();
            if (alocRes.length === 0) return res.status(400).json({ error: `Sem alocação ativa.` });
            serviceId = alocRes[0].Servico__c; alocacaoId = alocRes[0].Id;
            const newAct = await conn.sobject('Atividade__c').create({ Name: `${caseRes.CaseNumber} - ${newActivityName}`.substring(0, 80), Caso__c: caseId, Servico__c: serviceId });
            finalActivityId = newAct.id;
        } else {
            const actRes = await conn.sobject('Atividade__c').retrieve(finalActivityId);
            serviceId = actRes.Servico__c;
            const alocRes = await conn.sobject('Alocacao__c').find({ Pessoa__c: userId, Servico__c: serviceId, DataInicio__c: { $lte: targetDate }, $or: [{ DataFim__c: { $gte: targetDate } }, { DataFim__c: null }] }).limit(1).execute();
            if (alocRes.length === 0) return res.status(400).json({ error: `Alocação inválida.` });
            alocacaoId = alocRes[0].Id;
        }

        const responsavelId = await getOrCreateResponsavel(conn, finalActivityId, alocacaoId);
        const logEntry = { Pessoa__c: userId, DiaPeriodo__c: diaPeriodoId, Periodo__c: periodoId, Servico__c: serviceId, Atividade__c: finalActivityId, Responsavel__c: responsavelId, Justificativa__c: desc || 'N2', Status__c: 'Rascunho', Horas__c: hNorm, HorasExtras__c: hExtra };
        const ret = await conn.sobject('LancamentoHora__c').create(logEntry);
        if (ret.success) res.json({ success: true }); else res.status(400).json({ success: false, errors: ret.errors });

    } catch (err) { res.status(500).json({ error: err.message }); }
};

exports.addComment = async (req, res) => { try { const { caseId, text } = req.body; const conn = await getSfConnection(); const ret = await conn.sobject('CaseComment').create({ ParentId: caseId, CommentBody: text, IsPublished: false }); if (ret.success) res.json({ success: true }); else res.status(400).json({ success: false }); } catch (err) { res.status(500).json({ error: 'Erro ao comentar.' }); } };