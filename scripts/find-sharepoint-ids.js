const axios = require('axios');
const microsoftGraphService = require('../src/services/microsoftGraphService');

async function findIds() {
    console.log('🔍 Iniciando descoberta de IDs do SharePoint...');
    try {
        const token = await microsoftGraphService.getAccessToken();
        const headers = { 'Authorization': `Bearer ${token}` };

        // 1. Localizar o Site pelo nome (hostname e caminho relativo)
        const hostname = 'c3csoftware.sharepoint.com';
        const sitePath = '/sites/BackofficeOperacionalADMEFINANCEIRO';
        
        console.log(`📡 Buscando Site ID para: ${sitePath}...`);
        const siteRes = await axios.get(`https://graph.microsoft.com/v1.0/sites/${hostname}:${sitePath}`, { headers });
        const siteId = siteRes.data.id;
        console.log(`✅ Site ID encontrado: ${siteId}`);

        // 2. Listar as bibliotecas (Drives) deste Site
        console.log(`📂 Listando bibliotecas de documentos (Drives)...`);
        const drivesRes = await axios.get(`https://graph.microsoft.com/v1.0/sites/${siteId}/drives`, { headers });
        
        console.log('\n--- BIBLIOTECAS ENCONTRADAS ---');
        drivesRes.data.value.forEach(drive => {
            console.log(`Nome: ${drive.name}`);
            console.log(`ID: ${drive.id}`);
            console.log(`WebURL: ${drive.webUrl}`);
            console.log('------------------------------');
        });

        console.log('\n💡 Instrução: Copie o ID da biblioteca que corresponde a "Documentos Compartilhados" (ou "Documents") e coloque no seu .env como SHAREPOINT_DRIVE_ID.');

    } catch (e) {
        console.error('❌ Erro na descoberta:', e.message);
        if (e.response) console.error('Detalhes:', JSON.stringify(e.response.data));
    }
}

findIds();