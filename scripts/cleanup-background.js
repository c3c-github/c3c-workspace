require('dotenv').config();
const { getSfConnection } = require('../src/config/salesforce');

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function run() {
    let conn;
    try {
        conn = await getSfConnection();
    } catch (err) {
        console.error("Erro inicial de conexão:", err.message);
        process.exit(1);
    }

    console.log("🚀 Iniciando limpeza robusta de 79k registros...");

    let hasMore = true;
    let totalProcessed = 0;

    while (hasMore) {
        try {
            // Apex Anônimo que deleta o que consegue e retorna 'DONE' se não houver mais nada
            const anonymousCode = `
                List<LancamentoHora__c> logs = [
                    SELECT Id FROM LancamentoHora__c 
                    WHERE Horas__c = 0 AND HorasExtras__c = 0 
                    AND (HorasBanco__c = 0 OR HorasBanco__c = null)
                    AND (HorasAusenciaRemunerada__c = 0 OR HorasAusenciaRemunerada__c = null)
                    AND (HorasAusenciaNaoRemunerada__c = 0 OR HorasAusenciaNaoRemunerada__c = null)
                    LIMIT 400
                ];
                if (logs.isEmpty()) {
                    System.debug('FINISH_CLEANUP');
                } else {
                    Database.delete(logs, false); // Deleta o que não estiver travado
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
                        console.log(`📊 Progresso: ~${totalProcessed} registros processados...`);
                    }
                    await sleep(1500); // Pausa curta
                }
            } else {
                console.warn("⚠️ Falha no lote Apex, tentando novamente em 5s...");
                await sleep(5000);
            }
        } catch (e) {
            console.error("❌ Erro de conexão/rede, reconectando em 10s...", e.message);
            await sleep(10000);
            try { conn = await getSfConnection(); } catch(reconnErr) {}
        }
    }
}

run();