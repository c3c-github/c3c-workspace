require('dotenv').config();
const { getSfConnection } = require('./src/config/salesforce');

async function testQuery() {
    try {
        const conn = await getSfConnection();
        const query = `
            SELECT Pessoa__r.Name personName, SUM(HorasCusto__c) hrs, SUM(ValorTotalLancamento__c) cost, SUM(ValorReceita__c) rev
            FROM LancamentoHora__c 
            WHERE DiaPeriodo__r.Data__c >= 2025-01-01
            GROUP BY Pessoa__r.Name
            LIMIT 10
        `;
        const result = await conn.query(query);
        console.log("Query success!", result.records);
    } catch (e) {
        console.error("Query error:", e.message);
    }
}

testQuery();
