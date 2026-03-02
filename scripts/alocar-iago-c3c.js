require('dotenv').config();
const { getSfConnection } = require('../src/config/salesforce');

async function run() {
    const conn = await getSfConnection();
    const targetId = 'a14N5000009ZEFsIAO'; // Iago
    
    // Busca C3C Software | Suporte
    const qServ = `
        SELECT Id, Name 
        FROM Servico__c 
        WHERE Name = 'C3C Software | Suporte' 
    `;
    
    const resServ = await conn.query(qServ);
    
    if (resServ.totalSize === 0) {
        console.log("Serviço 'C3C Software | Suporte' não encontrado.");
        return;
    }
    
    const serviceId = resServ.records[0].Id;
    console.log(`Serviço encontrado: ${serviceId}`);

    try {
        const ret = await conn.sobject('Alocacao__c').create({
            Pessoa__c: targetId,
            Servico__c: serviceId,
            DataInicio__c: '2026-02-01',
            DataFimOriginal__c: '2026-12-31',
            Percentual__c: 0
        });
        
        if (ret.success) {
            console.log(`✅ Iago alocado em C3C Software | Suporte! ID: ${ret.id}`);
        } else {
            console.error("❌ Erro:", ret.errors);
        }
    } catch (e) {
        console.error("Erro fatal:", e.message);
    }
}

run();
