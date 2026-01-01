const { getSfConnection } = require('../config/salesforce');
const fs = require('fs');

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

async function createCaseLog(conn, caseId, action, userId, userType, desc = null) {
    try {
        const logData = {
            Caso__c: caseId,
            Acao__c: action,
            TipoUsuario__c: userType, // 'Operacao' ou 'Cliente'
            Descricao__c: desc
        };

        if (userType === 'Operacao') {
            logData.Pessoa__c = userId;
        } 
        
        // Tenta criar log. Se objeto não existir na org, cai no catch sem quebrar o fluxo.
        await conn.sobject('LogCaso__c').create(logData);
    } catch (e) {
        console.warn("LogCaso__c não criado (verifique se objeto existe):", e.message);
    }
}

async function calculateDailyStats(conn, userId, targetDate) {
    const dateStr = targetDate.includes('T') ? targetDate.split('T')[0] : targetDate;
    
    const diaQuery = `
        SELECT Id, Periodo__c, Periodo__r.ContratoPessoa__r.Hora__c 
        FROM DiaPeriodo__c 
        WHERE Data__c = ${dateStr} 
        AND Periodo__r.ContratoPessoa__r.Pessoa__c = '${userId}'
        LIMIT 1
    `;

    let diaRes = [];
    try {
        const result = await conn.query(diaQuery);
        diaRes = result.records;
    } catch (e) {
        return { exists: false, diaPeriodoId: null, limiteDia: 8, usedNormal: 0, usedExtra: 0, saldoNormalDia: 8 };
    }
    
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
        const tQuery = `
            SELECT Id, Subject, Description, Status, Type, Priority, Origin, CreatedDate, LastModifiedDate,
                   DataExpectativaCliente__c, DataEstimativaEntrega__c
            FROM Case WHERE Id = '${id}'
        `;
        const tResult = await conn.query(tQuery);
        if (tResult.totalSize === 0) throw new Error('Chamado não encontrado.');
        const t = tResult.records[0];

        // BUSCA DATAS DE ÚLTIMA ATUALIZAÇÃO NOS LOGS (ITEM 6 e "Última coisa")
        let lastUpdateClient = null;
        let lastUpdateOperation = null;

        try {
            // Tenta buscar no objeto LogCaso__c se ele existir
            const logsQuery = `SELECT CreatedDate, TipoUsuario__c FROM LogCaso__c WHERE Caso__c = '${id}' ORDER BY CreatedDate DESC LIMIT 50`;
            const logsResult = await conn.query(logsQuery);
            
            for (const log of logsResult.records) {
                if (!lastUpdateClient && log.TipoUsuario__c === 'Cliente') {
                    lastUpdateClient = log.CreatedDate;
                }
                if (!lastUpdateOperation && log.TipoUsuario__c === 'Operacao') {
                    lastUpdateOperation = log.CreatedDate;
                }
                if (lastUpdateClient && lastUpdateOperation) break;
            }
        } catch (e) {
            console.warn("LogCaso__c inacessível:", e.message);
        }

        // Fallbacks se não achar no log (opcional, aqui mantemos null se não achar)
        if (!lastUpdateOperation) lastUpdateOperation = t.LastModifiedDate; // Fallback para LastModified do Case

        const comments = await conn.sobject('CaseComment').find({ ParentId: id }, 'CommentBody, CreatedDate, CreatedBy.Name, IsPublished').sort({ CreatedDate: -1 }).execute();
        
        let attachments = [];
        try {
            const linksQuery = `SELECT ContentDocumentId FROM ContentDocumentLink WHERE LinkedEntityId = '${id}'`;
            const links = await conn.query(linksQuery);
            if (links.totalSize > 0) {
                const docIds = links.records.map(r => `'${r.ContentDocumentId}'`).join(',');
                // CORREÇÃO: Query corrigida para não pedir campo inexistente
                const docsQuery = `SELECT Id, Title, FileExtension, ContentSize FROM ContentVersion WHERE ContentDocumentId IN (${docIds}) AND IsLatest = true`;
                const docs = await conn.query(docsQuery);
                attachments = docs.records.map(d => ({ 
                    id: d.Id, 
                    name: `${d.Title}.${d.FileExtension}`, 
                    size: d.ContentSize 
                }));
            }
        } catch (e) { console.error("Erro anexos:", e); }

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
                DataExpectativaCliente__c: t.DataExpectativaCliente__c || null,
                DataEstimativaEntrega__c: t.DataEstimativaEntrega__c || null
            },
            lastUpdateClient: lastUpdateClient,     // NOVA PROPRIEDADE
            lastUpdateOperation: lastUpdateOperation, // NOVA PROPRIEDADE
            comments: comments.map(c => ({ 
                text: c.CommentBody, 
                user: 'Sistema', 
                time: new Date(c.CreatedDate).toLocaleString('pt-BR'), 
                public: c.IsPublished 
            })),
            logs: logsRes.records.map(l => {
                let dateStr = '-';
                if (l.DiaPeriodo__r && l.DiaPeriodo__r.Data__c) {
                    const parts = l.DiaPeriodo__r.Data__c.split('-');
                    dateStr = `${parts[2]}/${parts[1]}/${parts[0]}`;
                }
                return { date: dateStr, activity: l.Atividade__r ? l.Atividade__r.Name : 'Geral', desc: l.Justificativa__c || '-', hoursNormal: l.Horas__c || 0, hoursExtra: l.HorasExtras__c || 0 };
            }),
            attachments: attachments
        });
    } catch (err) { res.status(500).json({ error: 'Erro ao buscar detalhes: ' + err.message }); }
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
        let firstName = '', lastName = name;
        if (parts.length > 1) { lastName = parts.pop(); firstName = parts.join(' '); }

        const conn = await getSfConnection();
        const payload = { AccountId: accountId, LastName: lastName, FirstName: firstName, Email: email, MobilePhone: mobile || null };
        const ret = await conn.sobject('Contact').create(payload);
        if (ret.success) res.json({ success: true, id: ret.id, name: name });
        else res.status(400).json({ success: false, errors: ret.errors });
    } catch (err) { res.status(500).json({ error: 'Erro ao criar contato: ' + err.message }); }
};

