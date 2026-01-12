const { getSfConnection } = require('../src/config/salesforce');

(async () => {
    const conn = await getSfConnection();
    try {
        console.log("--- Checking Services ---");
        const res = await conn.query(`SELECT Id, Name, Tipo__c, Lider__r.Name FROM Servico__c`);
        console.log(`Total Services: ${res.totalSize}`);
        res.records.forEach(r => {
            console.log(`${r.Name} | Tipo: ${r.Tipo__c} | Lider: ${r.Lider__r ? r.Lider__r.Name : 'N/A'}`);
        });

        console.log("\n--- Checking Allocations ---");
        const res2 = await conn.query(`SELECT Id, Pessoa__r.Name, Servico__r.Name, Percentual__c, DataInicio__c, DataFim__c FROM Alocacao__c LIMIT 10`);
        res2.records.forEach(r => {
            console.log(`${r.Pessoa__r ? r.Pessoa__r.Name : 'N/A'} -> ${r.Servico__r ? r.Servico__r.Name : 'N/A'} (${r.Percentual__c}%) [${r.DataInicio__c} - ${r.DataFim__c}]`);
        });

    } catch (e) {
        console.error(e);
    }
})();
