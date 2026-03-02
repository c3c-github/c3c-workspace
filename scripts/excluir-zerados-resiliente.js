require('dotenv').config();
const { getSfConnection } = require('../src/config/salesforce');

async function run() {
    const conn = await getSfConnection();

    console.log("🧹 Limpando lançamentos zerados (Resiliente)...");

    const anonymousCode = `
        List<LancamentoHora__c> logs = [
            SELECT Id FROM LancamentoHora__c 
            WHERE Horas__c = 0 AND HorasExtras__c = 0 
            AND (HorasBanco__c = 0 OR HorasBanco__c = null)
            AND (HorasAusenciaRemunerada__c = 0 OR HorasAusenciaRemunerada__c = null)
            AND (HorasAusenciaNaoRemunerada__c = 0 OR HorasAusenciaNaoRemunerada__c = null)
            LIMIT 200
        ];
        if (!logs.isEmpty()) {
            Database.DeleteResult[] results = Database.delete(logs, false); // false = allOrNone desativado
            Integer deleted = 0;
            for(Database.DeleteResult dr : results) if(dr.isSuccess()) deleted++;
            System.debug('🗑️ ' + deleted + ' registros excluídos com sucesso.');
        }
    `.trim();

    try {
        const res = await conn.tooling.executeAnonymous(anonymousCode);
        if (res.compiled && res.success) {
            console.log("✅ Ciclo de limpeza finalizado.");
        } else {
            console.error("❌ Erro:", res.compileProblem || res.exceptionMessage);
        }
    } catch (e) {
        console.error("Erro fatal:", e.message);
    }
}

run();
