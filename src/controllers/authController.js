const axios = require('axios');
const { getSfConnection } = require('../config/salesforce');

exports.loginPage = (req, res) => {
    if (req.session.user) return res.redirect('/dashboard');
    res.render('login');
};

exports.azureLogin = (req, res) => {
    const authUrl = `https://login.microsoftonline.com/${process.env.AZURE_TENANT_ID}/oauth2/v2.0/authorize?client_id=${process.env.AZURE_CLIENT_ID}&response_type=code&redirect_uri=${encodeURIComponent(process.env.REDIRECT_URI)}&response_mode=query&scope=User.Read openid profile email`;
    res.redirect(authUrl);
};

exports.azureCallback = async (req, res) => {
    const { code } = req.query;
    if (!code) return res.send('Erro: Sem código do Azure.');

    try {
        // A. Pega Token Microsoft
        const msTokenRes = await axios.post(`https://login.microsoftonline.com/${process.env.AZURE_TENANT_ID}/oauth2/v2.0/token`, new URLSearchParams({
            client_id: process.env.AZURE_CLIENT_ID,
            client_secret: process.env.AZURE_CLIENT_SECRET,
            code: code,
            redirect_uri: process.env.REDIRECT_URI,
            grant_type: 'authorization_code',
            scope: 'User.Read openid profile email'
        }));

        // B. Pega Email do Usuário
        const msUserRes = await axios.get('https://graph.microsoft.com/v1.0/me', {
            headers: { Authorization: `Bearer ${msTokenRes.data.access_token}` }
        });
        const userEmail = msUserRes.data.mail || msUserRes.data.userPrincipalName;

        // C. Busca dados no Salesforce
        const conn = await getSfConnection();
        
        const soqlPessoa = `
            SELECT Id, Name, Email__c,
                   (SELECT Name FROM ContratosPessoa__r WHERE Status__c = 'Ativo' LIMIT 1),
                   (SELECT Grupo__r.Codigo__c FROM GruposDePermissao__r)
            FROM Pessoa__c 
            WHERE Email__c = '${userEmail}' 
            LIMIT 1
        `;
        
        const sfResult = await conn.query(soqlPessoa);

        if (sfResult.totalSize === 0) {
            return res.render('negado', { mensagem: 'E-mail não encontrado na base de Pessoas.' });
        }

        const pessoa = sfResult.records[0];
        const contrato = (pessoa.ContratosPessoa__r && pessoa.ContratosPessoa__r.records) 
                         ? pessoa.ContratosPessoa__r.records[0].Name 
                         : null;

        // 1. Grupos explícitos (Via MembroGrupo__c)
        let grupos = (pessoa.GruposDePermissao__r && pessoa.GruposDePermissao__r.records)
            ? pessoa.GruposDePermissao__r.records.map(m => m.Grupo__r.Codigo__c)
            : [];

        // Garante grupo mínimo
        if (grupos.length === 0) grupos.push('USER');
            
        console.log(`✅ Login: ${pessoa.Name} | Grupos: ${grupos.join(', ')}`);

        // D. Salva na Sessão
        req.session.user = {
            id: pessoa.Id,
            nome: pessoa.Name,
            email: userEmail,
            funcao: grupos, 
            contrato: contrato, 
            grupos: grupos      
        };

        // Força salvamento antes do redirect (embora cookie-session seja auto, bom para debug)
        req.session.isChanged = true; 
        res.redirect('/dashboard');

    } catch (error) {
        console.error("❌ Erro Crítico no Login:", error.response ? error.response.data : error.message);
        res.render('negado', { mensagem: 'Erro técnico no processo de login: ' + (error.message || 'Desconhecido') });
    }
};

exports.logout = (req, res) => {
    console.log("🚪 Logout solicitado para:", req.session ? req.session.user : 'Sessão anônima');
    req.session = null;
    // Opcional: Redirecionar para logout da Microsoft se necessário
    // const azureLogout = `https://login.microsoftonline.com/${process.env.AZURE_TENANT_ID}/oauth2/v2.0/logout?post_logout_redirect_uri=${encodeURIComponent(process.env.REDIRECT_URI.replace('/auth/callback',''))}`;
    res.redirect('/');
};

// --- IMPERSONATION (LOGIN AS) ---

exports.getUsersForImpersonation = async (req, res) => {
    try {
        const { term } = req.query;
        if (!term || term.length < 3) return res.json([]);

        const conn = await getSfConnection();
        const safeTerm = term.replace(/'/g, "\\'");
        
        const query = `
            SELECT Id, Name, Email__c 
            FROM Pessoa__c 
            WHERE (Name LIKE '%${safeTerm}%' OR Email__c LIKE '%${safeTerm}%') 
            ORDER BY Name ASC
        `;
        
        const result = await conn.query(query);
        res.json(result.records.map(r => ({ id: r.Id, name: r.Name, email: r.Email__c })));
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
};

exports.impersonateUser = async (req, res) => {
    try {
        const { targetId } = req.body;
        if (!targetId) return res.status(400).json({ error: 'ID inválido' });

        const conn = await getSfConnection();
        
        // 1. Busca Dados Completos (Mesma lógica do Login)
        const soqlPessoa = `
            SELECT Id, Name, Email__c,
                   (SELECT Name FROM ContratosPessoa__r WHERE Status__c = 'Ativo' LIMIT 1),
                   (SELECT Grupo__r.Codigo__c FROM GruposDePermissao__r)
            FROM Pessoa__c 
            WHERE Id = '${targetId}' 
            LIMIT 1
        `;
        const sfResult = await conn.query(soqlPessoa);
        
        if (sfResult.totalSize === 0) return res.status(404).json({ error: 'Usuário não encontrado' });

        const pessoa = sfResult.records[0];
        const contrato = (pessoa.ContratosPessoa__r && pessoa.ContratosPessoa__r.records) ? pessoa.ContratosPessoa__r.records[0].Name : null;

        // 2. Grupos
        let grupos = (pessoa.GruposDePermissao__r && pessoa.GruposDePermissao__r.records) ? pessoa.GruposDePermissao__r.records.map(m => m.Grupo__r.Codigo__c) : [];

        if (grupos.length === 0) grupos.push('USER');

        // 4. Troca Sessão
        console.log(`🕵️ IMPERSONATION: ${req.session.user.email} -> ${pessoa.Name}`);
        
        // Salva usuário original para retorno
        req.session.originalUser = req.session.user;

        req.session.user = {
            id: pessoa.Id,
            nome: pessoa.Name,
            email: pessoa.Email__c,
            funcao: grupos,
            contrato: contrato,
            grupos: grupos,
            isImpersonating: true // Flag visual
        };

        res.json({ success: true });

    } catch (e) {
        res.status(500).json({ error: e.message });
    }
};

exports.stopImpersonation = (req, res) => {
    if (req.session && req.session.originalUser) {
        console.log(`🔙 Revertendo Impersonation: ${req.session.user.email} -> ${req.session.originalUser.email}`);
        req.session.user = req.session.originalUser;
        delete req.session.originalUser;
        res.redirect('/dashboard');
    } else {
        res.redirect('/logout');
    }
};