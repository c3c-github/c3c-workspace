require('dotenv').config();
const { getSfConnection } = require('../src/config/salesforce');

async function testBillingWorkflow() {
    const serviceId = 'a15N5000005MXAXIA4';
    const clientId = '001870000041ZLrAAM';
    const start = '2026-03-01';
    const end = '2026-03-31';

    console.log(`🚀 Iniciando teste de faturamento para o serviço: ${serviceId}`);

    try {
        const conn = await getSfConnection();
        
        // 1. Simular getServiceLogs
        console.log("🔍 Passo 1: Buscando logs do serviço...");
        const logsRes = await conn.query(`
            SELECT Id, Horas__c, HorasExtras__c, HorasFaturar__c, Atividade__r.Name
            FROM LancamentoHora__c
            WHERE Servico__c = '${serviceId}'
              AND DiaPeriodo__r.Data__c >= ${start}
              AND DiaPeriodo__r.Data__c <= ${end}
              AND (Horas__c > 0 OR HorasExtras__c > 0)
        `).execute();
        
        const logs = Array.isArray(logsRes) ? logsRes : (logsRes.records || []);
        console.log(`   ✅ Encontrados ${logs.length} logs.`);

        if (logs.length === 0) {
            console.log("❌ Erro: Nenhum log encontrado para o teste.");
            return;
        }

        // 2. Simular saveAdjustments
        console.log("💾 Passo 2: Simulando salvamento de ajustes...");
        
        let totalLogged = 0;
        let totalBillable = 0;

        const logUpdates = logs.map(l => {
            const logged = (l.Horas__c || 0) + 2 * (l.HorasExtras__c || 0);
            const billable = logged + 0.5; // Simula um ajuste de +0.5h por log
            totalLogged += logged;
            totalBillable += billable;
            return {
                id: l.Id,
                billable: billable
            };
        });

        // A. Atualizar logs
        const updates = logUpdates.map(l => ({ Id: l.id, HorasFaturar__c: l.billable }));
        console.log(`   📤 Atualizando HorasFaturar__c em ${updates.length} logs...`);
        const updateRes = await conn.sobject('LancamentoHora__c').update(updates);
        const failedUpdates = updateRes.filter(r => !r.success);
        if (failedUpdates.length > 0) throw new Error(`Falha ao atualizar logs: ${JSON.stringify(failedUpdates[0].errors)}`);

        // B. Criar Relatório
        console.log("   📝 Criando registro de RelatorioHorasFaturar__c...");
        const report = {
            Servico__c: serviceId,
            Cliente__c: clientId,
            FranquiaPrevista__c: 0,
            HorasLancadas__c: totalLogged,
            HorasAFaturar__c: totalBillable,
            Status__c: 'Em Ajuste'
        };
        const reportRes = await conn.sobject('RelatorioHorasFaturar__c').create(report);
        if (!reportRes.success) throw new Error("Falha ao criar relatório.");
        const reportId = reportRes.id;
        console.log(`   ✅ Relatório criado: ${reportId}`);

        // C. Criar Vínculos (Junction)
        console.log("   🔗 Criando vínculos na tabela de junção...");
        const junctions = logUpdates.map(l => ({ 
            RelatorioHorasFaturar__c: reportId, 
            LancamentoHora__c: l.id 
        }));
        const junctionRes = await conn.sobject('RelatorioHorasFaturarLancamento__c').create(junctions);
        const failedJunctions = junctionRes.filter(r => !r.success);
        if (failedJunctions.length > 0) throw new Error("Falha ao criar registros de junção.");

        // 3. Validação Final
        console.log("🧐 Passo 3: Validando dados no Salesforce...");
        
        // Verifica se o relatório existe e tem os valores corretos
        const checkReport = await conn.sobject('RelatorioHorasFaturar__c').retrieve(reportId);
        console.log(`   📊 Totais no Relatório -> Lancadas: ${checkReport.HorasLancadas__c}, Faturar: ${checkReport.HorasAFaturar__c}`);

        // Verifica a contagem de vínculos
        const junctionCount = await conn.query(`SELECT count(Id) c FROM RelatorioHorasFaturarLancamento__c WHERE RelatorioHorasFaturar__c = '${reportId}'`).execute();
        const count = (Array.isArray(junctionCount) ? junctionCount : junctionCount.records)[0].c;
        console.log(`   ✅ Vínculos confirmados: ${count}`);

        if (count === logs.length && checkReport.HorasAFaturar__c === totalBillable) {
            console.log("\n✨ TESTE CONCLUÍDO COM SUCESSO! A solução de faturamento está funcionando corretamente.");
        } else {
            console.log("\n⚠️ O teste terminou mas houve divergência nos dados.");
        }

    } catch (e) {
        console.error("\n❌ ERRO NO TESTE:", e.message);
    }
}

testBillingWorkflow();
