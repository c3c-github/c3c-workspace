require('dotenv').config();
const { getSfConnection } = require('../src/config/salesforce');

async function run() {
    const conn = await getSfConnection();
    const targetId = 'a14N5000009ZEFsIAO'; // Iago
    
    // Filtro por Nome (Adama ou Doremus)
    const qServ = `
        SELECT Id, Name 
        FROM Servico__c 
        WHERE (Name LIKE '%Adama%' OR Name LIKE '%Doremus%')
        AND Status__c != 'Inativo' AND Status__c != 'Encerrado'
    `;
    
    const resServ = await conn.query(qServ);
    
    if (resServ.totalSize === 0) {
        console.log("Nenhum serviço encontrado para Adama ou Doremus.");
        return;
    }
    
    console.log(`Encontrados ${resServ.totalSize} serviços.`);
    resServ.records.forEach(s => console.log(` - ${s.Name}`));
    
    const allocations = resServ.records.map(s => ({
        Pessoa__c: targetId,
        Servico__c: s.Id,
        DataInicio__c: '2026-02-01',
        DataFimOriginal__c: '2026-12-31',
        Percentual__c: 0
    }));
    
    try {
        const ret = await conn.sobject('Alocacao__c').create(allocations);
        const success = ret.filter(r => r.success).length;
        console.log(`\n✅ ${success}/${ret.length} Alocações criadas.`);
        
        const errors = ret.filter(r => !r.success);
        if(errors.length > 0) console.error("❌ Erros:", JSON.stringify(errors, null, 2));
    } catch (e) {
        console.error("Erro fatal:", e.message);
    }
}

run();
