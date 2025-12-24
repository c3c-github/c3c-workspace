const { getSfConnection } = require('../config/salesforce');

// ==============================================================================
// HELPER FUNCTIONS
// ==============================================================================

/**
 * Garante que existe o registro de ligação 'Responsavel__c' entre a Atividade e a Alocação.
 * Isso é obrigatório no banco de dados para salvar horas.
 */
async function getOrCreateResponsavel(conn, atividadeId, alocacaoId) {
    if (!atividadeId || !alocacaoId) return null;

    // 1. Verifica se já existe
    const query = `SELECT Id FROM Responsavel__c WHERE Atividade__c = '${atividadeId}' AND Alocacao__c = '${alocacaoId}' LIMIT 1`;
    const result = await conn.query(query);

    if (result.totalSize > 0) return result.records[0].Id;

    // 2. Se não existir, cria um novo
    try {
        const novo = await conn.sobject('Responsavel__c').create({
            Atividade__c: atividadeId,
            Alocacao__c: alocacaoId
        });
        if (novo.success) return novo.id;
        throw new Error(JSON.stringify(novo.errors));
    } catch (e) {
        console.error("Erro ao criar Responsável (vínculo):", e);
        throw e;
    }
}

/**
 * Renderiza a página principal
 */
exports.renderOperations = (req, res) => {
    const user = req.session.user || { nome: 'Usuário', grupos: [] };
    res.render('operations', { user: user, page: 'operations' });
};

// ==============================================================================
// API: LEITURA DE DADOS
// ==============================================================================

/**
 * Lista chamados com base no filtro:
 * - 'my': Meus chamados (Pessoa__c = Eu)
 * - 'queue': Fila (Minhas Contas + Pessoa__c = Null)
 * - 'team': Equipe (Minhas Contas + Pessoa__c != Eu)
 */
exports.getTickets = async (req, res) => {
    try {
        const { filter } = req.query; // 'my', 'queue', 'team'
        const userId = req.session.user.id;
        const conn = await getSfConnection();

        const pessoaId = userId;
        // Filtro Padrão: Apenas chamados ABERTOS
        let whereClause = { IsClosed: false };

        if (filter === 'my') {
            whereClause.Pessoa__c = pessoaId;
        } else {
            // Lógica de Território:
            // O usuário só vê filas/equipe das contas onde ele tem ALOCAÇÃO VIGENTE HOJE.
            const today = new Date().toISOString().split('T')[0];
            
            // Query bruta para evitar problemas de aspas com datas no JSForce
            const soqlAloc = `
                SELECT Servico__r.Conta__c 
                FROM Alocacao__c 
                WHERE Pessoa__c = '${pessoaId}' 
                AND DataInicio__c <= ${today} 
                AND (DataFim__c >= ${today} OR DataFim__c = NULL)
            `;
            
            const alocacoes = await conn.query(soqlAloc);

            // Extrai IDs únicos de contas
            const accountIds = alocacoes.records
                .map(a => a.Servico__r ? a.Servico__r.Conta__c : null)
                .filter(id => id !== null);
            
            const myAccountIds = [...new Set(accountIds)];

            // Se não tem alocação ativa, não vê nada nas filas
            if (myAccountIds.length === 0) return res.json([]); 

            whereClause.AccountId = { $in: myAccountIds };

            if (filter === 'queue') {
                whereClause.Pessoa__c = null;
            } else if (filter === 'team') {
                whereClause.Pessoa__c = { $ne: null, $ne: pessoaId };
            }
        }

        const fields = 'Id, CaseNumber, Subject, Status, Priority, Description, CreatedDate, Account.Name, Pessoa__c, Pessoa__r.Name';
        
        const cases = await conn.sobject('Case')
            .find(whereClause, fields)
            .sort({ CreatedDate: -1 })
            .limit(50)
            .execute();

        // Formata resposta para o frontend
        const result = cases.map(c => ({
            id: c.Id,
            caseNumber: c.CaseNumber,
            title: c.Subject || 'Sem Assunto',
            client: c.Account ? c.Account.Name : 'N/A',
            status: c.Status,
            priority: c.Priority,
            desc: c.Description,
            ownerName: c.Pessoa__r ? c.Pessoa__r.Name : 'Fila',
            date: new Date(c.CreatedDate).toLocaleDateString('pt-BR')
        }));

        res.json(result);

    } catch (err) {
        console.error("Erro getTickets:", err);
        res.status(500).json({ error: 'Erro ao buscar chamados.' });
    }
};