exports.createTicket = async (req, res) => {
    try {
        const { serviceId, accountId, contactId, type, priority, origin, expectationDate, assignToMe, subject, desc } = req.body;
        const conn = await getSfConnection();
        const caseData = { Subject: subject, Description: desc, AccountId: accountId, ContactId: contactId || null, Type: type, Priority: priority, Origin: origin, Status: 'New', DataExpectativaCliente__c: expectationDate || null };
        
        let logAction = 'Criado';
        if (assignToMe === true || assignToMe === 'true') { 
            caseData.Pessoa__c = req.session.user.id; 
            caseData.Status = 'In Progress';
            logAction = 'Criado e Assumido';
        }

        const ret = await conn.sobject('Case').create(caseData);
        if (ret.success) {
            await createCaseLog(conn, ret.id, logAction, req.session.user.id, 'Operacao');
            res.json({ success: true, id: ret.id });
        }
        else res.status(400).json({ success: false, errors: ret.errors });
    } catch (err) { res.status(500).json({ error: 'Erro ao criar chamado.' }); }
};

exports.updateTicket = async (req, res) => {
    try {
        const { id, status, estimationDate, type, priority } = req.body;
        const conn = await getSfConnection();
        const updateData = {
            Id: id,
            Status: status,
            Type: type,
            Priority: priority,
            DataEstimativaEntrega__c: estimationDate || null
        };
        const ret = await conn.sobject('Case').update(updateData);
        if (ret.success) {
            await createCaseLog(conn, id, 'Atualizado', req.session.user.id, 'Operacao', `Status: ${status}, DataEst: ${estimationDate}`);
            res.json({ success: true });
        }
        else res.status(400).json({ success: false, errors: ret.errors });
    } catch (err) { res.status(500).json({ error: 'Erro ao atualizar.' }); }
};

