const { getSfConnection } = require('../config/salesforce');
const fs = require('fs');

// FILTRO CORRIGIDO
const FILTRO_OPS = `(Horas__c > 0 OR HorasExtras__c > 0 OR (HorasBanco__c != 0 AND HorasBanco__c != null) OR HorasAusenciaRemunerada__c > 0 OR HorasAusenciaNaoRemunerada__c > 0)`;

// ==============================================================================
// HELPER FUNCTIONS
// ==============================================================================

function areIdsEqual(id1, id2) {
    if (!id1 || !id2) return false;
    return id1.substring(0, 15) === id2.substring(0, 15);
}

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
        const logData = { Caso__c: caseId, Acao__c: action, TipoUsuario__c: userType, Pessoa__c: userId, Descricao__c: desc };
        await conn.sobject('LogCaso__c').create(logData);
    } catch (e) { console.warn("LogCaso__c erro:", e.message); }
}

async function calculateDailyStats(conn, userId, targetDate) {
    const dateStr = targetDate.includes('T') ? targetDate.split('T')[0] : targetDate;
    
    try {
        const diaQuery = `SELECT Id, Periodo__c, Periodo__r.ContratoPessoa__r.Hora__c FROM DiaPeriodo__c WHERE Data__c = ${dateStr} AND Periodo__r.ContratoPessoa__r.Pessoa__c = '${userId}' LIMIT 1`;
        const diaRes = await conn.query(diaQuery);
        
        if (diaRes.totalSize === 0) return { exists: false, diaPeriodoId: null, limiteDia: 8, usedNormal: 0, usedExtra: 0, saldoNormalDia: 8 };
        
        const diaRecord = diaRes.records[0];
        const limiteDia = (diaRecord.Periodo__r && diaRecord.Periodo__r.ContratoPessoa__r && diaRecord.Periodo__r.ContratoPessoa__r.Hora__c) ? diaRecord.Periodo__r.ContratoPessoa__r.Hora__c : 8;
        
        // Aplica o filtro para não somar lixo
        const somaQuery = `SELECT SUM(Horas__c) totalNormal, SUM(HorasExtras__c) totalExtra FROM LancamentoHora__c WHERE DiaPeriodo__c = '${diaRecord.Id}' AND Pessoa__c = '${userId}' AND ${FILTRO_OPS}`;
        
        let usedNormal = 0, usedExtra = 0;
        const somaRes = await conn.query(somaQuery);
        if (somaRes.totalSize > 0) {
            usedNormal = somaRes.records[0].totalNormal || 0;
            usedExtra = somaRes.records[0].totalExtra || 0;
        }
        
        return { exists: true, diaPeriodoId: diaRecord.Id, periodoId: diaRecord.Periodo__c, limiteDia, usedNormal, usedExtra, saldoNormalDia: limiteDia - usedNormal };
    } catch (e) { 
        return { exists: false, diaPeriodoId: null, limiteDia: 8, usedNormal: 0, usedExtra: 0, saldoNormalDia: 8 }; 
    }
}

async function isDayLockedByDiaId(conn, diaPeriodoId, userId) {
    if (!diaPeriodoId) return false;
    const soql = `SELECT Id FROM LancamentoHora__c WHERE DiaPeriodo__c = '${diaPeriodoId}' AND Pessoa__c = '${userId}' AND Status__c NOT IN ('Rascunho', 'Reprovado') LIMIT 1`;
    const res = await conn.query(soql);
    return res.totalSize > 0;
}

// ==============================================================================
// CONTROLLERS
// ==============================================================================

exports.renderOperations = (req, res) => {
    const user = req.session.user || { nome: 'Usuário', grupos: [] };
    res.render('operations', { user: user, page: 'operations' });
};

// --- LEITURA ---

