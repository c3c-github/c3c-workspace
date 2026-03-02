require('dotenv').config();
const { getSfConnection } = require('../src/config/salesforce');

async function run() {
    const conn = await getSfConnection();
    const targetId = 'a14N5000009ZGPiIAO'; // Jose Anderson
    const endDate = '2026-01-31';

    console.log(`🛠️  Encerrando alocações indevidas para Jose Anderson...`);

    const q = `
        SELECT Id, Servico__r.Name 
        FROM Alocacao__c 
        WHERE Pessoa__c = '${targetId}' 
        AND (DataFim__c = NULL OR DataFim__c > ${endDate})
        AND Servico__r.Name NOT IN ('ADAMA | Suporte', 'Doremus | Suporte', 'C3C Software | Suporte')
    `;
    const res = await conn.query(q);
    
    if (res.totalSize === 0) {
        console.log("✅ Nada para encerrar.");
        return;
    }

    const upds = res.records.map(r => {
        console.log(`   - Encerrando: ${r.Servico__r.Name}`);
        return { Id: r.Id, DataFim__c: endDate };
    });

    await conn.sobject('Alocacao__c').update(upds);
    console.log(`✅ ${upds.length} alocações encerradas com sucesso.`);
}

run();
