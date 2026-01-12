const { getSfConnection } = require('../src/config/salesforce');

(async () => {
    const conn = await getSfConnection();
    try {
        const meta = await conn.describe('LancamentoHora__c');
        console.log("Campos de LancamentoHora__c:");
        meta.fields.forEach(f => console.log(`- ${f.name} (${f.type})`));
    } catch (e) {
        console.error(e);
    }
})();