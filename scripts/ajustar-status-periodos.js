const { getSfConnection } = require('../src/config/salesforce');

const sleep = ms => new Promise(resolve => setTimeout(ms, resolve));

async function run() {
    try {
        const conn = await getSfConnection();
        console.log("🚀 Iniciando ajuste de status dos períodos...");

        // 1. Períodos antigos (<= Jan/26)
        const oldPeriods = await conn.query(`SELECT Id FROM Periodo__c WHERE DataInicio__c <= 2026-01-31 AND Status__c != 'Finalizado/Pago'`);
        console.log(`--- Encontrados ${oldPeriods.totalSize} períodos antigos.`);
        
        if (oldPeriods.totalSize > 0) {
            const updates = oldPeriods.records.map(p => ({ Id: p.Id, Status__c: 'Finalizado/Pago' }));
            for (let i = 0; i < updates.length; i += 100) {
                const batch = updates.slice(i, i + 100);
                await conn.sobject('Periodo__c').update(batch);
                console.log(`✅ Antigos: Processados ${i + batch.length} de ${updates.length}`);
                await sleep(500);
            }
        }

        // 2. Períodos atuais (>= Fev/26)
        const currentPeriods = await conn.query(`SELECT Id FROM Periodo__c WHERE DataInicio__c >= 2026-02-01 AND Status__c != 'Aberto'`);
        console.log(`--- Encontrados ${currentPeriods.totalSize} períodos atuais.`);
        
        if (currentPeriods.totalSize > 0) {
            const updates = currentPeriods.records.map(p => ({ Id: p.Id, Status__c: 'Aberto' }));
            for (let i = 0; i < updates.length; i += 100) {
                const batch = updates.slice(i, i + 100);
                await conn.sobject('Periodo__c').update(batch);
                console.log(`✅ Atuais: Processados ${i + batch.length} de ${updates.length}`);
                await sleep(500);
            }
        }

        console.log("✨ Ajuste concluído com sucesso!");
        process.exit(0);
    } catch (e) {
        console.error("❌ Erro ao executar script:", e.message);
        process.exit(1);
    }
}

run();
