require('dotenv').config();
const { getSfConnection } = require('../src/config/salesforce');

async function updateServiceTypes() {
    console.log("🚀 Atualizando tipos de serviço para 'Investimento'...");
    try {
        const conn = await getSfConnection();
        const ids = [
            "a15N50000032b6bIAA", "a15N50000032adaIAA", "a15N5000003jXSjIAM",
            "a15N50000041IgXIAU", "a15N5000003YeCbIAK", "a15N50000052neTIAQ",
            "a15N5000003kCvhIAE", "a15N5000005fewHIAQ", "a15N5000004npNFIAY",
            "a15N50000050dEbIAI", "a15N50000032O4XIAU"
        ];

        const updates = ids.map(id => ({ Id: id, Tipo__c: 'Investimento' }));
        const results = await conn.sobject("Servico__c").update(updates);

        const successCount = results.filter(r => r.success).length;
        console.log(`✅ Sucesso: ${successCount} serviços atualizados.`);

    } catch (e) {
        console.error("❌ Erro:", e.message);
    }
}

updateServiceTypes();