exports.getLimits = async (req, res) => {
    try {
        const { date } = req.query;
        const userId = req.session.user.id;
        if (!date) return res.status(400).json({ error: 'Data obrigatória.' });
        const conn = await getSfConnection();
        const stats = await calculateDailyStats(conn, userId, date);
        let isLocked = false;
        if (stats.exists && stats.diaPeriodoId) isLocked = await isDayLockedByDiaId(conn, stats.diaPeriodoId, userId);
        res.json({ success: true, exists: stats.exists, limit: stats.limiteDia, usedNormal: stats.usedNormal, usedExtra: stats.usedExtra, remainingNormal: stats.saldoNormalDia, isLocked: isLocked });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
};

exports.getTickets = async (req, res) => {
    try {
        const { filter } = req.query; 
        const userId = req.session.user.id;
        const conn = await getSfConnection();
        let soql = `SELECT Id, CaseNumber, Subject, Status, Priority, Description, CreatedDate, Account.Name, Pessoa__c, Pessoa__r.Name, Type, Origin, IsClosed FROM Case WHERE Id != null`;

        if (filter === 'my') {
            soql += ` AND Pessoa__c = '${userId}' AND IsClosed = false`;
        } else {
            const today = new Date().toISOString().split('T')[0];
            const soqlAloc = `SELECT Servico__r.Conta__c FROM Alocacao__c WHERE Pessoa__c = '${userId}' AND DataInicio__c <= ${today} AND (DataFim__c >= ${today} OR DataFim__c = NULL)`;
            const alocacoes = await conn.query(soqlAloc);
            const accountIds = [...new Set(alocacoes.records.map(a => a.Servico__r ? a.Servico__r.Conta__c : null).filter(id => id !== null))];
            
            if (accountIds.length === 0) return res.json([]); 
            
            const idsFormatados = accountIds.map(id => `'${id}'`).join(',');
            soql += ` AND AccountId IN (${idsFormatados})`;
            
            if (filter === 'queue') soql += ` AND Pessoa__c = null AND IsClosed = false`;
            else if (filter === 'team') soql += ` AND Pessoa__c != null AND Pessoa__c != '${userId}' AND IsClosed = false`;
            else if (filter === 'all') soql += ` LIMIT 200`;
        }

        if (!soql.includes('LIMIT')) soql += ` ORDER BY CreatedDate DESC LIMIT 100`; 
        
        const result = await conn.query(soql);
        let records = result.records;

        const typeScore = { 'Bug': 0, 'Erro': 0, 'Melhoria': 1, 'Dúvida': 2 };
        const priorityScore = { 'Critical': 0, 'High': 1, 'Medium': 2, 'Low': 3 };
        
        records.sort((a, b) => {
            if (a.IsClosed !== b.IsClosed) return a.IsClosed ? 1 : -1;
            const sA = typeScore[a.Type] !== undefined ? typeScore[a.Type] : 99; const sB = typeScore[b.Type] !== undefined ? typeScore[b.Type] : 99;
            if (sA !== sB) return sA - sB;
            const pA = priorityScore[a.Priority] !== undefined ? priorityScore[a.Priority] : 99; const pB = priorityScore[b.Priority] !== undefined ? priorityScore[b.Priority] : 99;
            if (pA !== pB) return pA - pB;
            return new Date(b.CreatedDate) - new Date(a.CreatedDate);
        });

        res.json(records.map(c => ({
            id: c.Id, caseNumber: c.CaseNumber, title: c.Subject || 'Sem Assunto', client: c.Account ? c.Account.Name : 'N/A',
            status: c.Status, priority: c.Priority, type: c.Type, desc: c.Description, ownerName: c.Pessoa__r ? c.Pessoa__r.Name : 'Fila',
            date: new Date(c.CreatedDate).toLocaleDateString('pt-BR'), rawDate: c.CreatedDate, isClosed: c.IsClosed
        })));
    } catch (err) { res.status(500).json({ error: 'Erro ao buscar chamados: ' + err.message }); }
};

exports.getTicketDetails = async (req, res) => {
    const { id } = req.params;
    const userId = req.session.user.id;
    try {
        const conn = await getSfConnection();
        const tQuery = `SELECT Id, Subject, Description, Status, Type, Priority, Origin, CreatedDate, LastModifiedDate, DataExpectativaCliente__c, DataEstimativaEntrega__c, IsClosed FROM Case WHERE Id = '${id}'`;
        const tResult = await conn.query(tQuery);
        if (tResult.totalSize === 0) throw new Error('Chamado não encontrado.');
        const t = tResult.records[0];

        let lastClientDate = null, lastOpsDate = null;
        try {
            const logQ = `SELECT CreatedDate, TipoUsuario__c FROM LogCaso__c WHERE Caso__c = '${id}' ORDER BY CreatedDate DESC LIMIT 50`;
            const logRes = await conn.query(logQ);
            for (const l of logRes.records) {
                if (!lastClientDate && l.TipoUsuario__c === 'Cliente') lastClientDate = l.CreatedDate;
                if (!lastOpsDate && l.TipoUsuario__c === 'Operacao') lastOpsDate = l.CreatedDate;
                if (lastClientDate && lastOpsDate) break;
            }
        } catch(e) {}

        const comments = await conn.sobject('CaseComment').find({ ParentId: id }, 'CommentBody, CreatedDate, CreatedBy.Name, IsPublished').sort({ CreatedDate: -1 }).execute();
        
        let attachments = [];
        try {
            const linksQuery = `SELECT ContentDocumentId FROM ContentDocumentLink WHERE LinkedEntityId = '${id}'`;
            const links = await conn.query(linksQuery);
            if (links.totalSize > 0) {
                const docIds = links.records.map(r => `'${r.ContentDocumentId}'`).join(',');
                const docsQuery = `SELECT Id, Title, FileExtension, ContentSize FROM ContentVersion WHERE ContentDocumentId IN (${docIds}) AND IsLatest = true`;
                const docs = await conn.query(docsQuery);
                attachments = docs.records.map(d => ({ id: d.Id, name: `${d.Title}.${d.FileExtension}`, size: d.ContentSize }));
            }
        } catch (e) {}

        const logsQuery = `SELECT Id, DiaPeriodo__r.Data__c, Horas__c, HorasExtras__c, Justificativa__c, Atividade__r.Name, Pessoa__c, Pessoa__r.Name, Status__c FROM LancamentoHora__c WHERE Atividade__r.Caso__c = '${id}' AND ${FILTRO_OPS} ORDER BY DiaPeriodo__r.Data__c DESC`;
        const logsRes = await conn.query(logsQuery);

        res.json({
            ticket: {
                Subject: t.Subject, Description: t.Description, Status: t.Status, Type: t.Type, Priority: t.Priority, Origin: t.Origin,
                CreatedDate: t.CreatedDate, LastModifiedDate: t.LastModifiedDate, IsClosed: t.IsClosed,
                LastUpdateClient: lastClientDate, LastUpdateOps: lastOpsDate,
                DataExpectativaCliente__c: t.DataExpectativaCliente__c || null, DataEstimativaEntrega__c: t.DataEstimativaEntrega__c || null
            },
            comments: comments.map(c => ({ text: c.CommentBody, user: 'Sistema', time: new Date(c.CreatedDate).toLocaleString('pt-BR'), public: c.IsPublished })),
            logs: logsRes.records.map(l => {
                let dateStr = '-';
                if (l.DiaPeriodo__r && l.DiaPeriodo__r.Data__c) {
                    const parts = l.DiaPeriodo__r.Data__c.split('-');
                    dateStr = `${parts[2]}/${parts[1]}/${parts[0]}`;
                }
                return { 
                    id: l.Id, date: dateStr, rawDate: l.DiaPeriodo__r ? l.DiaPeriodo__r.Data__c : null,
                    activity: l.Atividade__r ? l.Atividade__r.Name : 'Geral', desc: l.Justificativa__c || '-', 
                    hoursNormal: l.Horas__c || 0, hoursExtra: l.HorasExtras__c || 0,
                    ownerId: l.Pessoa__c, ownerName: l.Pessoa__r ? l.Pessoa__r.Name : '?', status: l.Status__c,
                    canEdit: (areIdsEqual(l.Pessoa__c, userId) && (l.Status__c === 'Rascunho' || l.Status__c === 'Reprovado'))
                };
            }),
            attachments: attachments
        });
    } catch (err) { res.status(500).json({ error: 'Erro ao buscar detalhes: ' + err.message }); }
};

exports.getTicketActivities = async (req, res) => { try { const { id } = req.params; const conn = await getSfConnection(); const activities = await conn.sobject('Atividade__c').find({ Caso__c: id }, 'Id, Name, Servico__c').sort({ CreatedDate: -1 }).execute(); res.json(activities); } catch (err) { res.status(500).json({ error: 'Erro ao buscar atividades.' }); } };
exports.getCreateOptions = async (req, res) => { try { const userId = req.session.user.id; const conn = await getSfConnection(); const today = new Date().toISOString().split('T')[0]; const soql = `SELECT Servico__c, Servico__r.Name, Servico__r.Conta__c, Servico__r.Conta__r.Name FROM Alocacao__c WHERE Pessoa__c = '${userId}' AND DataInicio__c <= ${today} AND (DataFim__c >= ${today} OR DataFim__c = NULL) ORDER BY Servico__r.Name ASC`; const result = await conn.query(soql); const options = result.records.map(r => ({ serviceId: r.Servico__c, serviceName: r.Servico__r ? r.Servico__r.Name : 'Serviço', accountId: r.Servico__r ? r.Servico__r.Conta__c : null, accountName: (r.Servico__r && r.Servico__r.Conta__r) ? r.Servico__r.Conta__r.Name : 'Conta' })); res.json(options); } catch (err) { res.status(500).json({ error: 'Erro ao buscar serviços.' }); } };
exports.getAccountContacts = async (req, res) => { try { const { id } = req.params; const conn = await getSfConnection(); const soql = `SELECT Id, Name, Email FROM Contact WHERE AccountId = '${id}' ORDER BY Name ASC`; const result = await conn.query(soql); res.json(result.records); } catch (err) { res.status(500).json({ error: 'Erro ao buscar contatos.' }); } };

exports.downloadAttachment = async (req, res) => {
    try {
        const { id } = req.params; const conn = await getSfConnection();
        const cv = await conn.sobject('ContentVersion').retrieve(id);
        res.setHeader('Content-Type', 'application/octet-stream');
        res.setHeader('Content-Disposition', `attachment; filename="${cv.Title}.${cv.FileExtension}"`);
        conn.sobject('ContentVersion').record(id).blob('VersionData').pipe(res);
    } catch (err) { res.status(404).send("Erro ao baixar."); }
};

// ==============================================================================
// ESCRITA (LÓGICA COMPLETA RESTAURADA)
// ==============================================================================

exports.createContact = async (req, res) => { try { const { accountId, name, email, mobile } = req.body; if (!accountId || !name) return res.status(400).json({ error: 'Dados inválidos' }); const parts = name.trim().split(' '); let f = '', l = name; if (parts.length>1) { l=parts.pop(); f=parts.join(' '); } const conn = await getSfConnection(); const ret = await conn.sobject('Contact').create({ AccountId: accountId, LastName: l, FirstName: f, Email: email, MobilePhone: mobile }); if (ret.success) res.json({ success: true, id: ret.id, name }); else res.status(400).json({ success: false, errors: ret.errors }); } catch (e) { res.status(500).json({ error: e.message }); } };

exports.createTicket = async (req, res) => {
    try {
        const { serviceId, accountId, contactId, type, priority, origin, expectationDate, assignToMe, subject, desc } = req.body;
        const conn = await getSfConnection();
        const caseData = { Subject: subject, Description: desc, AccountId: accountId, ContactId: contactId || null, Type: type, Priority: priority, Origin: origin, Status: 'New', DataExpectativaCliente__c: expectationDate || null };
        let logA = 'Criado';
        if (assignToMe === true || assignToMe === 'true') { caseData.Pessoa__c = req.session.user.id; caseData.Status = 'In Progress'; logA = 'Criado e Assumido'; }
        const ret = await conn.sobject('Case').create(caseData);
        if (ret.success) { await createCaseLog(conn, ret.id, logA, req.session.user.id, 'Operacao'); res.json({ success: true, id: ret.id }); } 
        else res.status(400).json({ success: false, errors: ret.errors });
    } catch (err) { res.status(500).json({ error: 'Erro ao criar.' }); }
};

exports.updateTicket = async (req, res) => {
    try {
        const { id, status, estimationDate, type, priority } = req.body;
        const conn = await getSfConnection();
        const ret = await conn.sobject('Case').update({ Id: id, Status: status, Type: type, Priority: priority, DataEstimativaEntrega__c: estimationDate || null });
        if (ret.success) { await createCaseLog(conn, id, 'Atualizado', req.session.user.id, 'Operacao', `Status: ${status}`); res.json({ success: true }); }
        else res.status(400).json({ success: false, errors: ret.errors });
    } catch (err) { res.status(500).json({ error: 'Erro ao atualizar.' }); }
};

exports.reopenTicket = async (req, res) => {
    try {
        const { id } = req.body;
        const conn = await getSfConnection();
        const ret = await conn.sobject('Case').update({ Id: id, Status: 'In Progress', Pessoa__c: req.session.user.id });
        if (ret.success) {
            await createCaseLog(conn, id, 'Reaberto', req.session.user.id, 'Operacao');
            res.json({ success: true });
        } else res.status(400).json({ success: false });
    } catch (err) { res.status(500).json({ error: err.message }); }
};

exports.uploadAttachments = async (req, res) => {
    try {
        const { id } = req.params; const files = req.files; if (!files || files.length === 0) return res.status(400).json({ error: 'Sem arquivos.' });
        const conn = await getSfConnection();
        for (const file of files) {
            const b64 = fs.readFileSync(file.path, { encoding: 'base64' });
            await conn.sobject('ContentVersion').create({ Title: file.originalname, PathOnClient: file.originalname, VersionData: b64, FirstPublishLocationId: id });
            fs.unlinkSync(file.path);
        }
        await createCaseLog(conn, id, 'Anexo', req.session.user.id, 'Operacao');
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
};

exports.assignTicket = async (req, res) => { try { const { id } = req.body; const conn = await getSfConnection(); const ret = await conn.sobject('Case').update({ Id: id, Pessoa__c: req.session.user.id, Status: 'In Progress' }); if (ret.success) { await createCaseLog(conn, id, 'Assumido', req.session.user.id, 'Operacao'); res.json({ success: true }); } else res.status(400).json({ success: false }); } catch (err) { res.status(500).json({ error: err.message }); } };
exports.returnToQueue = async (req, res) => { try { const { id } = req.body; const conn = await getSfConnection(); const ret = await conn.sobject('Case').update({ Id: id, Pessoa__c: null, Status: 'New' }); if (ret.success) { await createCaseLog(conn, id, 'Devolvido', req.session.user.id, 'Operacao'); res.json({ success: true }); } else res.status(400).json({ success: false }); } catch (err) { res.status(500).json({ error: err.message }); } };

exports.transferTicket = async (req, res) => { 
    try { 
        const { id, target } = req.body; 
        const conn = await getSfConnection(); 
        let u = { Id: id, Pessoa__c: target==='queue'?null:target, Status: target==='queue'?'New':'In Progress' }; 
        const ret = await conn.sobject('Case').update(u); 
        if (ret.success) { 
            await createCaseLog(conn, id, 'Transferido', req.session.user.id, 'Operacao'); 
            res.json({ success: true }); 
        } else res.status(400).json({ success: false }); 
    } catch (err) { res.status(500).json({ error: err.message }); } 
};

exports.saveLog = async (req, res) => {
    try {
        const { logId, caseId, activityId, newActivityName, hoursNormal, hoursExtra, desc, date } = req.body;
        const userId = req.session.user.id;
        const conn = await getSfConnection();
        const targetDate = date ? date.split('T')[0] : new Date().toISOString().split('T')[0];
        
        const stats = await calculateDailyStats(conn, userId, targetDate);
        if (!stats.exists) return res.status(400).json({ error: `Sem dia de ponto gerado para ${targetDate}.` });

        const isLocked = await isDayLockedByDiaId(conn, stats.diaPeriodoId, userId);
        if (isLocked) return res.status(400).json({ error: `Dia ${targetDate} fechado.` });

        let hNorm = hoursNormal ? parseFloat(hoursNormal.toString().replace(',', '.')) : 0;
        let hExtra = hoursExtra ? parseFloat(hoursExtra.toString().replace(',', '.')) : 0;
        hNorm = Math.round(hNorm * 2) / 2; hExtra = Math.round(hExtra * 2) / 2;

        if (hNorm === 0 && hExtra === 0) return res.status(400).json({ error: 'Informe ao menos 0.5h.' });

        let currentLogHours = { n: 0, e: 0 };
        if (logId) {
            const oldLog = await conn.sobject('LancamentoHora__c').retrieve(logId);
            if (!areIdsEqual(oldLog.Pessoa__c, userId)) return res.status(403).json({ error: 'Acesso negado.' });
            currentLogHours.n = oldLog.Horas__c || 0;
            currentLogHours.e = oldLog.HorasExtras__c || 0;
        }

        const { diaPeriodoId, periodoId, limiteDia, usedNormal, usedExtra } = stats;
        const newTotalNormal = (usedNormal - currentLogHours.n) + hNorm;
        const newTotalExtra = (usedExtra - currentLogHours.e) + hExtra;
        const newTotalDaily = newTotalNormal + newTotalExtra;

        if (newTotalDaily > 24) return res.status(400).json({ error: `Total diário excede 24h.` });
        if (newTotalNormal > (limiteDia + 0.01)) return res.status(400).json({ error: `Limite normal excedido.` });
        if (hExtra > 0 && newTotalNormal < (limiteDia - 0.01)) return res.status(400).json({ error: `Complete as normais antes de lançar extras.` });

        let logEntry = { 
            Horas__c: hNorm, 
            HorasExtras__c: hExtra, 
            Justificativa__c: desc || 'N2', 
            Status__c: 'Rascunho' 
        };

        if (logId) {
            logEntry.Id = logId;
            const ret = await conn.sobject('LancamentoHora__c').update(logEntry);
            if (ret.success) {
                // CORREÇÃO: Passando 'desc' como último parâmetro
                await createCaseLog(conn, caseId, 'Hora Editada', userId, 'Operacao', desc);
                return res.json({ success: true });
            } else return res.status(400).json({ success: false, errors: ret.errors });

        } else {
            let finalActivityId = activityId;
            let serviceId = null, alocacaoId = null;

            if (activityId === 'new') {
                if (!newActivityName) return res.status(400).json({ error: 'Nome obrigatório.' });
                const caseRes = await conn.sobject('Case').retrieve(caseId);
                const alocQuery = `SELECT Id, Servico__c FROM Alocacao__c WHERE Pessoa__c = '${userId}' AND Servico__r.Conta__c = '${caseRes.AccountId}' AND DataInicio__c <= ${targetDate} AND (DataFim__c >= ${targetDate} OR DataFim__c = NULL) LIMIT 1`;
                const alocRes = await conn.query(alocQuery);
                if (alocRes.totalSize === 0) return res.status(400).json({ error: `Sem alocação.` });
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
            
            logEntry.Pessoa__c = userId;
            logEntry.DiaPeriodo__c = diaPeriodoId;
            logEntry.Periodo__c = periodoId;
            logEntry.Servico__c = serviceId;
            logEntry.Atividade__c = finalActivityId;
            logEntry.Responsavel__c = responsavelId;

            const ret = await conn.sobject('LancamentoHora__c').create(logEntry);
            if (ret.success) {
                // CORREÇÃO: Passando 'desc' como último parâmetro
                await createCaseLog(conn, caseId, 'Hora Lançada', userId, 'Operacao', desc);
                return res.json({ success: true });
            } else return res.status(400).json({ success: false, errors: ret.errors });
        }

    } catch (err) { res.status(500).json({ error: err.message }); }
};

exports.deleteLog = async (req, res) => {
    try {
        const { logId } = req.body;
        const userId = req.session.user.id;
        const conn = await getSfConnection();
        
        const log = await conn.sobject('LancamentoHora__c').retrieve(logId);
        if (!areIdsEqual(log.Pessoa__c, userId)) return res.status(403).json({ error: 'Acesso negado.' });
        
        const isLocked = await isDayLockedByDiaId(conn, log.DiaPeriodo__c, userId);
        if (isLocked) return res.status(400).json({ error: 'Dia fechado.' });

        if (log.Status__c !== 'Rascunho' && log.Status__c !== 'Reprovado') return res.status(400).json({ error: 'Status impede exclusão.' });

        const ret = await conn.sobject('LancamentoHora__c').destroy(logId);
        if (ret.success) res.json({ success: true }); else res.status(400).json({ success: false });

    } catch(e) { res.status(500).json({ error: e.message }); }
};

exports.addComment = async (req, res) => { try { const { caseId, text } = req.body; const u = req.session.user.nome||'User'; const t = `[${u}]: ${text}`; const conn = await getSfConnection(); const ret = await conn.sobject('CaseComment').create({ ParentId: caseId, CommentBody: t, IsPublished: false }); if(ret.success) { await createCaseLog(conn, caseId, 'Comentário', req.session.user.id, 'Operacao'); res.json({ success: true }); } else res.status(400).json({ success: false }); } catch (err) { res.status(500).json({ error: 'Erro comentário.' }); } };