exports.uploadAttachments = async (req, res) => {
    try {
        const { id } = req.params;
        const files = req.files;
        if (!files || files.length === 0) return res.status(400).json({ error: 'Nenhum arquivo.' });
        const conn = await getSfConnection();
        for (const file of files) {
            const base64Data = fs.readFileSync(file.path, { encoding: 'base64' });
            const contentVersion = await conn.sobject('ContentVersion').create({ Title: file.originalname, PathOnClient: file.originalname, VersionData: base64Data, FirstPublishLocationId: id });
            fs.unlinkSync(file.path);
            if (!contentVersion.success) throw new Error(`Falha ao salvar ${file.originalname}`);
        }
        await createCaseLog(conn, id, 'Anexo Adicionado', req.session.user.id, 'Operacao');
        res.json({ success: true });
    } catch (err) {
        console.error("Erro upload:", err);
        res.status(500).json({ error: 'Erro no upload: ' + err.message });
    }
};

exports.downloadAttachment = async (req, res) => {
    try {
        const { id } = req.params; 
        const conn = await getSfConnection();
        
        const cv = await conn.sobject('ContentVersion').retrieve(id);
        res.setHeader('Content-Type', 'application/octet-stream');
        res.setHeader('Content-Disposition', `attachment; filename="${cv.Title}.${cv.FileExtension}"`);

        const blobStream = conn.sobject('ContentVersion').record(id).blob('VersionData');
        blobStream.pipe(res);

    } catch (err) {
        console.error("Erro download:", err);
        res.status(404).send("Arquivo não encontrado ou erro no download.");
    }
};

exports.assignTicket = async (req, res) => { 
    try { 
        const { id } = req.body; 
        const conn = await getSfConnection(); 
        const ret = await conn.sobject('Case').update({ Id: id, Pessoa__c: req.session.user.id, Status: 'In Progress' }); 
        if (ret.success) {
            await createCaseLog(conn, id, 'Assumido', req.session.user.id, 'Operacao');
            res.json({ success: true }); 
        } else res.status(400).json({ success: false }); 
    } catch (err) { res.status(500).json({ error: 'Erro ao atribuir.' }); } 
};

exports.returnToQueue = async (req, res) => { 
    try { 
        const { id } = req.body; 
        const conn = await getSfConnection(); 
        const ret = await conn.sobject('Case').update({ Id: id, Pessoa__c: null, Status: 'New' }); 
        if (ret.success) {
            await createCaseLog(conn, id, 'Devolvido à Fila', req.session.user.id, 'Operacao');
            res.json({ success: true }); 
        } else res.status(400).json({ success: false }); 
    } catch (err) { res.status(500).json({ error: 'Erro ao devolver.' }); } 
};