/**
 * Busca detalhes completos: Comentários e Logs de Tempo
 */
exports.getTicketDetails = async (req, res) => {
    const { id } = req.params;
    try {
        const conn = await getSfConnection();

        // 1. Comentários (CaseComment)
        const comments = await conn.sobject('CaseComment')
            .find({ ParentId: id }, 'CommentBody, CreatedDate, CreatedBy.Name, IsPublished')
            .sort({ CreatedDate: -1 })
            .execute();

        // 2. Logs de Tempo (LancamentoHora__c)
        // Filtra apenas registros com horas apontadas (>0) e traz Justificativa
        const logsQuery = `
            SELECT Id, DiaPeriodo__r.Data__c, Horas__c, HorasExtras__c, Justificativa__c, Atividade__r.Name 
            FROM LancamentoHora__c 
            WHERE Atividade__r.Caso__c = '${id}' 
            AND (Horas__c > 0 OR HorasExtras__c > 0)
            ORDER BY DiaPeriodo__r.Data__c DESC
        `;
        
        const logsRes = await conn.query(logsQuery);

        res.json({
            comments: comments.map(c => ({
                text: c.CommentBody,
                user: c.CreatedBy ? c.CreatedBy.Name : 'Sistema',
                time: new Date(c.CreatedDate).toLocaleString('pt-BR'),
                public: c.IsPublished
            })),
            logs: logsRes.records.map(l => {
                const isExtra = (l.HorasExtras__c || 0) > 0;
                const valor = isExtra ? l.HorasExtras__c : l.Horas__c;
                
                return {
                    date: l.DiaPeriodo__r ? new Date(l.DiaPeriodo__r.Data__c).toLocaleDateString('pt-BR') : '-',
                    activity: l.Atividade__r ? l.Atividade__r.Name : 'Geral',
                    desc: l.Justificativa__c || '-',
                    hours: valor, // Valor numérico para cálculo
                    type: isExtra ? 'Extra' : 'Normal'
                };
            })
        });

    } catch (err) {
        console.error("Erro getTicketDetails:", err);
        res.status(500).json({ error: 'Erro ao buscar detalhes.' });
    }
};

/**
 * Busca atividades vinculadas ao caso para preencher o select
 */
exports.getTicketActivities = async (req, res) => {
    const { id } = req.params;
    try {
        const conn = await getSfConnection();
        const activities = await conn.sobject('Atividade__c')
            .find({ Caso__c: id }, 'Id, Name, Servico__c')
            .sort({ CreatedDate: -1 })
            .execute();
        res.json(activities);
    } catch (err) {
        console.error("Erro getTicketActivities:", err);
        res.status(500).json({ error: 'Erro ao buscar atividades.' });
    }
};

// ==============================================================================
// API: ESCRITA (DML)
// ==============================================================================

/**
 * Salva o apontamento de horas.
 * Lógica complexa:
 * 1. Arredonda horas.
 * 2. Verifica contrato na DATA informada.
 * 3. Cria Atividade (com prefixo e limite) ou usa existente.
 * 4. Valida Alocação no serviço para a DATA informada.
 * 5. Garante Responsavel__c.
 * 6. Cria LancamentoHora__c.
 */
