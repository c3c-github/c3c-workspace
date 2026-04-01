require('dotenv').config();
const { getSfConnection } = require('../src/config/salesforce');

async function testBillingConsolidation() {
    const startDate = '2026-03-01';
    const endDate = '2026-03-31';
    const clientNameFilter = 'Doremus'; 

    console.log(`🚀 Testando Consolidação de Faturamento (Março/2026) para: ${clientNameFilter}`);

    try {
        const conn = await getSfConnection();

        // 1. Buscar todos os serviços ativos do cliente
        const servicesRes = await conn.query(`
            SELECT Id, Name, Tipo__c, Conta__c, Conta__r.Name, DataInicio__c,
                   Contrato__r.HorasContratadas__c, Contrato__r.Valor__c, Contrato__r.StartDate,
                   RequerRelatorioFaturamento__c, SolicitaRelatorioHoras__c
            FROM Servico__c
            WHERE Conta__r.Name LIKE '%${clientNameFilter}%'
              AND DataInicio__c <= ${endDate}
              AND (DataFim__c >= ${startDate} OR DataFim__c = null)
        `).execute();
        
        const services = Array.isArray(servicesRes) ? servicesRes : (servicesRes.records || []);
        console.log(`   ✅ Encontrados ${services.length} serviços.`);

        // 2. Agrupar Serviços por Tipo (Suporte, Projeto, etc.)
        const groups = {};
        services.forEach(s => {
            const key = `${s.Conta__c}_${s.Tipo__c}`;
            if (!groups[key]) {
                groups[key] = {
                    clientId: s.Conta__c,
                    clientName: s.Conta__r.Name,
                    type: s.Tipo__c,
                    serviceIds: [],
                    latestContract: null,
                    latestServiceStartDate: null,
                    flags: { required: false, requested: false }
                };
            }
            groups[key].serviceIds.push(s.Id);
            if (s.RequerRelatorioFaturamento__c) groups[key].flags.required = true;
            if (s.SolicitaRelatorioHoras__c) groups[key].flags.requested = true;

            // Lógica do contrato/serviço mais recente
            const sDate = s.DataInicio__c || (s.Contrato__r ? s.Contrato__r.StartDate : null);
            if (sDate) {
                if (!groups[key].latestServiceStartDate || sDate > groups[key].latestServiceStartDate) {
                    groups[key].latestServiceStartDate = sDate;
                    if (s.Contrato__r) groups[key].latestContract = s.Contrato__r;
                }
            }
        });

        // 3. Buscar Logs de todos os serviços encontrados de uma vez
        const allServiceIds = services.map(s => s.Id);
        const logsRes = await conn.query(`
            SELECT Id, Servico__c, Horas__c, HorasExtras__c, HorasFaturar__c
            FROM LancamentoHora__c
            WHERE Servico__c IN ('${allServiceIds.join("','")}')
              AND DiaPeriodo__r.Data__c >= ${startDate}
              AND DiaPeriodo__r.Data__c <= ${endDate}
              AND (Horas__c > 0 OR HorasExtras__c > 0)
        `).execute({ autoFetch: true, maxFetch: 100000 });
        
        const allLogs = Array.isArray(logsRes) ? logsRes : (logsRes.records || []);
        console.log(`   ✅ Carregados ${allLogs.length} lançamentos totais.`);

        // 4. Processar a Grade Consolidada
        const gridData = Object.values(groups).map(g => {
            const isSupport = g.type === 'Suporte';
            
            const groupLogs = allLogs.filter(l => g.serviceIds.includes(l.Servico__c));
            
            let totalLogged = 0, totalBillable = 0;
            groupLogs.forEach(l => {
                const logged = (l.Horas__c || 0) + 2 * (l.HorasExtras__c || 0);
                const billable = l.HorasFaturar__c !== null && l.HorasFaturar__c !== undefined ? l.HorasFaturar__c : logged;
                totalLogged += logged;
                totalBillable += billable;
            });

            let franchise = 0;
            let avgRate = 0;
            if (isSupport && g.latestContract) {
                franchise = g.latestContract.HorasContratadas__c || 0;
                const valor = g.latestContract.Valor__c || 0;
                avgRate = franchise > 0 ? valor / franchise : 0;
            }

            const totalValue = isSupport ? (avgRate * Math.max(totalBillable, franchise)) : 0;

            return {
                client: g.clientName,
                type: g.type,
                servicesInGroup: g.serviceIds.length,
                logged: totalLogged,
                billable: totalBillable,
                franchise: franchise,
                rate: avgRate,
                total: totalValue
            };
        });

        console.log("\n📊 GRADE CONSOLIDADA (RESULTADO DO TESTE):");
        console.table(gridData);

        const doremusSupport = gridData.find(d => d.client.includes('Doremus') && d.type === 'Suporte');
        if (doremusSupport && doremusSupport.logged === 131.5) {
            console.log("\n✨ SUCESSO! A consolidação atingiu as 131.5h esperadas para a Doremus.");
        } else if (doremusSupport) {
            console.log(`\n⚠️ A consolidação resultou em ${doremusSupport.logged}h.`);
        }

    } catch (e) {
        console.error("\n❌ ERRO NO TESTE:", e.message);
    }
}

testBillingConsolidation();
