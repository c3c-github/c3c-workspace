require('dotenv').config();
const { getSfConnection } = require('../src/config/salesforce');

async function run() {
    const conn = await getSfConnection();
    const targetId = 'a14N5000009ZGPiIAO'; // Jose Anderson
    const limitDate = '2026-01-31';

    console.log(`🛠️  Limpando e Ajustando alocações de Jose Anderson...`);

    // 1. Busca todas as alocações dele
    const query = `
        SELECT Id, Servico__r.Name 
        FROM Alocacao__c 
        WHERE Pessoa__c = '${targetId}'
    `;
    const res = await conn.query(query);
    
    const toDelete = [];
    const toKeep = [];

    res.records.forEach(r => {
        const name = r.Servico__r.Name;
        // Se NÃO for um dos 3 permitidos, vai para o encerramento/exclusão
        if (!name.includes('ADAMA') && !name.includes('Doremus') && !name.includes('C3C Software | Suporte')) {
            toDelete.push(r.Id);
            console.log(`   - Removendo: ${name}`);
        } else {
            toKeep.push(r.Id);
            console.log(`   - Mantendo: ${name}`);
        }
    });

    try {
        // Remove as alocações que não deveriam existir para ele
        if (toDelete.length > 0) {
            await conn.sobject('Alocacao__c').destroy(toDelete);
            console.log(`✅ ${toDelete.length} alocações extras removidas.`);
        }

        // Garante que as mantidas não tenham data de fim (para ficarem ativas)
        if (toKeep.length > 0) {
            const updates = toKeep.map(id => ({ Id: id, DataFim__c: null }));
            await conn.sobject('Alocacao__c').update(updates);
            console.log(`✅ Alocações permitidas (ADAMA, Doremus, C3C) reativadas.`);
        }

    } catch (e) {
        console.error("❌ Erro no processo:", e.message);
    }
}

run();
