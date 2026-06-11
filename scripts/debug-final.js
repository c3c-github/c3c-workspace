require('dotenv').config();
const { getSfConnection } = require('../src/config/salesforce');

async function debugFinal() {
    try {
        const conn = await getSfConnection();
        console.log("✅ Conectado ao Salesforce.");

        const start = '2025-01-01';
        const end = '2025-12-31';

        // 1. Receita Real por Serviço
        const realRes = await conn.query(`SELECT Servico__c, SUM(ValorReceita__c) total FROM LancamentoHora__c WHERE DiaPeriodo__r.Data__c >= ${start} AND DiaPeriodo__r.Data__c <= ${end} GROUP BY Servico__c`);
        const serviceRealMap = new Map();
        realRes.records.forEach(r => serviceRealMap.set(r.Servico__c, r.total));

        // 2. Vínculos e Vendas
        const linksRes = await conn.query("SELECT Venda__c, Servico__c FROM VendaServico__c");
        const saleToLinks = new Map();
        linksRes.records.forEach(l => {
            if (!saleToLinks.has(l.Venda__c)) saleToLinks.set(l.Venda__c, []);
            saleToLinks.get(l.Venda__c).push(l.Servico__c);
        });

        // 3. Parcelas Pagas por Venda
        const partsRes = await conn.query(`SELECT VendaContaAzul__c, VendaContaAzul__r.Name, SUM(Valor__c) total FROM ParcelaFinanceira__c WHERE DataVencimento__c >= ${start} AND DataVencimento__c <= ${end} AND Status__c IN ('Pago', 'Liquidado', 'QUITADO', 'PAGO') GROUP BY VendaContaAzul__c, VendaContaAzul__r.Name`);
        
        let totalReal = 0;
        serviceRealMap.forEach(v => totalReal += v);

        let totalVirtual = 0;
        const overages = [];

        console.log('\n--- ANÁLISE POR VENDA ---');
        partsRes.records.forEach(p => {
            const vendaId = p.VendaContaAzul__c;
            const pago = p.total;
            const services = saleToLinks.get(vendaId) || [];
            
            // Quanto essa venda já entregou no real?
            let jaDistribuido = 0;
            let hasActive = false;
            services.forEach(sId => {
                if (serviceRealMap.has(sId)) {
                    hasActive = true;
                    // O motor de rateio global garante que a venda foi rateada proporcionalmente.
                    // Porém, no motor que rodamos, ele soma TODAS as vendas do serviço.
                }
            });

            if (!hasActive) {
                totalVirtual += pago;
                console.log(`[VIRTUAL] ${p.Name}: R$ ${pago.toLocaleString('pt-BR')}`);
            }
        });

        console.log('\n--- RESULTADO ---');
        console.log(`Real:    R$ ${totalReal.toLocaleString('pt-BR')}`);
        console.log(`Virtual: R$ ${totalVirtual.toLocaleString('pt-BR')}`);
        console.log(`SOMA:    R$ ${(totalReal + totalVirtual).toLocaleString('pt-BR')}`);
        
        const financeTotalRes = await conn.query(`SELECT SUM(Valor__c) total FROM ParcelaFinanceira__c WHERE DataVencimento__c >= ${start} AND DataVencimento__c <= ${end} AND Status__c IN ('Pago', 'Liquidado', 'QUITADO', 'PAGO')`);
        const financeTotal = financeTotalRes.records[0].total;
        console.log(`FINANCEIRO: R$ ${financeTotal.toLocaleString('pt-BR')}`);
        console.log(`DIFERENÇA:  R$ ${(totalReal + totalVirtual - financeTotal).toLocaleString('pt-BR')}`);

    } catch (e) { console.error(e); }
}
debugFinal();
