require('dotenv').config();
const { getSfConnection } = require('../src/config/salesforce');

async function cleanupInstallmentLinks() {
    console.log(`[${new Date().toISOString()}] 🧹 LIMPANDO VÍNCULOS DIRETOS EM PARCELAS...`);
    
    try {
        const conn = await getSfConnection();
        
        // Buscar todas as parcelas que ainda possuem vínculo de serviço
        const res = await conn.query("SELECT Id FROM ParcelaFinanceira__c WHERE Servico__c != null");
        console.log(`Encontradas ${res.totalSize} parcelas para limpar.`);

        if (res.totalSize === 0) {
            console.log("Nenhuma parcela com vínculo direto encontrada.");
            return;
        }

        const updates = res.records.map(r => ({
            Id: r.Id,
            Servico__c: null
        }));

        const CHUNK = 200;
        for (let i = 0; i < updates.length; i += CHUNK) {
            const chunk = updates.slice(i, i + CHUNK);
            await conn.sobject('ParcelaFinanceira__c').update(chunk);
            console.log(`Processados: ${i + chunk.length}/${updates.length}`);
        }

        console.log("✅ Limpeza concluída!");
    } catch (e) {
        console.error("❌ ERRO NA LIMPEZA:", e.message);
    }
}

cleanupInstallmentLinks();
