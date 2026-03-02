require('dotenv').config();
const { getSfConnection } = require('../src/config/salesforce');

async function run() {
    let conn;
    try { conn = await getSfConnection(); } catch (e) { console.error("Erro conexão:", e.message); process.exit(1); }

    console.log("🚀 LIMPANDO REGISTROS ZERADOS (Ordenado por Data DESC)");
    let total = 0;

    while (true) {
        try {
            const code = `
                List<LancamentoHora__c> logs = [
                    SELECT Id FROM LancamentoHora__c 
                    WHERE Horas__c = 0 AND HorasExtras__c = 0 
                    AND (HorasBanco__c = 0 OR HorasBanco__c = null)
                    AND (HorasAusenciaRemunerada__c = 0 OR HorasAusenciaRemunerada__c = null)
                    AND (HorasAusenciaNaoRemunerada__c = 0 OR HorasAusenciaNaoRemunerada__c = null)
                    ORDER BY DiaPeriodo__r.Data__c DESC
                    LIMIT 2000
                ];
                if (logs.isEmpty()) { System.debug('EMPTY'); }
                else { Database.delete(logs, false); System.debug('DONE'); }
            `.trim();

            const res = await conn.tooling.executeAnonymous(code);
            if (res.success) {
                if (res.debugLog && res.debugLog.includes('EMPTY')) {
                    console.log("\n✅ TUDO LIMPO! Não restam registros zerados.");
                    break;
                }
                total += 2000;
                process.stdout.write(`\r🗑️  Registros processados: ~${total}...`);
            } else {
                console.log("\n⚠️ Erro no lote Apex, tentando novamente...");
                await new Promise(r => setTimeout(r, 5000));
            }
        } catch (err) {
            console.log("\n❌ Erro de rede, tentando reconectar...");
            await new Promise(r => setTimeout(r, 10000));
            try { conn = await getSfConnection(); } catch(e) {}
        }
    }
}
run();
