require('dotenv').config();
const { getSfConnection } = require('../src/config/salesforce');

async function run() {
    const conn = await getSfConnection();
    console.log("🔍 Buscando clientes com suporte ativo...");

    // 1. Busca IDs de contas com serviços de suporte ativos
    const qServ = `SELECT Conta__c FROM Servico__c WHERE Tipo__c = 'Suporte' AND Status__c = 'Ativo'`;
    const resServ = await conn.query(qServ);
    
    const accountIds = [...new Set(resServ.records.map(s => s.Conta__c).filter(Boolean))];
    
    if (accountIds.length === 0) {
        console.log("ℹ️ Nenhum cliente com suporte ativo encontrado.");
        return;
    }

    const idsStr = accountIds.map(id => `'${id}'`).join(',');

    // 2. Busca Casos para atualizar
    console.log("📂 Buscando chamados para padronização...");
    const qCases = `
        SELECT Id, CaseNumber, Status 
        FROM Case 
        WHERE AccountId IN (${idsStr}) 
        AND IsClosed = true 
        AND Status != 'Closed'
    `;
    const resCases = await conn.query(qCases);

    if (resCases.totalSize === 0) {
        console.log("✅ Todos os chamados encerrados já estão com status 'Closed'.");
        return;
    }

    console.log(`⚠️ Encontrados ${resCases.totalSize} chamados para atualizar.`);

    const updates = resCases.records.map(c => ({
        Id: c.Id,
        Status: 'Closed'
    }));

    // 3. Executa Update em lotes de 50 com pausa
    try {
        let successCount = 0;
        const batchSize = 50;
        const sleep = (ms) => new Promise(r => setTimeout(r, ms));
        
        for (let i = 0; i < updates.length; i += batchSize) {
            const batch = updates.slice(i, i + batchSize);
            const ret = await conn.sobject('Case').update(batch);
            successCount += ret.filter(r => r.success).length;
            process.stdout.write(`\r🚀 Progresso: ${successCount}/${updates.length}...`);
            await sleep(500); // Pausa de 0.5s
        }
        
        console.log(`\n\n✅ Concluído! ${successCount} chamados atualizados para 'Closed'.`);
    } catch (e) {
        console.error("\n❌ Erro no processo:", e.message);
    }
}

run();
