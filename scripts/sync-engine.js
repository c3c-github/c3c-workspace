require('dotenv').config();
const { getSfConnection } = require('../src/config/salesforce');

/**
 * Motor de Sincronização e Orquestração (Node.js Workspace)
 * Este script centraliza a execução da cadeia de dados:
 * 1. Equalização (Recriar Orçamentos Mensais)
 * 2. Apuração de Custos (Vincular Horas Aprovadas/Faturadas)
 * 3. Sincronização Financeira (Recuperar Vendas/Parcelas do ERP)
 */
async function runSyncEngine() {
    const startTime = new Date();
    console.log(`[${startTime.toISOString()}] 🚀 Iniciando Motor de Sincronização...`);

    try {
        const conn = await getSfConnection();

        // 1. EQUALIZAÇÃO (Sincrona)
        // Chama a lógica que recria a base de OrcamentoCompetencia__c
        console.log('⏳ [1/3] Equalizando bases mensais (Apex)...');
        const eqResult = await conn.tooling.executeAnonymous("OrcamentoEqualizer.equalizeAllActive();");
        if (!eqResult.compiled || !eqResult.success) {
            throw new Error(`Falha na Equalização: ${eqResult.compileProblem || eqResult.exceptionMessage}`);
        }
        console.log('✅ Base de orçamentos recalibrada.');

        // 2. APURAÇÃO DE CUSTOS (Batch)
        // O batch já foi ajustado para considerar status 'Aprovado' e 'Faturado'
        console.log('⏳ [2/3] Iniciando Apuração de Custos e Horas...');
        const costResult = await conn.tooling.executeAnonymous("Database.executeBatch(new ApuracaoCustosBatch(), 200);");
        if (!costResult.compiled || !costResult.success) {
            throw new Error(`Falha ao disparar Apuração de Custos: ${costResult.compileProblem || costResult.exceptionMessage}`);
        }
        console.log('✅ Batch de custos enviado para processamento.');

        // 3. SINCRONIZAÇÃO CONTA AZUL (Batch)
        // Recupera dados do ERP e distribui a receita
        console.log('⏳ [3/3] Iniciando Sincronização Conta Azul (ERP)...');
        const erpResult = await conn.tooling.executeAnonymous("Database.executeBatch(new ContaAzulSyncBatch(), 50);");
        if (!erpResult.compiled || !erpResult.success) {
            throw new Error(`Falha ao disparar Sincronização ERP: ${erpResult.compileProblem || erpResult.exceptionMessage}`);
        }
        console.log('✅ Batch de sincronização ERP enviado para processamento.');

        const endTime = new Date();
        const duration = (endTime - startTime) / 1000;
        console.log(`\n🏁 [${endTime.toISOString()}] Motor finalizado com sucesso!`);
        console.log(`⏱️ Duração total do disparo: ${duration.toFixed(2)}s`);

    } catch (e) {
        console.error(`\n❌ [ERRO CRÍTICO NO MOTOR]:`, e.message);
        process.exit(1);
    }
}

// Execução se chamado diretamente
if (require.main === module) {
    runSyncEngine();
}

module.exports = runSyncEngine;
