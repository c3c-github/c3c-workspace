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
            SELECT Id, Name, (SELECT Name FROM ContratosPessoa__r WHERE Status__c = 'Ativo' LIMIT 1)
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

        if (!contrato) {
            return res.render('negado', { mensagem: 'Pessoa encontrada, mas sem Contrato Ativo.' });
        }

        // D. Salva na Sessão
        req.session.user = {
            id: pessoa.Id,
            nome: pessoa.Name,
            email: userEmail,
            contrato: contrato 
        };

        res.redirect('/dashboard');

    } catch (error) {
        console.error(error);
        res.render('negado', { mensagem: 'Erro técnico no processo de login.' });
    }
};

exports.logout = (req, res) => {
    req.session = null;
    res.redirect('/');
};