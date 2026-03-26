const axios = require('axios');
const { getSfConnection } = require('../config/salesforce');

const CA_TOKEN_URL = 'https://auth.contaazul.com/oauth2/token';

async function getAuthConfig() {
    const conn = await getSfConnection();
    const result = await conn.query("SELECT Id, ClientId__c, ClientSecret__c, Refresh_Token__c, Token__c, Data_Expiracao__c FROM Configuracao__c LIMIT 1");
    if (result.totalSize === 0) {
        throw new Error("Configuração da Conta Azul não encontrada no Salesforce (objeto Configuracao__c).");
    }
    return result.records[0];
}

async function updateAuthConfig(id, updates) {
    const conn = await getSfConnection();
    await conn.sobject("Configuracao__c").update({
        Id: id,
        Token__c: updates.access_token,
        Refresh_Token__c: updates.refresh_token,
        Data_Expiracao__c: new Date(Date.now() + (updates.expires_in * 1000)).toISOString()
    });
}

/**
 * Obtém um Access Token válido, renovando-o se necessário.
 */
async function getValidToken() {
    const config = await getAuthConfig();
    const expirationDate = config.Data_Expiracao__c ? new Date(config.Data_Expiracao__c) : null;
    
    // Se ainda é válido (com margem de 5 minutos), retorna o atual
    if (config.Token__c && expirationDate && (expirationDate.getTime() > (Date.now() + 300000))) {
        return config.Token__c;
    }

    console.log("Renovando token da Conta Azul...");
    
    const authHeader = Buffer.from(`${config.ClientId__c}:${config.ClientSecret__c}`).toString('base64');
    
    try {
        const response = await axios.post(CA_TOKEN_URL, 
            `grant_type=refresh_token&refresh_token=${config.Refresh_Token__c}`,
            {
                headers: {
                    'Authorization': `Basic ${authHeader}`,
                    'Content-Type': 'application/x-www-form-urlencoded'
                }
            }
        );

        const data = response.data;
        await updateAuthConfig(config.Id, data);
        console.log("Token renovado com sucesso!");
        return data.access_token;

    } catch (e) {
        const errorMsg = e.response && e.response.data ? JSON.stringify(e.response.data) : e.message;
        throw new Error(`Erro ao renovar token Conta Azul: ${errorMsg}`);
    }
}

module.exports = {
    getValidToken
};
