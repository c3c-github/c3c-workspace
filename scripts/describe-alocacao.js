const { getSfConnection } = require('../src/config/salesforce');

(async () => {
    const conn = await getSfConnection();
    try {
        const meta = await conn.describe('Alocacao__c');
        console.log("Campos de Alocacao__c:");
        meta.fields.forEach(f => console.log(`- ${f.name} (${f.type})`));
    } catch (e) {
        console.error(e);
    }
})();