exports.transferTicket = async (req, res) => {
    try {
        const { id, target } = req.body; 
        const conn = await getSfConnection();
        let updateData = { Id: id };
        let actionMsg = 'Transferido';
        if (target === 'queue') { 
            updateData.Pessoa__c = null; 
            updateData.Status = 'New'; 
            actionMsg = 'Transferido para Fila';
        } else { 
            updateData.Pessoa__c = target; 
            actionMsg = 'Transferido para Outro';
        }
        const ret = await conn.sobject('Case').update(updateData);
        if (ret.success) {
            await createCaseLog(conn, id, actionMsg, req.session.user.id, 'Operacao');
            res.json({ success: true });
        } else res.status(400).json({ success: false, errors: ret.errors });
    } catch (err) { res.status(500).json({ error: 'Erro ao transferir.' }); }
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
        if (!stats.exists) return res.status(400).json({ error: `Sem dia de ponto gerado para ${targetDate}.` });

        const { diaPeriodoId, periodoId, limiteDia, usedNormal, usedExtra } = stats;

        const saldoDisponivel = Math.max(0, limiteDia - usedNormal);
        
        if ((usedNormal + hNorm) > (limiteDia + 0.01)) {
             return res.status(400).json({ error: `Limite de horas normais (${limiteDia}h) excedido. Você já lançou ${usedNormal}h. Restam: ${saldoDisponivel}h normais.` });
        }
        
        if ((usedNormal + usedExtra + hNorm + hExtra) > 24) return res.status(400).json({ error: `Total diário excede 24h.` });
        
        if (hExtra > 0) {
            const totalNormalProjected = usedNormal + hNorm;
            if (totalNormalProjected < (limiteDia - 0.01)) {
                return res.status(400).json({ error: `Complete as horas normais (${limiteDia}h) antes de lançar extras.` });
            }
        }

        let finalActivityId = activityId;
        let serviceId = null;
        let alocacaoId = null;

        if (activityId === 'new') {
            if (!newActivityName) return res.status(400).json({ error: 'Nome obrigatório.' });
            const caseRes = await conn.sobject('Case').retrieve(caseId);
            const alocQuery = `SELECT Id, Servico__c FROM Alocacao__c WHERE Pessoa__c = '${userId}' AND Servico__r.Conta__c = '${caseRes.AccountId}' AND DataInicio__c <= ${targetDate} AND (DataFim__c >= ${targetDate} OR DataFim__c = NULL) LIMIT 1`;
            const alocRes = await conn.query(alocQuery);
            if (alocRes.totalSize === 0) return res.status(400).json({ error: `Sem alocação ativa para esta conta.` });
            serviceId = alocRes.records[0].Servico__c; alocacaoId = alocRes.records[0].Id;
            const newAct = await conn.sobject('Atividade__c').create({ Name: `${caseRes.CaseNumber} - ${newActivityName}`.substring(0, 80), Caso__c: caseId, Servico__c: serviceId });
            finalActivityId = newAct.id;
        } else {
            const actRes = await conn.sobject('Atividade__c').retrieve(finalActivityId);
            serviceId = actRes.Servico__c;
            const alocQuery = `SELECT Id FROM Alocacao__c WHERE Pessoa__c = '${userId}' AND Servico__c = '${serviceId}' AND DataInicio__c <= ${targetDate} AND (DataFim__c >= ${targetDate} OR DataFim__c = NULL) LIMIT 1`;
            const alocRes = await conn.query(alocQuery);
            if (alocRes.totalSize === 0) return res.status(400).json({ error: `Alocação inválida.` });
            alocacaoId = alocRes.records[0].Id;
        }

        const responsavelId = await getOrCreateResponsavel(conn, finalActivityId, alocacaoId);
        const logEntry = { Pessoa__c: userId, DiaPeriodo__c: diaPeriodoId, Periodo__c: periodoId, Servico__c: serviceId, Atividade__c: finalActivityId, Responsavel__c: responsavelId, Justificativa__c: desc || 'N2', Status__c: 'Rascunho', Horas__c: hNorm, HorasExtras__c: hExtra };
        const ret = await conn.sobject('LancamentoHora__c').create(logEntry);
        
        if (ret.success) {
            await createCaseLog(conn, caseId, 'Apontamento de Horas', userId, 'Operacao', `${hNorm}h N / ${hExtra}h E`);
            res.json({ success: true }); 
        } else res.status(400).json({ success: false, errors: ret.errors });

    } catch (err) { res.status(500).json({ error: err.message }); }
};

exports.addComment = async (req, res) => { 
    try { 
        const { caseId, text } = req.body; 
        const userName = req.session.user.nome || 'Usuário';
        const formattedText = `[${userName}]: ${text}`;
        
        const conn = await getSfConnection(); 
        const ret = await conn.sobject('CaseComment').create({ ParentId: caseId, CommentBody: formattedText, IsPublished: false }); 
        if (ret.success) {
            await createCaseLog(conn, caseId, 'Comentário', req.session.user.id, 'Operacao');
            res.json({ success: true }); 
        } else res.status(400).json({ success: false }); 
    } catch (err) { res.status(500).json({ error: 'Erro ao comentar.' }); } 
};