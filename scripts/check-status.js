require('dotenv').config();
const { getSfConnection } = require('../src/config/salesforce');

async function checkAllocStatus() {
    const conn = await getSfConnection();
    // Verifica valores distintos de Status__c
    const res = await conn.query("SELECT Status__c, COUNT(Id) FROM Alocacao__c GROUP BY Status__c");
    console.log("Status de Alocação:", res.records);
}
checkAllocStatus();
