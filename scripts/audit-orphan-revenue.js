require('dotenv').config();
const { getSfConnection } = require('../src/config/salesforce');

async function auditOrphanRevenue() {
    try {
        const conn = await getSfConnection();
        console.log("✅ Conectado ao Salesforce.");

        // 1. Buscar todas as vendas que POSSUEM vínculo
        const linkedRes = await conn.query("SELECT Venda__c FROM VendaServico__c GROUP BY Venda__c");
        const linkedIds = new Set(linkedRes.records.map(r => r.Venda__c));
        console.log(`📊 Total de vendas com vínculo: ${linkedIds.size}`);

        // 2. Buscar parcelas pagas em 2025
        const query = `
            SELECT Id, Valor__c, VendaContaAzul__c, VendaContaAzul__r.Name, 
                   VendaContaAzul__r.IDContaAzul__c, VendaContaAzul__r.ValorTotal__c
            FROM ParcelaFinanceira__c 
            WHERE CALENDAR_YEAR(DataVencimento__c) = 2025 
            AND Status__c IN ('Pago', 'Liquidado', 'QUITADO', 'PAGO')
        `;
        
        const installments = [];
        await new Promise((resolve, reject) => {
            conn.query(query).on("record", r => installments.push(r)).on("end", () => resolve()).on("error", err => reject(err)).run({ autoFetch: true, maxFetch: 50000 });
        });

        console.log(`🔍 Total de parcelas pagas em 2025: ${installments.length}`);

        let orphanTotal = 0;
        const orphanMap = new Map();

        installments.forEach(p => {
            if (!linkedIds.has(p.VendaContaAzul__c)) {
                orphanTotal += p.Valor__c || 0;
                const saleId = p.VendaContaAzul__c;
                if (!orphanMap.has(saleId)) {
                    orphanMap.set(saleId, { 
                        name: p.VendaContaAzul__r ? p.VendaContaAzul__r.Name : 'N/A', 
                        caId: p.VendaContaAzul__r ? p.VendaContaAzul__r.IDContaAzul__c : 'N/A', 
                        valorVenda: p.VendaContaAzul__r ? p.VendaContaAzul__r.ValorTotal__c : 0,
                        pago2025: 0 
                    });
                }
                orphanMap.get(saleId).pago2025 += p.Valor__c || 0;
            }
        });

        console.log('\n--- RESULTADO DA AUDITORIA ---');
        console.log(`Receita Órfã Total (Sem Vínculo em 2025): R$ ${orphanTotal.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`);
        console.log(`Total de Vendas sem Vínculo: ${orphanMap.size}`);

        console.log('\nTop 25 Vendas Pagas sem Vínculo:');
        const sorted = [...orphanMap.values()].sort((a,b) => b.pago2025 - a.pago2025).slice(0, 25);
        
        sorted.forEach(s => {
            console.log(`- ${s.name} | CA: ${s.caId} | Pago 2025: R$ ${s.pago2025.toLocaleString('pt-BR')} | Total Venda: R$ ${s.valorVenda.toLocaleString('pt-BR')}`);
        });

    } catch (e) {
        console.error("❌ Erro:", e.message);
    }
}

auditOrphanRevenue();
