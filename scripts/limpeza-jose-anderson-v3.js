require('dotenv').config();
const { getSfConnection } = require('../src/config/salesforce');

async function run() {
    const conn = await getSfConnection();
    const targetId = 'a14N5000009ZGPiIAO'; // Jose Anderson
    const limitDate = '2026-01-31';

    console.log(`🧹 Iniciando limpeza rigorosa para Jose Anderson...`);

    const query = `SELECT Id, Servico__r.Name, DataInicio__c FROM Alocacao__c WHERE Pessoa__c = '${targetId}'`;
    const res = await conn.query(query);
    
    const toDelete = [];
    const toEnd = [];

    res.records.forEach(r => {
        const name = r.Servico__r.Name;
        const isAllowed = name.includes('ADAMA') || name.includes('Doremus') || name.includes('C3C Software | Suporte');
        const isFuture = r.DataInicio__c >= '2026-02-01';

        if (!isAllowed) {
            // Se não é um dos 3, remove.
            toDelete.push(r.Id);
            console.log(`   [DELETE] ${name}`);
        } else if (!isFuture) {
            // Se é um dos 3 mas começou antes de fev, encerra em 31/01.
            toEnd.push({ Id: r.Id, DataFim__c: limitDate });
            console.log(`   [END 31/01] ${name}`);
        } else {
            // Se é um dos 3 e começa em fev, mantém ativo.
            console.log(`   [KEEP ACTIVE] ${name}`);
        }
    });

    try {
        if (toDelete.length > 0) {
            await conn.sobject('Alocacao__c').destroy(toDelete);
            console.log(`✅ ${toDelete.length} registros excluídos.`);
        }
        if (toEnd.length > 0) {
            await conn.sobject('Alocacao__c').update(toEnd);
            console.log(`✅ ${toEnd.length} registros antigos encerrados.`);
        }
    } catch (e) {
        console.error("Erro:", e.message);
    }
}

run();
