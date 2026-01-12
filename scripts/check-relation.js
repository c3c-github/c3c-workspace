const { getSfConnection } = require('../src/config/salesforce');

(async () => {
    const conn = await getSfConnection();
    try {
        const meta = await conn.describe('LancamentoHora__c');
        const respField = meta.fields.find(f => f.name === 'Responsavel__c');
        console.log("Responsavel__c referenceTo:", respField.referenceTo);
        
        // Se apontar para algo, vamos descrever esse objeto para ver se tem Alocacao__c
        if (respField.referenceTo && respField.referenceTo.length > 0) {
            const refObj = respField.referenceTo[0];
            console.log(`Describing ${refObj}...`);
            const metaRef = await conn.describe(refObj);
            const alocField = metaRef.fields.find(f => f.name === 'Alocacao__c');
            if (alocField) {
                console.log(`Found Alocacao__c in ${refObj}!`);
            } else {
                console.log(`Alocacao__c NOT found in ${refObj}. Fields:`, metaRef.fields.map(f => f.name).join(', '));
            }
        }
    } catch (e) {
        console.error(e);
    }
})();