exports.saveLog = async (req, res) => {
    try {
        const { caseId, activityId, newActivityName, hours, isExtra, desc, date } = req.body;
        const userId = req.session.user.id;
        const conn = await getSfConnection();

        // 1. Definição da Data (Usa data informada ou Hoje)
        const targetDate = date ? date : new Date().toISOString().split('T')[0];
        
        // 2. Arredondamento de Horas (Regra: Incrementos de 0.5)
        let rawHours = parseFloat(hours);
        if (isNaN(rawHours) || rawHours <= 0) return res.status(400).json({ error: 'Horas inválidas.' });
        
        // Ex: 1.2 -> 1.0 | 1.3 -> 1.5 | 1.7 -> 1.5 | 1.8 -> 2.0
        const finalHours = Math.round(rawHours * 2) / 2;

        if (finalHours === 0) return res.status(400).json({ error: 'O tempo mínimo registrálvel é 0.5h.' });

        // 3. Valida se existe Dia de Ponto gerado para a DATA ALVO
        const diaQuery = `SELECT Id, Periodo__c FROM DiaPeriodo__c WHERE Data__c = ${targetDate} AND Periodo__r.ContratoPessoa__r.Pessoa__c = '${userId}' LIMIT 1`;
        const diaRes = await conn.query(diaQuery);
        
        if (diaRes.totalSize === 0) {
            return res.status(400).json({ error: `Sem dia de ponto gerado para a data ${targetDate}. Verifique se o contrato está ativo.` });
        }
        
        const diaPeriodoId = diaRes.records[0].Id;
        const periodoId = diaRes.records[0].Periodo__c;

        let finalActivityId = activityId;
        let serviceId = null;
        let alocacaoId = null;

        // 4. Lógica de Atividade
        if (activityId === 'new') {
            // --- CRIAR NOVA ATIVIDADE ---
            if (!newActivityName) return res.status(400).json({ error: 'Nome da atividade obrigatório.' });
            
            // Busca dados do Caso (Número e Conta)
            const caseRes = await conn.sobject('Case').retrieve(caseId);
            if(!caseRes.AccountId) return res.status(400).json({ error: 'Caso sem Conta vinculada, impossível determinar Serviço.' });

            // Busca Alocação Válida NA DATA ESCOLHIDA para a Conta do Caso
            const alocQuery = `
                SELECT Id, Servico__c FROM Alocacao__c 
                WHERE Pessoa__c = '${userId}' 
                AND Servico__r.Conta__c = '${caseRes.AccountId}' 
                AND DataInicio__c <= ${targetDate} 
                AND (DataFim__c >= ${targetDate} OR DataFim__c = NULL) 
                LIMIT 1
            `;
            const alocRes = await conn.query(alocQuery);
            
            if (alocRes.totalSize === 0) {
                return res.status(400).json({ error: `Sem alocação ativa no cliente para a data ${targetDate}.` });
            }
            
            serviceId = alocRes.records[0].Servico__c;
            alocacaoId = alocRes.records[0].Id;

            // [REGRA DE NEGÓCIO]: Formatar Nome da Atividade
            // Formato: "0001234 - Nome da Atividade"
            // Limite: 80 caracteres (Padrão Salesforce Name)
            let formattedName = `${caseRes.CaseNumber} - ${newActivityName}`;
            if (formattedName.length > 80) {
                formattedName = formattedName.substring(0, 80);
            }

            const newAct = await conn.sobject('Atividade__c').create({ 
                Name: formattedName, 
                Caso__c: caseId, 
                Servico__c: serviceId 
            });

            if (!newAct.success) throw new Error('Falha ao criar registro de atividade.');
            finalActivityId = newAct.id;

        } else {
            // --- USAR ATIVIDADE EXISTENTE ---
            const actRes = await conn.sobject('Atividade__c').retrieve(finalActivityId);
            serviceId = actRes.Servico__c;
            
            // Valida se a alocação para ESSE serviço ainda é válida na DATA ESCOLHIDA
            const alocQuery = `
                SELECT Id FROM Alocacao__c 
                WHERE Pessoa__c = '${userId}' 
                AND Servico__c = '${serviceId}' 
                AND DataInicio__c <= ${targetDate} 
                AND (DataFim__c >= ${targetDate} OR DataFim__c = NULL) 
                LIMIT 1
            `;
            const alocRes = await conn.query(alocQuery);
            if (alocRes.totalSize === 0) {
                return res.status(400).json({ error: `Sua alocação para este serviço não é válida na data ${targetDate}.` });
            }
            alocacaoId = alocRes.records[0].Id;
        }

        // 5. Garantir vínculo de Responsável (Atividade x Alocação)
        const responsavelId = await getOrCreateResponsavel(conn, finalActivityId, alocacaoId);

        // 6. Preparar Lançamento
        const logEntry = {
            Pessoa__c: userId,
            DiaPeriodo__c: diaPeriodoId,
            Periodo__c: periodoId,
            Servico__c: serviceId,
            Atividade__c: finalActivityId,
            Responsavel__c: responsavelId,
            Justificativa__c: desc || 'Apontamento N2',
            Status__c: 'Rascunho',
            Horas__c: 0,
            HorasExtras__c: 0
        };

        if (isExtra === true || isExtra === 'true') {
            logEntry.HorasExtras__c = finalHours;
            // Opcional: Adicionar prefixo visual na justificativa se quiser
            // logEntry.Justificativa__c = '[EXTRA] ' + logEntry.Justificativa__c; 
        } else {
            logEntry.Horas__c = finalHours;
        }

        const ret = await conn.sobject('LancamentoHora__c').create(logEntry);

        if (ret.success) res.json({ success: true });
        else res.status(400).json({ success: false, errors: ret.errors });

    } catch (err) {
        console.error("Erro saveLog:", err);
        res.status(500).json({ error: err.message });
    }
};

