require('dotenv').config();
const { getSfConnection } = require('../src/config/salesforce');

async function debugHybridLogic() {
    try {
        const conn = await getSfConnection();
        console.log("✅ Conectado ao Salesforce.");

        const start = '2025-01-01';
        const end = '2025-12-31';

        // 1. RECEITA REAL (DOS LOGS)
        const realLogsRes = await conn.query(`
            SELECT SUM(ValorReceita__c) total 
            FROM LancamentoHora__c 
            WHERE DiaPeriodo__r.Data__c >= ${start} AND DiaPeriodo__r.Data__c <= ${end}
        `).execute();
        const realLogsRecords = Array.isArray(realLogsRes) ? realLogsRes : (realLogsRes.records || []);
        const totalReal = (realLogsRecords.length > 0) ? (realLogsRecords[0].total || 0) : 0;

        // 2. IDENTIFICAR VENDAS ATIVAS (COM EXECUÇÃO EM 2025)
        const activeSalesQuery = `
            SELECT Venda__c FROM VendaServico__c 
            WHERE Servico__c IN (
                SELECT Servico__c FROM LancamentoHora__c 
                WHERE DiaPeriodo__r.Data__c >= ${start} AND DiaPeriodo__r.Data__c <= ${end}
            )
            GROUP BY Venda__c
        `;
        const activeSalesRes = await conn.query(activeSalesQuery).execute({ autoFetch: true, maxFetch: 100000 });
        const activeSalesRecords = Array.isArray(activeSalesRes) ? activeSalesRes : (activeSalesRes.records || []);
        const activeSalesIds = new Set(activeSalesRecords.map(r => r.Venda__c));

        // 3. BUSCAR TODAS AS PARCELAS PAGAS NO PERÍODO
        const installmentsRes = await conn.query(`
            SELECT Id, Valor__c, VendaContaAzul__c, VendaContaAzul__r.Name
            FROM ParcelaFinanceira__c 
            WHERE DataVencimento__c >= ${start} AND DataVencimento__c <= ${end}
            AND Status__c IN ('Pago', 'Liquidado', 'QUITADO', 'PAGO')
        `).execute({ autoFetch: true, maxFetch: 100000 });
        const installmentsRecords = Array.isArray(installmentsRes) ? installmentsRes : (installmentsRes.records || []);

        // 4. BUSCAR VÍNCULOS
        const linksRes = await conn.query("SELECT Venda__c, Servico__c, ValorAlocado__c, Venda__r.ValorTotal__c FROM VendaServico__c").execute({ autoFetch: true, maxFetch: 100000 });
        const linksRecords = Array.isArray(linksRes) ? linksRes : (linksRes.records || []);
        const saleToLinks = new Map();
        linksRecords.forEach(l => {
            if (!saleToLinks.has(l.Venda__c)) saleToLinks.set(l.Venda__c, []);
            saleToLinks.get(l.Venda__c).push(l);
        });

        // 5. CALCULAR RECEITA VIRTUAL
        let totalVirtual = 0;
        const virtualSalesDetails = [];

        installmentsRecords.forEach(p => {
            if (activeSalesIds.has(p.VendaContaAzul__c)) {
                // Se a venda já tem rateio real, ignoramos completamente no virtual
                return;
            }

            const links = saleToLinks.get(p.VendaContaAzul__c) || [];
            if (links.length === 0) {
                // Venda sem vínculos
                totalVirtual += p.Valor__c;
                virtualSalesDetails.push({ name: (p.VendaContaAzul__r ? p.VendaContaAzul__r.Name : 'Venda Sem Nome'), valor: p.Valor__c, type: 'Órfã Sem Vínculo' });
            } else {
                // Venda com vínculos mas sem execução
                let saleSum = 0;
                links.forEach(link => {
                    const ratio = (link.Venda__r && link.Venda__r.ValorTotal__c > 0) ? (link.ValorAlocado__c / link.Venda__r.ValorTotal__c) : (1 / links.length);
                    saleSum += (p.Valor__c * ratio);
                });
                totalVirtual += saleSum;
                virtualSalesDetails.push({ name: (p.VendaContaAzul__r ? p.VendaContaAzul__r.Name : 'Venda Desconhecida'), valor: saleSum, type: 'Vínculo Sem Execução' });
            }
        });

        console.log('\n--- AUDITORIA DE LÓGICA HÍBRIDA (2025) ---');
        console.log(`Receita Real (Logs):    R$ ${totalReal.toLocaleString('pt-BR')}`);
        console.log(`Receita Virtual:        R$ ${totalVirtual.toLocaleString('pt-BR')}`);
        console.log(`TOTAL CALCULADO:        R$ ${(totalReal + totalVirtual).toLocaleString('pt-BR')}`);
        
        const financeRes = await conn.query(`SELECT SUM(Valor__c) total FROM ParcelaFinanceira__c WHERE DataVencimento__c >= ${start} AND DataVencimento__c <= ${end} AND Status__c IN ('Pago', 'Liquidado', 'QUITADO', 'PAGO')`).execute();
        const financeRecords = Array.isArray(financeRes) ? financeRes : (financeRes.records || []);
        const totalFinance = (financeRecords.length > 0) ? (financeRecords[0].total || 0) : 0;
        console.log(`TOTAL FINANCEIRO REAL:  R$ ${totalFinance.toLocaleString('pt-BR')}`);
        console.log(`DIFERENÇA (ERRO):       R$ ${(totalReal + totalVirtual - totalFinance).toLocaleString('pt-BR')}`);

        if (totalReal + totalVirtual > totalFinance) {
            console.log('\n🔍 INVESTIGANDO DUPLICIDADE...');
        }

    } catch (e) { console.error(e); }
}

debugHybridLogic();
