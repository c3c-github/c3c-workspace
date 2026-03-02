require('dotenv').config();
const { getSfConnection } = require('../src/config/salesforce');

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function run() {
    let conn;
    try {
        conn = await getSfConnection();
    } catch (err) {
        console.error("Erro de conexão:", err.message);
        process.exit(1);
    }

    console.log("🚀 Iniciando limpeza ORDENADA (Mais novos -> Mais antigos)...");

    let hasMore = true;
    let totalProcessed = 0;

    while (hasMore) {
        try {
            const anonymousCode = `
                List<LancamentoHora__c> logs = [
                    SELECT Id FROM LancamentoHora__c 
                    WHERE Horas__c = 0 AND HorasExtras__c = 0 
                    AND (HorasBanco__c = 0 OR HorasBanco__c = null)
                    AND (HorasAusenciaRemunerada__c = 0 OR HorasAusenciaRemunerada__c = null)
                    AND (HorasAusenciaNaoRemunerada__c = 0 OR HorasAusenciaNaoRemunerada__c = null)
                    ORDER BY DiaPeriodo__r.Data__c DESC
                    LIMIT 400
                ];
                if (logs.isEmpty()) {
                    System.debug('FINISH_CLEANUP');
                } else {
                    Database.delete(logs, false);
                    System.debug('BATCH_DONE');
                }
            `.trim();

            const res = await conn.tooling.executeAnonymous(anonymousCode);
            
            if (res.compiled && res.success) {
                if (res.debugLog && res.debugLog.includes('FINISH_CLEANUP')) {
                    hasMore = false;
                    console.log("✅ Limpeza completa finalizada!");
                } else {
                    totalProcessed += 400;
                    if (totalProcessed % 2000 === 0) {
                        console.log(`📊 Progresso: ~${totalProcessed} registros processados (Ordenados por Data DESC)...`);
                    }
                    await sleep(1000); 
                }
            } else {
                console.warn("⚠️ Falha no lote, tentando novamente...");
                await sleep(5000);
            }
        } catch (e) {
            console.error("❌ Erro, reconectando...", e.message);
            await sleep(5000);
            try { conn = await getSfConnection(); } catch(reconnErr) {}
        }
    }
}

run();
