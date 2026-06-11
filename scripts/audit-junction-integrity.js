require('dotenv').config();
const { getSfConnection } = require('../src/config/salesforce');

async function auditVendaServico() {
    try {
        const conn = await getSfConnection();
        console.log("✅ Conectado ao Salesforce.");

        // 1. Buscar todas as vendas (para referência de Valor Total)
        const salesRes = await conn.query("SELECT Id, Name, ValorTotal__c FROM VendaContaAzul__c");
        const salesMap = new Map();
        salesRes.records.forEach(s => salesMap.set(s.Id, { name: s.Name, total: s.ValorTotal__c || 0 }));

        // 2. Buscar todos os vínculos Venda-Serviço
        const junctionRes = await conn.query("SELECT Id, Venda__c, Servico__c, ValorAlocado__c FROM VendaServico__c");
        
        const saleAllocations = new Map();
        const duplicateCheck = new Set();
        let duplicatesFound = 0;

        junctionRes.records.forEach(j => {
            // Checar Duplicidade Física (Mesma Venda + Mesmo Serviço)
            const dupKey = `${j.Venda__c}_${j.Servico__c}`;
            if (duplicateCheck.has(dupKey)) {
                duplicatesFound++;
                console.log(`🚨 DUPLICIDADE: Registro de vínculo duplicado para a venda ${j.Venda__c} no mesmo serviço.`);
            }
            duplicateCheck.add(dupKey);

            // Somar Alocações por Venda
            if (!saleAllocations.has(j.Venda__c)) saleAllocations.set(j.Venda__c, 0);
            saleAllocations.set(j.Venda__c, saleAllocations.get(j.Venda__c) + (j.ValorAlocado__c || 0));
        });

        console.log(`📊 Vínculos analisados: ${junctionRes.records.length}`);
        console.log(`📊 Vendas analisadas: ${salesMap.size}`);

        let excessErrors = 0;
        console.log('\n--- AUDITORIA DE EXCESSO DE ALOCAÇÃO ---');
        
        for (const [saleId, totalAlocado] of saleAllocations.entries()) {
            const sale = salesMap.get(saleId);
            if (!sale) continue;

            const totalVenda = sale.total;
            // Margem de 0.05 para evitar erros de centavos
            if (totalAlocado > (totalVenda + 0.05)) {
                excessErrors++;
                console.log(`❌ ERRO: ${sale.name} (ID: ${saleId})`);
                console.log(`   Valor da Venda: R$ ${totalVenda.toLocaleString('pt-BR')}`);
                console.log(`   Soma Alocada:   R$ ${totalAlocado.toLocaleString('pt-BR')}`);
                console.log(`   Diferença (Excesso): R$ ${(totalAlocado - totalVenda).toLocaleString('pt-BR')}`);
            }
        }

        console.log('\n--- RESUMO FINAL ---');
        console.log(`Vínculos Duplicados encontrados: ${duplicatesFound}`);
        console.log(`Vendas com Alocação em Excesso: ${excessErrors}`);
        
        if (duplicatesFound === 0 && excessErrors === 0) {
            console.log('\n✅ TUDO CERTO! A lógica de rateio está íntegra e não há duplicidade de receita por venda.');
        } else {
            console.log('\n⚠️ ATENÇÃO: Corrija os vínculos acima para evitar que a receita seja contada a mais.');
        }

    } catch (e) {
        console.error("❌ Erro:", e.message);
    }
}

auditVendaServico();