/**
 * Cria um novo Caso (Chamado)
 * Se accountId não for um ID válido, tenta buscar a conta pelo nome.
 */
exports.createTicket = async (req, res) => {
    try {
        const { subject, desc, accountId, priority } = req.body; // accountId aqui pode vir como Nome (texto)
        const conn = await getSfConnection();
        
        let finalAccountId = accountId;

        // Verificação simples se é ID (tamanho 15 ou 18 chars). Se não for, busca por nome.
        if (accountId && accountId.length !== 15 && accountId.length !== 18) {
            const accQuery = `SELECT Id FROM Account WHERE Name LIKE '%${accountId}%' LIMIT 1`;
            const accRes = await conn.query(accQuery);
            if (accRes.totalSize > 0) {
                finalAccountId = accRes.records[0].Id;
            } else {
                // Se não achar, pode dar erro ou criar sem conta. Vamos dar erro para forçar integridade.
                return res.status(400).json({ error: 'Conta não encontrada com esse nome.' });
            }
        }

        const ret = await conn.sobject('Case').create({
            Subject: subject,
            Description: desc,
            Priority: priority || 'Medium',
            Status: 'New',
            AccountId: finalAccountId,
            Origin: 'Web'
        });

        if (ret.success) res.json({ success: true, id: ret.id });
        else res.status(400).json({ success: false, errors: ret.errors });

    } catch (err) {
        console.error("Erro createTicket:", err);
        res.status(500).json({ error: 'Erro ao criar chamado.' });
    }
};

/**
 * Adiciona comentário ao chamado
 */
exports.addComment = async (req, res) => {
    try {
        const { caseId, text, isPublic } = req.body;
        const conn = await getSfConnection();
        const ret = await conn.sobject('CaseComment').create({
            ParentId: caseId,
            CommentBody: text,
            IsPublished: isPublic || false
        });
        if (ret.success) res.json({ success: true });
        else res.status(400).json({ success: false });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Erro ao comentar.' });
    }
};

/**
 * Atribui o chamado ao usuário atual (Puxar da fila)
 */
exports.assignTicket = async (req, res) => {
    try {
        const { id } = req.body;
        const userId = req.session.user.id;
        const conn = await getSfConnection();
        const ret = await conn.sobject('Case').update({
            Id: id,
            Pessoa__c: userId,
            Status: 'In Progress'
        });
        if (ret.success) res.json({ success: true });
        else res.status(400).json({ success: false });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Erro ao atribuir.' });
    }
};