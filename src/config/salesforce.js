const axios = require('axios');
const jsforce = require('jsforce');

let sfConnection = null;

async function getSfConnection() {
    if (sfConnection) return sfConnection;

    const { SF_CLIENT_ID, SF_CLIENT_SECRET, SF_LOGIN_URL } = process.env;

    if (!SF_CLIENT_ID || !SF_CLIENT_SECRET || !SF_LOGIN_URL) {
        const missing = [];
        if (!SF_CLIENT_ID) missing.push('SF_CLIENT_ID');
        if (!SF_CLIENT_SECRET) missing.push('SF_CLIENT_SECRET');
        if (!SF_LOGIN_URL) missing.push('SF_LOGIN_URL');
        console.error(`❌ Faltam variáveis de ambiente: ${missing.join(', ')}`);
        throw new Error(`Configuração do Salesforce incompleta: ${missing.join(', ')}`);
    }

    try {
        const params = new URLSearchParams();
        params.append('grant_type', 'client_credentials');
        params.append('client_id', process.env.SF_CLIENT_ID);
        params.append('client_secret', process.env.SF_CLIENT_SECRET);

        const tokenRes = await axios.post(`${process.env.SF_LOGIN_URL}/services/oauth2/token`, params, {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });

        sfConnection = new jsforce.Connection({
            instanceUrl: tokenRes.data.instance_url,
            accessToken: tokenRes.data.access_token
        });

        console.log("✅ Conectado ao Salesforce (Client Credentials)!");
        return sfConnection;

    } catch (error) {
        console.error("❌ Erro fatal ao conectar no Salesforce:", error.response?.data || error.message);
        throw error;
    }
}

module.exports = { getSfConnection };