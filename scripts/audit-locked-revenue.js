require('dotenv').config();
const { getSfConnection } = require('../src/config/salesforce');

async function auditLockedRevenue() {
    try {
        const conn = await getSfConnection();
        console.log("✅ Conectado ao Salesforce.");

        // 1. Buscar serviços que TIVERAM lançamentos em 2025
        const logsRes = await conn.query("SELECT Servico__c FROM LancamentoHora__c WHERE DiaPeriodo__r.Data__c >= 2025-01-01 AND DiaPeriodo__r.Data__c <= 2025-12-31 GROUP BY Servico__c");
        const activeServicesIds = new Set(logsRes.records.map(r => r.Servico__c));
        console.log(`📊 Serviços com execução em 2025: ${activeServicesIds.size}`);

        // 2. Buscar vínculos de vendas e seus serviços
        const linksRes = await conn.query("SELECT Venda__c, Servico__c, Servico__r.Name, ValorAlocado__c, Venda__r.ValorTotal__c FROM VendaServico__c");
        const saleToServiceMap = new Map();
        linksRes.records.forEach(l => {
            if (!saleToServiceMap.has(l.Venda__c)) saleToServiceMap.set(l.Venda__c, []);
            saleToServiceMap.get(l.Venda__c).push({ 
                id: l.Servico__c, 
                name: l.Servico__r ? l.Servico__r.Name : 'N/A',
                allocated: l.ValorAlocado__c || 0,
                vendaTotal: l.Venda__r ? l.Venda__r.ValorTotal__c : 0
            });
        });

        // 3. Buscar parcelas pagas em 2025
        const query = `
            SELECT Valor__c, VendaContaAzul__c, VendaContaAzul__r.Name 
            FROM ParcelaFinanceira__c 
            WHERE CALENDAR_YEAR(DataVencimento__c) = 2025 
            AND Status__c IN ('Pago', 'Liquidado', 'QUITADO', 'PAGO')
        `;
        
        const installments = [];
        await new Promise((resolve, reject) => {
            conn.query(query).on("record", r => installments.push(r)).on("end", () => resolve()).on("error", err => reject(err)).run({ autoFetch: true, maxFetch: 50000 });
        });

        const lockedServices = new Map();
        let totalLockedValue = 0;

        installments.forEach(p => {
            const services = saleToServiceMap.get(p.VendaContaAzul__c) || [];
            
            services.forEach(s => {
                // Se o serviço vinculado NÃO teve horas em 2025
                if (!activeServicesIds.has(s.id)) {
                    const ratio = s.vendaTotal > 0 ? (s.allocated / s.vendaTotal) : 0;
                    const valueForService = (p.Valor__c || 0) * ratio;

                    if (!lockedServices.has(s.id)) {
                        lockedServices.set(s.id, { name: s.name, total: 0, saleCount: new Set() });
                    }
                    const data = lockedServices.get(s.id);
                    data.total += valueForService;
                    data.saleCount.add(p.VendaContaAzul__c);
                    totalLockedValue += valueForService;
                }
            });
        });

        console.log('\n--- RELATÓRIO DE RECEITA RETIDA (SEM EXECUÇÃO EM 2025) ---');
        console.log(`Valor Total Retido: R$ ${totalLockedValue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`);
        console.log(`Total de Serviços sem Execução com Receita: ${lockedServices.size}`);

        console.log('\nDetalhamento por Serviço:');
        const sorted = [...lockedServices.values()].sort((a,b) => b.total - a.total);
        
        sorted.forEach(s => {
            console.log(`- ${s.name.padEnd(50)} | Receita: R$ ${s.total.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).padStart(12)} | Vendas: ${s.saleCount.size}`);
        });

    } catch (e) {
        console.error("❌ Erro:", e.message);
    }
}

auditLockedRevenue();
