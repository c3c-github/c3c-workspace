require('dotenv').config();
const { getSfConnection } = require('../src/config/salesforce');

async function run() {
    const conn = await getSfConnection();

    console.log("🧹 Iniciando limpeza de lançamentos zerados via Apex Anônimo...");

    const anonymousCode = `
        List<LancamentoHora__c> logs = [
            SELECT Id 
            FROM LancamentoHora__c 
            WHERE Horas__c = 0 
            AND HorasExtras__c = 0 
            AND (HorasBanco__c = 0 OR HorasBanco__c = null)
            AND (HorasAusenciaRemunerada__c = 0 OR HorasAusenciaRemunerada__c = null)
            AND (HorasAusenciaNaoRemunerada__c = 0 OR HorasAusenciaNaoRemunerada__c = null)
            LIMIT 10000
        ];
        if (!logs.isEmpty()) {
            delete logs;
            System.debug('🗑️ ' + logs.size() + ' registros excluídos.');
        } else {
            System.debug('✅ Nenhum registro zerado encontrado.');
        }
    `.trim();

    try {
        const res = await conn.tooling.executeAnonymous(anonymousCode);
        if (res.compiled && res.success) {
            console.log("✅ Execução concluída com sucesso!");
            console.log("Saída do Debug:", res.debugLog);
        } else {
            console.error("❌ Erro na execução:", res.compileProblem || res.exceptionMessage);
        }
    } catch (e) {
        console.error("Erro fatal:", e.message);
    }
}

run();
