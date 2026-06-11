require('dotenv').config();
const { getSfConnection } = require('./src/config/salesforce');

async function testQuery() {
    try {
        const conn = await getSfConnection();
        const query = `
            SELECT Id, Name, Conta__r.Name, Tipo__c, Status__c, DataInicio__c, DataFimOriginal__c, DataFim__c, 
                   ReceitaVendida__c, CustoVendido__c, MargemVendida__c, 
                   ReceitaPrevista__c, CustoPrevisto__c, MargemPrevista__c, 
                   ReceitaRealizada__c, CustoRealizado__c, MargemRealizada__c,
                   (SELECT Id FROM VendasVinculadas__r LIMIT 1),
                   (SELECT Id FROM LancamentosHoras__r LIMIT 1)
            FROM Servico__c 
            ORDER BY Name ASC
        `;
        const result = await conn.query(query);
        console.log("Query success! Total records:", result.totalSize);
    } catch (e) {
        console.error("Query error:", e.message);
    }
}

testQuery();
